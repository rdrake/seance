/**
 * Attention → `AWAY *` (client/js/irc/presence.ts).
 *
 * A hidden page tells the server it is unattended with `AWAY *`
 * (`draft/pre-away`: away for an unspecified reason, per connection), a
 * page that comes back sends `AWAY`; a `/away` the user set is left alone;
 * an unattended page marks nothing read, and the return of attention
 * marks the open channel read.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {IrcClient} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {registerBusHandlers} from "../../client/js/irc/bus";
import {dispatchInput} from "../../client/js/irc/commands";
import {MARKREAD_DEBOUNCE_MS} from "../../client/js/irc/handlers/markread";
import {AWAY_STAR} from "../../client/js/irc/presence";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import {NO_FAKE_LAG} from "../../client/js/irc/fakelag";
import {setup, type Harness as SupportHarness} from "./support";

class FakeTransport implements Transport {
	state: TransportState = "closed";
	sent: string[] = [];
	private listeners: ((ev: TransportEvent) => void)[] = [];

	on(listener: (ev: TransportEvent) => void): () => void {
		this.listeners.push(listener);

		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	connect(): void {
		this.state = "connecting";
	}

	send(line: string): void {
		if (this.state !== "open") {
			throw new Error("WsTransport: not open");
		}

		this.sent.push(line);
	}

	close(): void {
		this.state = "closed";
	}

	open(): void {
		this.state = "open";
		this.emit({type: "open", subprotocol: "text.ircv3.net"});
	}

	line(line: string): void {
		this.emit({type: "line", line});
	}

	lines(...lines: string[]): void {
		lines.forEach((line) => this.line(line));
	}

	private emit(ev: TransportEvent): void {
		for (const listener of [...this.listeners]) {
			listener(ev);
		}
	}
}

const CAPS = "server-time message-tags batch labeled-response draft/read-marker";

interface Harness {
	client: IrcClient;
	transport: FakeTransport;
	sent(): string[];
}

function connect(opts: {attended?: boolean} = {}): Harness {
	const transport = new FakeTransport();
	const dispatch = sinon.spy();
	const client = new IrcClient({
		bus: {dispatch},
		host: "irc.test",
		port: 8443,
		tls: true,
		nick: "alice",
		join: "#seance",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
		uuid: "presence-net",
		ids: new IdAllocator(),
		transportFactory: () => transport,
		highlights: () => ({keywords: [], exceptions: []}),
		fakeLag: NO_FAKE_LAG,
	});
	let mark = 0;

	if (opts.attended === false) {
		client.setAttended(false); // hidden before it connected: nothing can be sent yet
	}

	client.connect();
	transport.open();
	transport.line(`:irc.test CAP * LS :${CAPS}`);
	const req = transport.sent.find((l) => l.startsWith("CAP REQ :"));
	expect(req, "CAP REQ sent").to.be.a("string");
	transport.line(`:irc.test CAP alice ACK :${(req as string).slice("CAP REQ :".length)}`);
	transport.lines(
		":irc.test 001 alice :Welcome to the SeanceDev IRC Network, alice",
		":irc.test 005 alice CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,l,imnpst CASEMAPPING=rfc1459 :are supported by this server",
		":irc.test 422 alice :MOTD File is missing"
	);
	registerBusHandlers(socket, {
		clientForChannel: (chanId) => (client.channelById(chanId) ? client : undefined),
		clientForNetwork: (uuid) => (uuid === client.uuid ? client : undefined),
		allClients: () => [client],
		createNetwork: () => client,
		remove: () => undefined,
	});
	mark = transport.sent.length;

	return {
		client,
		transport,
		sent() {
			const result = transport.sent.slice(mark);
			mark = transport.sent.length;
			return result;
		},
	};
}

/** JOIN #seance confirmed; the automatic history request answered empty. */
function joined(h: Harness): number {
	h.transport.lines(
		"@time=2026-08-25T12:00:00.000Z;msgid=join-1 :alice!alice@host JOIN #seance alice :Alice",
		":irc.test 353 alice = #seance :@alice bob",
		":irc.test 366 alice #seance :End of /NAMES list."
	);
	const label = h
		.sent()
		.find((l) => l.includes("CHATHISTORY"))
		?.match(/^@label=([^ ;]+)/)?.[1];
	h.transport.line(
		`${label ? `@label=${label} ` : ""}:irc.test BATCH +hist1 chathistory #seance`
	);
	h.transport.line(":irc.test BATCH -hist1");
	h.sent();
	return h.client.findChannel("#seance")!.id;
}

function live(h: Harness, minute: number): void {
	const mm = String(minute).padStart(2, "0");
	h.transport.line(
		`@time=2026-08-25T12:${mm}:00.000Z;msgid=m${minute} :bob!bob@host PRIVMSG #seance :message ${minute}`
	);
}

describe("attention and AWAY * (presence.ts)", function () {
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		clock = sinon.useFakeTimers({
			now: new Date("2026-08-25T12:10:00.000Z"),
			toFake: ["setTimeout", "clearTimeout", "Date"],
		});
	});

	afterEach(function () {
		clock.restore();
		sinon.restore();
		socket.removeAllListeners();
	});

	it("says AWAY * when the page is hidden and AWAY when it comes back", function () {
		const h = connect();
		h.client.setAttended(false);
		expect(h.sent()).to.deep.equal([`AWAY ${AWAY_STAR}`]);
		h.client.setAttended(false); // no repeat
		expect(h.sent()).to.deep.equal([]);
		h.client.setAttended(true);
		expect(h.sent()).to.deep.equal(["AWAY"]);
		h.client.setAttended(true);
		expect(h.sent()).to.deep.equal([]);
	});

	it("leaves a /away the user set alone, and clears nothing it did not set", function () {
		const h = connect();
		dispatchInput(h.client, h.client.lobby, "/away lunch");
		expect(h.sent()).to.deep.equal(["AWAY :lunch"]);
		h.client.setAttended(false);
		expect(h.sent(), "the user's away stands").to.deep.equal([]);
		h.client.setAttended(true);
		expect(h.sent(), "and is not cleared by attention").to.deep.equal([]);
		dispatchInput(h.client, h.client.lobby, "/back");
		expect(h.sent()).to.deep.equal(["AWAY"]);
		h.client.setAttended(false);
		expect(h.sent(), "automatic again after /back").to.deep.equal([`AWAY ${AWAY_STAR}`]);
	});

	it("a page hidden while it connects says AWAY * once registered", function () {
		const h = connect({attended: false});
		expect(h.transport.sent.filter((l) => l === `AWAY ${AWAY_STAR}`)).to.have.length(1);
		h.client.setAttended(true);
		expect(h.sent()).to.deep.equal(["AWAY"]);
	});

	it("marks nothing read while unattended, and the open channel when attention returns", function () {
		const h = connect();
		const chanId = joined(h);
		socket.emit("open", chanId);
		clock.tick(MARKREAD_DEBOUNCE_MS);
		h.sent(); // MODE + the marker for the JOIN row

		h.client.setAttended(false);
		expect(h.sent()).to.deep.equal([`AWAY ${AWAY_STAR}`]);
		live(h, 1);
		live(h, 2);
		clock.tick(MARKREAD_DEBOUNCE_MS * 2);
		expect(h.sent(), "a hidden page read nothing").to.deep.equal([]);

		h.client.setAttended(true);
		clock.tick(MARKREAD_DEBOUNCE_MS);
		expect(h.sent()).to.deep.equal([
			"AWAY",
			"MARKREAD #seance timestamp=2026-08-25T12:02:00.000Z",
		]);
	});

	it("prints nothing for the replies to its own AWAY * and AWAY, but still for the user's", function () {
		const h = connect();
		const lobby = h.client.lobby;
		const before = lobby.shared.totalMessages;

		h.client.setAttended(false);
		h.sent();
		h.transport.line(":irc.seance.test 306 alice :You have been marked as being away");
		expect(lobby.shared.totalMessages, "306 for AWAY * is noise").to.equal(before);

		h.client.setAttended(true);
		h.sent();
		h.transport.line(":irc.seance.test 305 alice :You are no longer marked as being away");
		expect(lobby.shared.totalMessages, "305 for the automatic AWAY is noise").to.equal(before);

		// The self away-notify echo of a star (another connection of the
		// account) is the same signal: silent.
		h.transport.line(":alice!alice@host AWAY :*");
		expect(lobby.shared.totalMessages).to.equal(before);

		dispatchInput(h.client, h.client.lobby, "/away lunch");
		h.sent();
		h.transport.line(":irc.seance.test 306 alice :You have been marked as being away");
		expect(lobby.shared.totalMessages, "the user's own /away is acknowledged").to.equal(
			before + 1
		);
	});

	it("shows another user's AWAY * as away without a reason, and says nothing about it", function () {
		const h = connect();
		joined(h);
		h.transport.line(":bob!bob@host PRIVMSG alice :hi");
		const query = h.client.findChannel("bob")!;
		const before = query.shared.totalMessages;
		h.transport.line(":bob!bob@host AWAY :*");
		const chan = h.client.findChannel("#seance")!;
		expect(chan.findUser("bob")?.away, "the star is not a reason to display").to.equal("");
		expect(query.shared.totalMessages, "a star is not news in the query").to.equal(before);
		h.transport.line(":bob!bob@host AWAY :lunch");
		expect(query.shared.totalMessages, "a real away is").to.equal(before + 1);
	});
});

/**
 * `draft/pre-away`: a hidden page says `AWAY *` before registration, where
 * it costs no fake lag, and nefarious2 (d9f806d) keeps it as the
 * connection's own state on the fresh path and across a held session's
 * revive. A revive keeps the ghost's away when the new socket declared
 * none, so a page that is back after leaving the session starred clears it
 * after 001.
 */
describe("pre-registration AWAY * (draft/pre-away)", function () {
	const PRE_AWAY_CAPS = `${CAPS} draft/pre-away`;
	const WELCOME = [
		":irc.test 001 alice :Welcome to the SeanceDev IRC Network, alice",
		":irc.test 005 alice CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,l,imnpst CASEMAPPING=rfc1459 :are supported by this server",
		":irc.test 422 alice :MOTD File is missing",
	];

	afterEach(function () {
		sinon.restore();
	});

	/** Open the socket and answer CAP LS: the registration flush. */
	function negotiate(h: SupportHarness, caps: string): string[] {
		h.client.connect();
		h.transport.open();
		h.transport.line(`:irc.test CAP * LS :${caps}`);
		return h.sent();
	}

	/** ACK the flush's REQ. */
	function ack(h: SupportHarness, flush: string[]): void {
		const req = flush.find((l) => l.startsWith("CAP REQ :"))!;
		h.transport.line(`:irc.test CAP alice ACK :${req.slice("CAP REQ :".length)}`);
	}

	/** 001 to the end of the MOTD: what went out after registration. */
	function welcome(h: SupportHarness): string[] {
		h.transport.lines(...WELCOME);
		return h.sent();
	}

	function register(h: SupportHarness, caps: string): string[] {
		const flush = negotiate(h, caps);
		ack(h, flush);
		return [...flush, ...welcome(h)];
	}

	function hiddenClient(): SupportHarness {
		const h = setup({join: ""});
		h.client.setAttended(false);
		return h;
	}

	it("requests the cap", function () {
		const h = setup({join: ""});
		const req = negotiate(h, PRE_AWAY_CAPS).find((l) => l.startsWith("CAP REQ :"))!;
		expect(req.slice("CAP REQ :".length).split(" ")).to.include("draft/pre-away");
	});

	it("a hidden page says AWAY * right after CAP REQ, before CAP END, and again after 001", function () {
		const h = hiddenClient();
		const flush = negotiate(h, PRE_AWAY_CAPS);
		expect(flush.map((l) => l.split(" ").slice(0, 2).join(" "))).to.deep.equal([
			"CAP LS",
			"NICK alice",
			"USER alice",
			"CAP REQ",
			"AWAY *",
			"CAP END",
		]);
		ack(h, flush);
		// Said again after 001 for a server before nefarious2 d9f806d, which
		// offers the cap but loses it on a revive: its reply stays quiet.
		expect(welcome(h)).to.deep.equal(["AWAY *"]);
		expect(h.client.presence.starSent).to.equal(true);
		expect(h.client.presence.quietReplies).to.equal(1);
		h.client.setAttended(true);
		expect(h.sent()).to.deep.equal(["AWAY"]);
	});

	it("goes ahead of the SASL opener, not after the exchange", function () {
		const h = setup({join: "", sasl: "plain", saslAccount: "alice", saslPassword: "s3cret"});
		h.client.setAttended(false);
		const flush = negotiate(h, `${PRE_AWAY_CAPS} sasl=PLAIN`);
		const tail = flush.slice(flush.findIndex((l) => l.startsWith("CAP REQ :")));
		expect(tail.map((l) => l.split(" ")[0])).to.deep.equal(["CAP", "AWAY", "AUTHENTICATE"]);
		expect(tail[1]).to.equal("AWAY *");
		ack(h, flush);
		h.transport.line("AUTHENTICATE +");
		h.sent();
		h.transport.lines(
			":irc.test 900 alice alice!alice@host alice :You are now logged in as alice",
			":irc.test 903 alice :SASL authentication successful"
		);
		expect(h.sent()).to.deep.equal(["CAP END"]);
		expect(welcome(h)).to.deep.equal(["AWAY *"]);
	});

	it("an attended page says nothing before CAP END or after 001", function () {
		const h = setup({join: ""});
		expect(register(h, PRE_AWAY_CAPS).filter((l) => l.startsWith("AWAY"))).to.deep.equal([]);
	});

	it("a page that comes back during registration takes the AWAY * back after 001", function () {
		const h = hiddenClient();
		const flush = negotiate(h, PRE_AWAY_CAPS);
		expect(flush).to.include("AWAY *");
		ack(h, flush);
		h.client.setAttended(true); // not registered: nothing can be sent yet
		expect(h.sent()).to.deep.equal([]);
		expect(welcome(h)).to.deep.equal(["AWAY"]);
		expect(h.client.presence.starSent).to.equal(false);
	});

	it("says AWAY * after 001 when the cap was not enabled after all", function () {
		const h = hiddenClient();
		const flush = negotiate(h, PRE_AWAY_CAPS);
		const req = flush.find((l) => l.startsWith("CAP REQ :"))!;
		// The whole REQ refused: the server read our AWAY * without the cap
		// and dropped it. The one-at-a-time retries go out after CAP END.
		h.transport.line(`:irc.test CAP alice NAK :${req.slice("CAP REQ :".length)}`);
		const retries = h.sent();
		expect(retries).to.include("CAP REQ :draft/pre-away");
		expect(retries).to.not.include("AWAY *");
		h.transport.line(":irc.test CAP alice ACK :draft/pre-away");
		expect(welcome(h)).to.deep.equal(["AWAY *"]);
	});

	it("a server without the cap gets AWAY * after 001, as before", function () {
		const h = hiddenClient();
		const all = register(h, CAPS);
		expect(all.filter((l) => l.startsWith("AWAY"))).to.deep.equal(["AWAY *"]);
		expect(all.indexOf("AWAY *")).to.be.greaterThan(all.indexOf("CAP END"));
	});

	describe("a held session revived", function () {
		const HELD_CAPS = `${PRE_AWAY_CAPS} draft/persistence`;

		/** Registered, hidden (AWAY * standing), then the socket lost. */
		function starredThenDropped(caps = HELD_CAPS): SupportHarness {
			const h = setup({join: ""});
			register(h, caps);
			h.client.setAttended(false);
			expect(h.sent()).to.deep.equal(["AWAY *"]);
			h.transport.closed();
			return h;
		}

		it("clears the star the last socket left when the page is back", function () {
			const h = starredThenDropped();
			h.client.setAttended(true); // closed: nothing to send it on
			const flush = negotiate(h, HELD_CAPS);
			expect(flush.filter((l) => l.startsWith("AWAY"))).to.deep.equal([]);
			ack(h, flush);
			expect(welcome(h)).to.deep.equal(["AWAY"]);
			// The reply to it is ours, not news.
			const lobby = h.client.lobby;
			const before = lobby.shared.totalMessages;
			h.transport.line(":irc.test 305 alice :You are no longer marked as being away");
			expect(lobby.shared.totalMessages).to.equal(before);
		});

		it("says it again before CAP END when the page is still hidden", function () {
			const h = starredThenDropped();
			const flush = negotiate(h, HELD_CAPS);
			expect(flush.filter((l) => l.startsWith("AWAY"))).to.deep.equal(["AWAY *"]);
			ack(h, flush);
			expect(welcome(h)).to.deep.equal(["AWAY *"]);
			expect(h.client.presence.starSent).to.equal(true);
		});

		it("leaves the user's own /away to the revive", function () {
			const h = setup({join: ""});
			register(h, HELD_CAPS);
			h.client.setAttended(false);
			dispatchInput(h.client, h.client.lobby, "/away lunch");
			h.sent();
			h.transport.closed();
			h.client.setAttended(true);
			expect(register(h, HELD_CAPS).filter((l) => l.startsWith("AWAY"))).to.deep.equal([]);
		});

		it("sends nothing to a server that holds no sessions", function () {
			const h = starredThenDropped(PRE_AWAY_CAPS);
			h.client.setAttended(true);
			expect(register(h, PRE_AWAY_CAPS).filter((l) => l.startsWith("AWAY"))).to.deep.equal(
				[]
			);
		});

		it("clears it only once", function () {
			const h = starredThenDropped();
			h.client.setAttended(true);
			register(h, HELD_CAPS);
			h.transport.closed();
			expect(register(h, HELD_CAPS).filter((l) => l.startsWith("AWAY"))).to.deep.equal([]);
		});
	});
});
