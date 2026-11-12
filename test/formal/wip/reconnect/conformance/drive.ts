/**
 * Reconnect / STS trace recording for the formal model (../DECISIONS.md D14).
 *
 * Drives Seance's own IrcClient and WsTransport — a fake WebSocket, a fake
 * server, fake timers, Math.random pinned to the high end of every jitter —
 * through the scenarios below, and writes one JSON line per scenario:
 * the server's starting advertisement and the events in the model's
 * vocabulary (dial, ls, upgrade, drop, throttle, disconnect, new, env, poke),
 * each with its time in seconds and, where the step can change it, the raw
 * policy store entry for the host after it. trace_check.py checks each one
 * against model/StsReconnect.tla with TLC.
 *
 * Skipped unless SEANCE_RECONNECT_DRIVE=1, so `pnpm test` never runs it:
 *
 *   SEANCE_RECONNECT_DRIVE=1 NODE_ENV=test npx mocha --config=test/.mocharc.yml \
 *     test/formal/wip/reconnect/conformance/drive.ts
 *
 * Writes results/seance-<sha>.jsonl next to this file.
 */
import {execSync} from "child_process";
import {mkdirSync, writeFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import sinon from "sinon";
import storage from "../../../../../client/js/localStorage";
import {IrcClient} from "../../../../../client/js/irc/client";
import {IdAllocator} from "../../../../../client/js/irc/ids";
import {NO_FAKE_LAG} from "../../../../../client/js/irc/fakelag";
import {WsTransport, type TransportOptions} from "../../../../../client/js/irc/transport";
import {STORAGE_KEY} from "../../../../../client/js/irc/sts";

const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = 1_700_000_000_000;
const HOST = "irc.example.org";
const PORTS: Record<number, string> = {8067: "P", 8443: "S1", 9443: "S2"};

type Pol = {has: boolean; port?: string; exp?: number};
type Ev = Record<string, unknown> & {k: string; t: number};

class Server {
	up = true;
	secUp = new Set<number>([8443, 9443]);
	upg: number | undefined;
	dur: number | undefined;
	ipOn = false;
	ipLimit = 4;
	window = 40;
	countRefusals = true;
	ip = {last: -1, chain: 0};
}

/** One socket: the transport attaches its listeners after the constructor. */
class FakeWS {
	readonly OPEN = 1;
	readyState = 0;
	protocol = "";
	binaryType = "";
	sent: string[] = [];
	closedByClient = false;
	closeFired = false;
	private h = new Map<string, ((e: unknown) => void)[]>();

	constructor(public url: string, public net: string, private d: Drive) {
		d.pending.push(this);
	}

	addEventListener(t: string, f: (e: unknown) => void): void {
		this.h.set(t, [...(this.h.get(t) ?? []), f]);
	}

	send(line: string): void {
		this.sent.push(line);
	}

	close(): void {
		if (this.readyState < 2) {
			this.readyState = 2;
			this.closedByClient = true;
			this.d.closing.push(this);
		}
	}

	fire(t: string, e: unknown): void {
		(this.h.get(t) ?? []).forEach((f) => f(e));
	}

	fireClose(code: number): void {
		if (!this.closeFired) {
			this.closeFired = true;
			this.readyState = 3;
			this.fire("close", {code, reason: "", wasClean: code === 1000});
		}
	}
}

class Drive {
	srv = new Server();
	events: Ev[] = [];
	pending: FakeWS[] = [];
	closing: FakeWS[] = [];
	live = new Map<string, FakeWS>();
	clients = new Map<string, IrcClient>();
	plain = new Set<string>();
	dialHow: string | undefined;
	init: Record<string, unknown>;

	constructor(public clock: sinon.SinonFakeTimers, public data: Map<string, string>) {
		this.init = {};
	}

	get t(): number {
		return Math.round((Date.now() - T0) / 1000);
	}

	pol(): Pol {
		const raw = this.data.get(STORAGE_KEY);
		const entry = raw ? (JSON.parse(raw) as Record<string, {port: number; expiresAt: number}>)[HOST] : undefined;
		return entry
			? {has: true, port: PORTS[entry.port], exp: Math.round((entry.expiresAt - T0) / 1000)}
			: {has: false};
	}

	ev(k: string, extra: Record<string, unknown> = {}, withPol = false): void {
		this.events.push({k, t: this.t, ...extra, ...(withPol ? {pol: this.pol()} : {})});
	}

	start(): void {
		this.init = {upg: this.srv.upg ? PORTS[this.srv.upg] : "none", dur: this.srv.dur ?? -1,
			secUp: [...this.srv.secUp].map((p) => PORTS[p]), up: this.srv.up};
	}

	network(name: string, tls: boolean): IrcClient {
		const port = tls ? 8443 : 8067;

		if (!tls) {
			this.plain.add(name);
		}

		const d = this;
		const client = new IrcClient({
			host: HOST, port, tls, nick: name, join: "", sasl: "", saslAccount: "", saslPassword: "",
			uuid: name, ids: new IdAllocator(), bus: {dispatch: () => undefined}, fakeLag: NO_FAKE_LAG,
			transportFactory: (o: TransportOptions) =>
				new WsTransport({
					...o,
					WebSocketImpl: class extends FakeWS {
						constructor(url: string) {
							super(url, name, d);
						}
					} as never,
				}),
		});
		this.clients.set(name, client);
		return client;
	}

	connect(name: string): void {
		this.clients.get(name)!.connect();
		this.pump();
	}

	poke(name: string): void {
		this.dialHow = "poke";
		this.clients.get(name)!.connect();
		this.pump();
		this.dialHow = undefined;
	}

	/** Resolve new sockets and closes the client asked for, in order. */
	pump(): void {
		for (;;) {
			const ws = this.pending.shift();

			if (!ws) {
				break;
			}

			const u = new URL(ws.url);
			const tls = u.protocol === "wss:";
			const port = Number(u.port);
			this.ev("dial", {n: ws.net, tls, port: PORTS[port], ...(this.dialHow ? {how: this.dialHow} : {})});
			const arrives = this.srv.up && (!tls || this.srv.secUp.has(port));
			let refused = false;

			if (arrives) {
				const t = this.t;
				const ip = this.srv.ip;
				const chain = ip.last >= 0 && t - ip.last <= this.srv.window ? ip.chain + 1 : 1;
				refused = this.srv.ipOn && chain >= this.srv.ipLimit;

				if (!refused || this.srv.countRefusals) {
					this.srv.ip = {last: t, chain};
				}
			}

			if (!arrives || refused) {
				ws.fireClose(1006);
				this.ev("result", {n: ws.net, open: false}, true);
				continue;
			}

			ws.readyState = 1;
			ws.protocol = "text.ircv3.net";
			ws.fire("open", {});
			this.live.set(ws.net, ws);
			this.ev("result", {n: ws.net, open: true}, true);
			// The CAP LS reply: what the server advertises on this kind of connection.
			const before = ws.sent.length;
			const parts = tls
				? this.srv.dur !== undefined ? [`sts=duration=${this.srv.dur}`] : []
				: this.srv.upg !== undefined ? [`sts=port=${this.srv.upg}`] : [];
			ws.fire("message", {data: `:srv CAP * LS :multi-prefix ${parts.join(" ")}`.trim()});
			const after = ws.sent.slice(before).map((l) => l.split(" ").slice(0, 2).join(" "));

			if (ws.closedByClient && !tls) {
				const sent = [...new Set(after.map((l) => (l === "CAP REQ" ? "REQ" : l === "CAP END" ? "END" : l.startsWith("QUIT") ? "QUIT" : l)))];
				this.ev("upgrade", {n: ws.net, port: PORTS[this.srv.upg!], sent}, true);
				this.live.delete(ws.net);
				ws.fireClose(1000);
			} else {
				this.ev("ls", {n: ws.net}, true);
			}
		}

		for (;;) {
			const ws = this.closing.shift();

			if (!ws) {
				break;
			}

			ws.fireClose(1000);
		}
	}

	ipcheckClosed(name: string): void {
		const others = [...this.live.keys()].filter((k) => k !== name);

		if (others.length === 0) {
			this.srv.ip = {...this.srv.ip, last: this.t};
		}
	}

	drop(name: string, kind: "drop" | "throttle" = "drop"): void {
		const ws = this.live.get(name)!;

		if (kind === "throttle") {
			ws.fire("message", {data: "ERROR :Your host is trying to (re)connect too fast -- throttled"});
		}

		this.ipcheckClosed(name);
		this.live.delete(name);
		ws.fireClose(1006);
		this.ev(kind, {n: name}, true);
		this.pump();
	}

	disconnect(name: string): void {
		const ws = this.live.get(name);
		this.clients.get(name)!.disconnect();

		if (ws) {
			this.ipcheckClosed(name);
			this.live.delete(name);
		}

		this.pump();
		this.ev("disconnect", {n: name}, true);
	}

	capNew(name: string): void {
		const ws = this.live.get(name)!;
		const tls = ws.url.startsWith("wss:");
		const v = tls ? `sts=duration=${this.srv.dur}` : `sts=port=${this.srv.upg}`;
		ws.fire("message", {data: `:srv CAP alice NEW :${v}`});
		this.ev("new", {n: name}, true);
		this.pump();
	}

	env(what: string, val: unknown): void {
		const s = this.srv;

		if (what === "dur") {
			s.dur = val as number | undefined;
		} else if (what === "upg") {
			s.upg = val as number | undefined;
		} else if (what === "net") {
			s.up = val as boolean;
		} else if (what === "port") {
			const [p, on] = val as [number, boolean];
			on ? s.secUp.add(p) : s.secUp.delete(p);
		}

		this.ev("env", {what, val: what === "port" ? [PORTS[(val as [number, boolean])[0]], (val as [number, boolean])[1]] : what === "upg" ? (val ? PORTS[val as number] : "none") : val ?? -1});
	}

	/** Timers due now (a retry at once is a 0 ms timeout), then whole seconds. */
	advance(seconds: number): void {
		this.clock.tick(0);
		this.pump();

		for (let i = 0; i < seconds; i++) {
			this.clock.tick(1000);
			this.pump();
		}
	}

	done(): Record<string, unknown> {
		return {
			init: this.init,
			nets: [...this.clients.keys()],
			plain: [...this.plain],
			ipOn: this.srv.ipOn,
			end: this.t,
			events: this.events,
		};
	}
}

type Scenario = (d: Drive) => void;

const SCENARIOS: Record<string, {expect: string; run: Scenario}> = {
	// STS-12, D5: upgrade, then the persistence policy over TLS. F2 shows in `sent`.
	upgrade: {expect: "F2", run(d) {
		d.srv.upg = 8443; d.srv.dur = 600; d.start();
		d.network("n1", false); d.connect("n1"); d.advance(2);
	}},
	// STS-8, SC-9: the secure port is down; the upgrade keeps to TLS and backs off.
	upgradeSecureFails: {expect: "F2", run(d) {
		d.srv.upg = 8443; d.srv.dur = 600; d.srv.secUp.delete(8443); d.start();
		d.network("n1", false); d.connect("n1"); d.advance(60);
	}},
	// STS-14: duration=0 over TLS removes the policy.
	durationZero: {expect: "ok", run(d) {
		d.srv.dur = 600; d.start();
		d.network("n1", true); d.connect("n1"); d.advance(10);
		d.env("dur", 0); d.drop("n1"); d.advance(5);
	}},
	// STS-10, STS-13: CAP NEW resets the expiry.
	newDuration: {expect: "ok", run(d) {
		d.srv.dur = 600; d.start();
		d.network("n1", true); d.connect("n1"); d.advance(100);
		d.env("dur", 900); d.capNew("n1"); d.advance(1);
	}},
	// STS-18: a valid policy is rescheduled at the close; SC-3: a stable connection retries at once.
	reschedule: {expect: "ok", run(d) {
		d.srv.dur = 600; d.start();
		d.network("n1", true); d.connect("n1"); d.advance(100);
		d.env("dur", undefined); d.drop("n1"); d.advance(2);
	}},
	// F3: the expiry passed during the connection; the close does not reschedule it.
	rescheduleExpired: {expect: "F3", run(d) {
		d.srv.dur = 60; d.start();
		d.network("n1", true); d.connect("n1"); d.advance(120);
		d.env("dur", undefined); d.drop("n1"); d.advance(2);
	}},
	// F1: a plain network's timer retry dials ws:// while the secure one's policy is valid.
	twoNetworks: {expect: "F1", run(d) {
		d.srv.dur = 600; d.start();
		d.network("n1", false); d.network("n2", true);
		d.connect("n1"); d.connect("n2"); d.advance(10);
		d.drop("n1"); d.advance(3);
	}},
	// SC-8: a disconnect during the wait is final.
	userFinal: {expect: "ok", run(d) {
		d.start();
		d.network("n1", true); d.connect("n1"); d.advance(5);
		d.drop("n1"); d.disconnect("n1"); d.advance(120);
	}},
	// SC-5: the server's throttle is waited out.
	throttle: {expect: "ok", run(d) {
		d.start();
		d.network("n1", true); d.connect("n1"); d.advance(5);
		d.drop("n1", "throttle"); d.advance(50);
	}},
	// SC-4: unreached dials: quick retries, then long waits; back when the network is.
	unreached: {expect: "ok", run(d) {
		d.srv.up = false; d.start();
		d.network("n1", true); d.connect("n1"); d.advance(150);
		d.env("net", true); d.advance(50);
	}},
	// SC-2: a connection that opens and drops at once backs off to the cap.
	backoff: {expect: "ok", run(d) {
		d.start();
		d.network("n1", true); d.connect("n1");

		for (let i = 0; i < 8; i++) {
			d.drop("n1");

			while (!d.live.has("n1")) {
				d.advance(1);
			}
		}
	}},
	// SC-1: the poke dials now and restarts the schedule.
	poke: {expect: "ok", run(d) {
		d.srv.up = false; d.start();
		d.network("n1", true); d.connect("n1"); d.advance(2);
		d.env("net", true); d.poke("n1"); d.advance(1);
	}},
	// F5: two dialers on one address keep IPcheck's window open for each other.
	lockout: {expect: "F5", run(d) {
		d.srv.ipOn = true; d.start();
		d.network("n1", true); d.network("n2", true);
		d.connect("n1"); d.connect("n2"); d.advance(1);
		d.drop("n1"); d.drop("n2"); d.advance(19);

		if (d.live.has("n1")) {
			d.drop("n1");
		}

		if (d.live.has("n2")) {
			d.drop("n2");
		}

		d.advance(400);
	}},
};

const run = process.env.SEANCE_RECONNECT_DRIVE === "1" ? describe : describe.skip;

run("formal/reconnect: Seance traces", function () {
	const lines: string[] = [];
	const data = new Map<string, string>();
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		sinon.stub(storage, "get").callsFake((k: string) => data.get(k) ?? null);
		sinon.stub(storage, "set").callsFake((k: string, v: string) => void data.set(k, v));
		sinon.stub(storage, "remove").callsFake((k: string) => void data.delete(k));
		sinon.stub(Math, "random").returns(0.999999);
		clock = sinon.useFakeTimers({now: T0, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]});
	});

	afterEach(function () {
		clock.restore();
		sinon.restore();
		data.clear();
	});

	for (const [name, sc] of Object.entries(SCENARIOS)) {
		it(name, function () {
			const d = new Drive(clock, data);
			sc.run(d);

			for (const c of d.clients.values()) {
				c.disconnect();
			}

			lines.push(JSON.stringify({name, expect: sc.expect, ...d.done()}));
		});
	}

	after(function () {
		const sha = execSync("git rev-parse --short HEAD", {cwd: HERE}).toString().trim();
		mkdirSync(join(HERE, "results"), {recursive: true});
		const out = join(HERE, "results", `seance-${process.env.SEANCE_SHA ?? sha}.jsonl`);
		writeFileSync(out, lines.join("\n") + "\n");
		// eslint-disable-next-line no-console
		console.log(`wrote ${out}`);
	});
});
