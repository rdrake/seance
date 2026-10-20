// The connect burst against nefarious2's fake lag, measured from what the
// page actually sends.
//
//   corepack yarn build && python3 -m http.server -d public 8047 &
//   node tools/browser-drive.mjs tools/scenarios/connect-fakelag.mjs --no-ws
//
// Needs the dev ircd (tools/nefarious-dev/run.sh). `SEANCE_PORT` (default
// 8047) is where `public/` is served, `SEANCE_FAKELAG_CHANNELS` (default 12)
// how many channels to autojoin, `SEANCE_FAKELAG_WAIT` (ms, default 30000)
// how long to watch each connect.
//
// The page's WebSocket is wrapped to timestamp every line, and the server's
// clock is replayed over them exactly as parse.c and s_bsd.c keep it: each
// command after 001 adds 2 s + 1 s per 120 bytes, and the clock is pulled up
// to now on every read. The server stops reading at 10 s ahead, so the peak
// is what the user feels: a line typed while the clock is at 8 s is read 2 s
// later than it was sent. Before irc/fakelag.ts the catch-up held it at ~10 s
// for the whole catch-up (two commands every 4 s drain exactly as fast as
// they are charged); now background work only goes out under 4 s, and the
// one burst that can push it higher is the JOIN with the open channel's
// history pipelined behind it (6 s).
//
// With `SEANCE_FAKELAG_TYPE=<ms>` it also types a line that often and
// reports each one's send → echo time; the clock checks below are about
// background work and will fail with typing on, since typed lines count.
//
// Checks, on a fresh connect and on a reconnect of the same page:
//   * the peak stays at or under 6 s, and once the burst is over at or
//     under the background budget (4 s);
//   * every autojoined channel gets its history in the end (fresh connect);
//   * the reconnect asks for no marker the server has already answered.

const PORT = process.env.SEANCE_PORT || "8047";
// The ircd's WebSocket (TLS) and plain ports. The dev ircd's image turns
// fake lag off for users (`fakelagfactor = 0` in base.conf-dist), so it
// shows what the client sends but never the delay: point these at a copy
// with those lines removed to see the server hold lines back for real.
const IRC_PORT = process.env.SEANCE_IRC_PORT || "8443";
const PLAIN_PORT = Number(process.env.SEANCE_IRC_PLAIN_PORT || 6667);
const N = Number(process.env.SEANCE_FAKELAG_CHANNELS || 12);
const WAIT = Number(process.env.SEANCE_FAKELAG_WAIT || 30000);
const CHANS = Array.from({length: N}, (_, i) => `#lag${i}`);
const NICK = "lag" + Date.now().toString(36).slice(-5);

export const url =
	`http://localhost:${PORT}/?host=localhost&port=${IRC_PORT}&tls=true&nick=${NICK}&join=` +
	encodeURIComponent(CHANS.join(","));

const WRAP = `(() => {
  const t0 = performance.timeOrigin;
  const log = (window.__wire = []);
  const socks = (window.__socks = []);
  const Orig = window.WebSocket;
  window.WebSocket = class extends Orig {
    constructor(url, ...rest) {
      // While the scenario holds the page "offline", every dial fails.
      super(window.__offline ? "ws://127.0.0.1:9/" : url, ...rest);
      socks.push(this);
      this.addEventListener("message", (e) => {
        for (const l of String(e.data).split(/\\r?\\n/)) if (l) log.push({t: t0 + performance.now(), d: "in", l});
      });
    }
    send(data) {
      for (const l of String(data).split(/\\r?\\n/)) if (l) log.push({t: t0 + performance.now(), d: "out", l});
      return super.send(data);
    }
  };
})();`;

/** Replay the server's clock over the captured lines. */
function replay(wire) {
	let since = null;
	let registered = null;
	const out = [];

	for (const x of wire) {
		const now = x.t / 1000;

		if (x.d === "in" && registered === null && / 001 /.test(x.l)) {
			registered = now;
			since = now;
		}

		if (x.d !== "out" || registered === null) {
			continue;
		}

		since = Math.max(since, now) + 2 + Math.floor((Buffer.byteLength(x.l) + 2) / 120);
		out.push({at: now - registered, ahead: since - now, line: x.l});
	}

	return out;
}

/**
 * An opered helper on the plain-IRC port posts `count` lines into each of
 * `chans` — opers are not charged for PRIVMSG — then quits.
 */
async function seed(chans, count) {
	const {connect} = await import("node:net");
	const sock = connect(PLAIN_PORT, "127.0.0.1");
	const closed = new Promise((r) => sock.on("close", r));
	const nick = "seed" + Date.now().toString(36).slice(-5);
	let buf = "";
	const waitFor = (re) =>
		new Promise((resolve) => {
			const check = () => (re.test(buf) ? resolve() : setTimeout(check, 50));
			check();
		});
	sock.on("data", (d) => {
		buf += d.toString();
		for (const m of buf.matchAll(/^PING (.*)$/gm)) sock.write(`PONG ${m[1]}\r\n`);
	});
	sock.write(`NICK ${nick}\r\nUSER ${nick} 0 * :${nick}\r\n`);
	await waitFor(/ 001 /);
	sock.write("OPER seanceop seance\r\n");
	await waitFor(/ 381 /);
	sock.write(`JOIN ${chans.join(",")}\r\n`);
	await waitFor(new RegExp(` 366 \\S+ \\${chans.at(-1)} `));

	for (let i = 0; i < count; i++) {
		sock.write(chans.map((c) => `PRIVMSG ${c} :busy line ${i} in ${c}\r\n`).join(""));
		// Slow enough for the server's receive queue (Excess Flood otherwise).
		await new Promise((r) => setTimeout(r, 100));
	}

	sock.write("QUIT :done\r\n");
	await closed;
}

const command = (line) =>
	line
		.replace(/^@\S+ /, "")
		.split(" ")
		.slice(0, 2)
		.join(" ");

/**
 * With `SEANCE_FAKELAG_TYPE=<ms>`, type a line into the composer that often
 * while watching. Under echo-message the echo comes back when the server
 * has read the line, so send → echo is the delay the user feels.
 */
const TYPE = Number(process.env.SEANCE_FAKELAG_TYPE || 0);

async function typeWhileWatching(page, label) {
	const start = Date.now();
	let n = 0;

	while (TYPE > 0 && Date.now() - start + TYPE < WAIT) {
		await page.sleep(TYPE);
		n++;
		await page.fill("#input", `typed ${NICK} ${label} ${n}`);
		await page.click("#submit");
	}

	await page.sleep(Math.max(0, WAIT - (Date.now() - start)));
}

function typedDelays(wire, label) {
	const delays = [];
	const sentAt = new Map();

	for (const x of wire) {
		const m = new RegExp(` PRIVMSG \\S+ :(typed ${NICK} ${label} \\d+)$`).exec(x.l);

		if (!m) {
			continue;
		}

		if (x.d === "out") {
			sentAt.set(m[1], x.t);
		} else if (sentAt.has(m[1]) && !/^@\S*batch=/.test(x.l)) {
			// The live echo: ours, outside any history batch.
			delays.push({line: m[1], wait: (x.t - sentAt.get(m[1])) / 1000});
			sentAt.delete(m[1]);
		}
	}

	return delays;
}

async function watch(page, label) {
	await typeWhileWatching(page, label);
	const wire = await page.evaluate("window.__wire");
	const sent = replay(wire);

	if (TYPE > 0) {
		const typed = typedDelays(wire, label);
		results[`${label}.wire`] = wire.filter((x) => / :typed /.test(x.l));
		results[`${label}.typed`] = typed;
		console.log(
			`${label}: typed lines echoed after ${typed
				.map((t) => t.wait.toFixed(1) + " s")
				.join(", ")}`
		);
	}
	const peak = Math.max(0, ...sent.map((s) => s.ahead));
	const late = sent.filter((s) => s.at > 1);
	const latePeak = Math.max(0, ...late.map((s) => s.ahead));
	console.log(`${label}: ${sent.length} commands after 001, peak ${peak.toFixed(1)} s ahead`);

	for (const s of sent) {
		console.log(`  +${s.at.toFixed(2)}s ahead=${s.ahead.toFixed(1)} ${s.line.slice(0, 120)}`);
	}

	page.check(
		`${label}: the clock never passes 6 s ahead (peak ${peak.toFixed(1)})`,
		peak <= 6.05
	);
	page.check(
		`${label}: after the burst, background work stays within 4 s (peak ${latePeak.toFixed(1)})`,
		latePeak <= 4.05
	);
	results[label] = sent;
	return sent;
}

const results = {};

export default async function run(page) {
	await page.addInitScript(WRAP);
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await page.click("#connect button[type=submit]");
	const fresh = await watch(page, "fresh");
	const fetched = new Set(
		fresh
			.filter((s) => command(s.line) === "CHATHISTORY LATEST")
			.map((s) => s.line.split(" ")[3])
	);
	// The open channel at once; its modes and marker (4 s) once the burst has
	// drained (6 s); then one channel per 4 s.
	const expected = Math.min(N, 1 + Math.floor((WAIT / 1000 - 10) / 4));
	page.check(
		`fresh: catch-up keeps coming (${fetched.size} of ${N} channels in ${
			WAIT / 1000
		} s, expected ≥ ${expected})`,
		fetched.size >= expected
	);

	// Drop the socket; the page reconnects on its own.
	await page.evaluate("window.__wire.length = 0, window.__socks.at(-1).close(), 1");
	const again = await watch(page, "reconnect");
	const asked = again
		.filter((s) => /^MARKREAD \S+$/.test(s.line))
		.map((s) => s.line.split(" ")[1]);
	const answered = new Set(
		fresh.filter((s) => /^MARKREAD \S+$/.test(s.line)).map((s) => s.line.split(" ")[1])
	);
	// A reconnect after busy channels moved on, so the catch-up pages back
	// with CHATHISTORY BEFORE. Off by default: the dev ircd keeps only the
	// first ten or so lines of the helper's burst (measured 2026-10-19: 11
	// of 250, from an oper), so the gap never reaches a second page there.
	// `SEANCE_FAKELAG_BUSY=<lines per channel>` runs it against an ircd that
	// does not.
	const BUSY = Number(process.env.SEANCE_FAKELAG_BUSY ?? 0);

	if (BUSY > 0) {
		await page.evaluate("window.__offline = true, window.__socks.at(-1).close(), 1");
		await seed(CHANS.slice(0, 4), BUSY);
		await page.evaluate(
			"window.__wire.length = 0, window.__offline = false, dispatchEvent(new Event('online')), 1"
		);
		await watch(page, "busy");
	}

	const {writeFileSync} = await import("node:fs");
	writeFileSync(`${page.outDir}/connect-fakelag.json`, JSON.stringify(results));

	page.check(
		`reconnect: no marker asked again (${
			asked.filter((c) => answered.has(c)).join(", ") || "none"
		})`,
		asked.every((c) => !answered.has(c))
	);
}
