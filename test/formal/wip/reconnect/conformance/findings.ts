/**
 * Failing tests for the Seance findings of the reconnect / STS model
 * (../DECISIONS.md, F1-F3 and F5). Each fails on 4f5a4bd12 (and evilnet
 * develop ef782edf1) and should pass once the finding is fixed.
 *
 * Skipped unless SEANCE_RECONNECT_FINDINGS=1, so `pnpm test` stays green:
 *
 *   SEANCE_RECONNECT_FINDINGS=1 NODE_ENV=test npx mocha --config=test/.mocharc.yml \
 *     test/formal/wip/reconnect/conformance/findings.ts
 *
 * They drive the real WsTransport with a fake WebSocket (the retries are
 * the point), so they are not FakeTransport tests like test/irc/sts.ts.
 */
import {expect} from "chai";
import sinon from "sinon";
import storage from "../../../../../client/js/localStorage";
import {IrcClient} from "../../../../../client/js/irc/client";
import {IdAllocator} from "../../../../../client/js/irc/ids";
import {NO_FAKE_LAG} from "../../../../../client/js/irc/fakelag";
import {WsTransport, type TransportOptions} from "../../../../../client/js/irc/transport";
import * as sts from "../../../../../client/js/irc/sts";

const T0 = 1_700_000_000_000;
const HOST = "irc.example.org";

class WS {
	static all: WS[] = [];
	readonly OPEN = 1;
	readyState = 0;
	protocol = "";
	binaryType = "";
	sent: string[] = [];
	private h = new Map<string, ((e: unknown) => void)[]>();

	constructor(public url: string) {
		WS.all.push(this);
	}

	addEventListener(t: string, f: (e: unknown) => void): void {
		this.h.set(t, [...(this.h.get(t) ?? []), f]);
	}

	send(line: string): void {
		this.sent.push(line);
	}

	close(): void {
		this.readyState = 2;
	}

	fire(t: string, e: unknown): void {
		(this.h.get(t) ?? []).forEach((f) => f(e));
	}

	open(): void {
		this.readyState = 1;
		this.protocol = "text.ircv3.net";
		this.fire("open", {});
	}

	line(l: string): void {
		this.fire("message", {data: l});
	}

	drop(): void {
		this.readyState = 3;
		this.fire("close", {code: 1006, reason: "", wasClean: false});
	}
}

function network(port: number, tls: boolean): IrcClient {
	return new IrcClient({
		host: HOST, port, tls, nick: "alice", join: "", sasl: "", saslAccount: "", saslPassword: "",
		ids: new IdAllocator(), bus: {dispatch: () => undefined}, fakeLag: NO_FAKE_LAG,
		transportFactory: (o: TransportOptions) => new WsTransport({...o, WebSocketImpl: WS as never}),
	});
}

const run = process.env.SEANCE_RECONNECT_FINDINGS === "1" ? describe : describe.skip;

run("formal/reconnect findings (failing until fixed)", function () {
	const data = new Map<string, string>();
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		sinon.stub(storage, "get").callsFake((k: string) => data.get(k) ?? null);
		sinon.stub(storage, "set").callsFake((k: string, v: string) => void data.set(k, v));
		sinon.stub(storage, "remove").callsFake((k: string) => void data.delete(k));
		sinon.stub(Math, "random").returns(0.999999);
		clock = sinon.useFakeTimers({now: T0});
		WS.all = [];
	});

	afterEach(function () {
		clock.restore();
		sinon.restore();
		data.clear();
	});

	// F1 (sts.md:53): every dial to a host with a valid policy is secure,
	// including the transport's own timer retry.
	it("F1: a plain network's automatic retry honours a policy another network learned", function () {
		const plain = network(8067, false);
		plain.connect();
		WS.all[0].open();
		WS.all[0].line(":srv CAP * LS :multi-prefix");

		const secure = network(8443, true);
		secure.connect();
		WS.all[1].open();
		WS.all[1].line(":srv CAP * LS :sts=duration=3600");
		expect(sts.getPolicy(HOST)).to.not.equal(undefined);

		WS.all[0].drop();
		clock.tick(5000);

		const retry = WS.all[2];
		expect(retry, "the plain network retried").to.not.equal(undefined);
		expect(retry.url).to.match(/^wss:\/\/irc\.example\.org:8443\//);
	});

	// F2 (sts.md:67, capability-negotiation.md:69-72): after reading the
	// upgrade policy, the insecure connection carries nothing but QUIT; in
	// particular no CAP END, which would let the server register us there.
	it("F2: an insecure LS with sts=port= is answered by the upgrade alone", function () {
		const plain = network(8067, false);
		plain.connect();
		WS.all[0].open();
		const before = WS.all[0].sent.length;
		WS.all[0].line(":srv CAP * LS :multi-prefix sts=port=8443");
		const after = WS.all[0].sent.slice(before);

		expect(WS.all[1]?.url).to.match(/^wss:\/\/irc\.example\.org:8443\//);
		expect(after.filter((l) => !l.startsWith("QUIT"))).to.deep.equal([]);
	});

	// F3 (sts.md:111-113): the close reschedules the expiry to close time +
	// duration, also when the expiry passed during the connection.
	it("F3: a policy whose expiry passed during the connection is rescheduled at the close", function () {
		const secure = network(8443, true);
		secure.connect();
		WS.all[0].open();
		WS.all[0].line(":srv CAP * LS :sts=duration=60");
		clock.tick(120_000);
		WS.all[0].drop();

		const policy = sts.getPolicy(HOST);
		expect(policy, "policy kept").to.not.equal(undefined);
		expect(policy!.expiresAt).to.equal(T0 + 120_000 + 60_000);
	});

	// F5 (Seance's own goal, irc-layer.md "The retry schedule"): the long
	// wait after unreached dials is meant to let IPcheck's 40 s window lapse.
	// Two networks on one address (or two tabs) interleave their 42-47 s
	// waits so that no gap exceeds 40 s, and with nefarious2's default
	// IPCHECK_COUNT_REFUSALS every refusal renews the window: neither gets
	// back in. The fake server here refuses as IPcheck.c:282-345 does.
	it("F5: two networks on one address get back in after IPcheck refused them", function () {
		const ip = {last: -1, chain: 0};
		const live = new Set<WS>();
		const nets = [network(8443, true), network(8443, true)];
		const now = () => Math.round((Date.now() - T0) / 1000);
		const seen = new Set<WS>();
		let opened = 0;

		const pump = () => {
			for (const ws of WS.all) {
				if (seen.has(ws)) {
					continue;
				}

				seen.add(ws);
				const t = now();
				const chain = ip.last >= 0 && t - ip.last <= 40 ? ip.chain + 1 : 1;
				ip.last = t;
				ip.chain = chain;

				if (chain >= 4) {
					ws.drop();
				} else {
					ws.open();
					live.add(ws);
					opened++;
				}
			}
		};

		nets[0].connect();
		nets[1].connect();
		pump();
		clock.tick(1000);

		// Both drop a second in: the retries pile up within the window.
		for (const ws of [...live]) {
			live.delete(ws);
			ws.drop();
		}

		for (let s = 0; s < 20; s++) {
			clock.tick(1000);
			pump();
		}

		for (const ws of [...live]) {
			live.delete(ws);
			ip.last = now();
			ws.drop();
		}

		const before = opened;

		for (let s = 0; s < 600; s++) {
			clock.tick(1000);
			pump();
		}

		expect(opened - before, "connections that got back in within 10 minutes").to.be.at.least(1);
	});
});
