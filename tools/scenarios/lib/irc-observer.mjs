// A second IRC connection for scenarios that need to see what OTHER users
// (and the server) see: it records every line, answers PING, and can ask
// WHOIS / WHO / METADATA about someone. Optionally logs in with SASL PLAIN,
// to stand in for another device of the same account.
//
//   const obs = await observe("ws://127.0.0.1:8067/", "watcher", {caps: ["away-notify"]});
//   await obs.waitFor((l) => / AWAY /.test(l), 5000);
//   await obs.whois("someone")  // → {away: "lunch" | null, exists: boolean}
//   await obs.who("someone")    // → "H" | "G" | null
//
// Node's global WebSocket (Node >= 22), the text.ircv3.net subprotocol.

export async function observe(url, nick, {caps = [], sasl = null, join = null} = {}) {
	const ws = new WebSocket(url, ["text.ircv3.net"]);
	const lines = [];
	const waiters = new Set();
	const send = (line) => ws.send(line);

	ws.addEventListener("message", (ev) => {
		const line = String(ev.data);
		lines.push({at: Date.now(), line});

		if (line.startsWith("PING")) {
			send(line.replace(/^PING/, "PONG"));
		}

		for (const w of [...waiters]) {
			if (w.pred(line)) {
				waiters.delete(w);
				w.resolve(line);
			}
		}
	});

	const waitFor = (pred, ms = 10000, label = "line") =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (waiters.delete(w)) {
					reject(new Error(`observer ${nick}: timed out waiting for ${label}`));
				}
			}, ms);
			const w = {
				pred,
				resolve(line) {
					clearTimeout(timer);
					resolve(line);
				},
			};
			waiters.add(w);
		});

	/** A nick as a literal inside a RegExp. */
	const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, {once: true});
		ws.addEventListener("error", () => reject(new Error(`observer ${nick}: cannot connect`)), {
			once: true,
		});
	});

	const want = [...caps, ...(sasl ? ["sasl"] : [])];

	if (want.length) {
		send("CAP LS 302");
	}

	send(`NICK ${nick}`);
	send(`USER ${nick} 0 * :${nick}`);

	if (want.length) {
		send(`CAP REQ :${want.join(" ")}`);
		await waitFor((l) => / CAP \S+ (ACK|NAK) /.test(l), 10000, "CAP ACK");

		if (sasl) {
			send("AUTHENTICATE PLAIN");
			await waitFor((l) => l.startsWith("AUTHENTICATE +"), 10000, "AUTHENTICATE +");
			const blob = Buffer.from(`${sasl.account}\0${sasl.account}\0${sasl.password}`).toString(
				"base64"
			);
			send(`AUTHENTICATE ${blob}`);
			const result = await waitFor((l) => / 90[3-7] /.test(l), 15000, "SASL result");

			// Only 903 is a login: going on unauthenticated would fail later
			// checks for a misleading reason.
			if (!/ 903 /.test(result)) {
				ws.close();
				throw new Error(`observer ${nick}: SASL failed: ${result}`);
			}
		}

		send("CAP END");
	}

	await waitFor((l) => / 001 /.test(l), 15000, "001");
	// A login that attaches to a held bouncer session gets no MOTD: wait for
	// one briefly, then go on.
	await waitFor((l) => / (376|422) /.test(l), sasl ? 4000 : 15000, "end of MOTD").catch(() => {
		if (!sasl) {
			throw new Error(`observer ${nick}: no end of MOTD`);
		}
	});

	if (join) {
		send(`JOIN ${join}`);
		await waitFor((l) => / 366 /.test(l), 10000, `366 for ${join}`);
	}

	const since = (t) => lines.filter((l) => l.at >= t).map((l) => l.line);

	return {
		nick,
		lines,
		send,
		waitFor,
		since,
		/** AWAY lines about `who` received at or after time `t`. */
		awaysSince(who, t) {
			return since(t).filter((l) =>
				new RegExp(`^(@\\S+ )?:${literal(who)}!\\S+ AWAY( |$)`, "i").test(l)
			);
		},
		async whois(who) {
			const t = Date.now();
			send(`WHOIS ${who}`);
			await waitFor((l) => / 318 /.test(l), 10000, "318 end of WHOIS");
			const got = since(t);
			const away = got.find((l) => new RegExp(` 301 \\S+ ${literal(who)} `, "i").test(l));
			return {
				exists: !got.some((l) => / 401 /.test(l)),
				away: away ? away.slice(away.indexOf(" :", away.indexOf(" 301 ")) + 2) : null,
				lines: got,
			};
		},
		async who(who) {
			const t = Date.now();
			send(`WHO ${who}`);
			await waitFor((l) => / 315 /.test(l), 10000, "315 end of WHO");
			const row = since(t).find((l) => / 352 /.test(l));
			if (!row) {
				return null;
			}
			// :server 352 me #chan user host server nick FLAGS :hops real,
			// counted without a leading tag prefix.
			const f = row.replace(/^@\S+ /, "").split(" ")[8] ?? "";
			return f.startsWith("G") ? "G" : f.startsWith("H") ? "H" : f;
		},
		async metadataGet(target, key) {
			const t = Date.now();
			send(`METADATA ${target} GET ${key}`);
			await waitFor((l) => / (761|766|762|FAIL METADATA)/.test(l), 10000, "METADATA reply");
			await new Promise((r) => setTimeout(r, 300));
			return since(t).filter((l) => / (76\d) |FAIL METADATA/.test(l));
		},
		close() {
			try {
				send("QUIT :done");
			} catch {
				/* already gone */
			}
			ws.close();
		},
	};
}
