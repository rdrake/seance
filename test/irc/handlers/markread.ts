/**
 * Read markers (client/js/irc/handlers/markread.ts): the counters and the
 * read point an inbound marker or a history page leaves, and the MARKREAD
 * lines that go out (or do not) around reconnects.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {
	MARKREAD_DEBOUNCE_MS,
	markReadAt,
	parseMarker,
} from "../../../client/js/irc/handlers/markread";
import {ALL_CAPS, Harness, labelOf, setup, stubStorage} from "../support";

const CAPS = `${ALL_CAPS} draft/read-marker`;

interface MarkreadPayload {
	chan: number;
	firstUnread: number;
	unread: number;
	highlight: number;
}

/** Register with the read-marker cap, stopping at the end of the MOTD. */
function registered(h: Harness): void {
	h.client.connect();
	h.transport.open();
	reopenCaps(h);
	welcome(h);
	h.sent();
}

function reopenCaps(h: Harness): void {
	h.transport.line(`:irc.test CAP * LS :${CAPS}`);
	const req = h.transport.sent.filter((l) => l.startsWith("CAP REQ :")).pop()!;
	h.transport.line(`:irc.test CAP alice ACK :${req.slice("CAP REQ :".length)}`);
}

function welcome(h: Harness): void {
	h.transport.lines(
		":irc.test 001 alice :Welcome to the SeanceDev IRC Network, alice",
		":irc.test 005 alice CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,l,imnpst CASEMAPPING=rfc1459 CHATHISTORY=100 MSGREFTYPES=timestamp,msgid :are supported by this server",
		":irc.test 422 alice :MOTD File is missing"
	);
}

/** Our JOIN to #seance; returns the label of the automatic history request. */
function joinSeance(h: Harness): string | undefined {
	h.transport.lines(
		"@time=2026-08-25T12:00:00.000Z;msgid=join-1 :alice!alice@host.example JOIN #seance",
		":irc.test 353 alice = #seance :@alice bob",
		":irc.test 366 alice #seance :End of /NAMES list."
	);
	return labelOf(h.sent());
}

/** Registered and in #seance with an empty history; returns the channel id. */
function joined(h: Harness): number {
	registered(h);
	const label = joinSeance(h);
	h.transport.lines(
		`${label ? `@label=${label} ` : ""}:irc.test BATCH +hist1 chathistory #seance`,
		":irc.test BATCH -hist1"
	);
	h.dispatch.resetHistory();
	h.sent();
	return h.client.findChannel("#seance")!.id;
}

/** bob says `text` at 12:MM:SS; returns the message id. */
function live(h: Harness, mm: number, text = `message ${mm}`, ss = 0): number {
	const stamp = `2026-08-25T12:${String(mm).padStart(2, "0")}:${String(ss).padStart(
		2,
		"0"
	)}.000Z`;
	h.transport.line(`@time=${stamp};msgid=m${mm}-${ss} :bob!bob@host PRIVMSG #seance :${text}`);
	return h.lastMessage().id;
}

function marker(h: Harness, stamp: string): void {
	h.transport.line(`:irc.test MARKREAD #seance timestamp=${stamp}`);
}

const markreads = (lines: string[]) => lines.filter((l) => l.startsWith("MARKREAD"));

describe("handlers/markread.ts", function () {
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		stubStorage();
		clock = sinon.useFakeTimers({
			now: new Date("2026-08-25T12:30:00.000Z"),
			toFake: ["setTimeout", "clearTimeout", "Date"],
		});
	});

	afterEach(function () {
		clock.restore();
		sinon.restore();
		socket.removeAllListeners();
	});

	describe("parseMarker", function () {
		it("reads a timestamp with or without its key", function () {
			expect(parseMarker("timestamp=2026-08-25T12:00:00.000Z")?.toISOString()).to.equal(
				"2026-08-25T12:00:00.000Z"
			);
			expect(parseMarker("2026-08-25T12:00:00.000Z")?.toISOString()).to.equal(
				"2026-08-25T12:00:00.000Z"
			);
		});

		it("is undefined for nothing, `*` and garbage", function () {
			expect(parseMarker(undefined)).to.equal(undefined);
			expect(parseMarker("")).to.equal(undefined);
			expect(parseMarker("timestamp=")).to.equal(undefined);
			expect(parseMarker("timestamp=*")).to.equal(undefined);
			expect(parseMarker("*")).to.equal(undefined);
			expect(parseMarker("timestamp=yesterday")).to.equal(undefined);
		});
	});

	describe("an inbound marker", function () {
		it("counts only the highlights past it", function () {
			const h = setup();
			const id = joined(h);
			const chan = h.client.findChannel("#seance")!;
			live(h, 1, "alice: ping");
			live(h, 2, "plain");
			expect(chan.shared.highlight).to.equal(1);

			marker(h, "2026-08-25T12:01:30.000Z");
			expect(h.payloads<MarkreadPayload>("markread").pop()).to.include({
				chan: id,
				unread: 1,
				highlight: 0,
			});
		});

		it("reads up to the newest line at or before it, whatever order they arrived in", function () {
			const h = setup();
			joined(h);
			const chan = h.client.findChannel("#seance")!;
			const newer = live(h, 5);
			live(h, 1); // arrives later, but is older
			live(h, 20);

			marker(h, "2026-08-25T12:10:00.000Z");
			expect(chan.shared.firstUnread).to.equal(newer);
		});

		it("never moves the read point behind a line of ours it does not reach", function () {
			const h = setup();
			joined(h);
			const chan = h.client.findChannel("#seance")!;
			live(h, 1);
			live(h, 2);
			// Our own MODE is not speech: it moves firstUnread but marks nothing.
			h.transport.line(
				"@time=2026-08-25T12:03:00.000Z :alice!alice@host.example MODE #seance +v bob"
			);
			const ours = chan.shared.firstUnread;
			expect(chan.readMarker).to.equal(undefined);

			marker(h, "2026-08-25T12:01:30.000Z");
			expect(chan.shared.firstUnread).to.equal(ours);
		});

		it("is ignored inside a history replay", function () {
			const h = setup();
			joined(h);
			live(h, 1);
			h.transport.lines(
				":irc.test BATCH +r1 chathistory #seance",
				"@batch=r1 :irc.test MARKREAD #seance timestamp=2026-08-25T12:05:00.000Z",
				":irc.test BATCH -r1"
			);
			expect(h.payloads("markread")).to.deep.equal([]);
			expect(h.client.findChannel("#seance")!.readMarker).to.equal(undefined);
		});
	});

	describe("a history page", function () {
		/** Join with the server's marker at 11:30 and `lines` as the first page. */
		function withPage(h: Harness, lines: string[]): void {
			registered(h);
			const label = joinSeance(h);
			marker(h, "2026-08-25T11:30:00.000Z");
			h.dispatch.resetHistory();
			h.transport.lines(
				`${label ? `@label=${label} ` : ""}:irc.test BATCH +hist1 chathistory #seance`,
				...lines.map((l) => `@batch=hist1;${l}`),
				":irc.test BATCH -hist1"
			);
		}

		it("counts what is past the marker, not what an older line of ours precedes", function () {
			const h = setup();
			withPage(h, [
				"time=2026-08-25T11:00:00.000Z;msgid=h1 :alice!alice@host.example PRIVMSG #seance :old mine",
				"time=2026-08-25T11:10:00.000Z;msgid=h2 :bob!bob@host PRIVMSG #seance :read",
				"time=2026-08-25T11:45:00.000Z;msgid=h3 :bob!bob@host PRIVMSG #seance :unread",
			]);
			expect(h.client.findChannel("#seance")!.shared.unread).to.equal(1);
			// The marker did not move: nothing of ours is past it.
			expect(h.payloads("inbox:read")).to.deep.equal([]);
		});

		it("with nothing past the marker says nothing", function () {
			const h = setup();
			withPage(h, [
				"time=2026-08-25T11:10:00.000Z;msgid=h2 :bob!bob@host PRIVMSG #seance :alice: read",
			]);
			expect(h.payloads("markread")).to.deep.equal([]);
			expect(h.payloads("inbox:add")).to.deep.equal([]);
		});

		it("adds no inbox entry when nothing past the marker mentions us", function () {
			const h = setup();
			withPage(h, [
				"time=2026-08-25T11:45:00.000Z;msgid=h3 :bob!bob@host PRIVMSG #seance :hi",
			]);
			expect(h.payloads("inbox:add")).to.deep.equal([]);
			expect(h.payloads<MarkreadPayload>("markread")).to.have.length(1);
		});

		it("leaves the lines it counted for a later marker to recount", function () {
			const h = setup();
			withPage(h, [
				"time=2026-08-25T11:45:00.000Z;msgid=h3 :bob!bob@host PRIVMSG #seance :alice: one",
				"time=2026-08-25T11:50:00.000Z;msgid=h4 :bob!bob@host PRIVMSG #seance :alice: two",
			]);
			const chan = h.client.findChannel("#seance")!;
			expect(chan.shared.unread).to.equal(2);
			expect(chan.shared.highlight).to.equal(2);

			marker(h, "2026-08-25T11:46:00.000Z");
			expect(chan.shared.unread).to.equal(1);
			expect(chan.shared.highlight).to.equal(1);
		});
	});

	describe("outbound", function () {
		it("a marker sent once is not sent again by the next registration", function () {
			const h = setup();
			const id = joined(h);
			live(h, 1);
			h.client.open(id);
			clock.tick(MARKREAD_DEBOUNCE_MS);
			expect(markreads(h.sent())).to.deep.equal([
				"MARKREAD #seance timestamp=2026-08-25T12:01:00.000Z",
			]);

			h.transport.event({
				type: "close",
				code: 1006,
				reason: "",
				wasClean: false,
				willReconnect: true,
			});
			h.transport.open();
			reopenCaps(h);
			welcome(h);
			const out = [...h.sent(), ...markreads(h.transport.sent)];
			expect(out.filter((l) => l.startsWith("MARKREAD #seance timestamp="))).to.have.length(
				1
			);
		});

		it("holds a marker that comes due before 001", function () {
			const h = setup();
			const id = joined(h);
			live(h, 1);
			h.transport.event({
				type: "close",
				code: 1006,
				reason: "",
				wasClean: false,
				willReconnect: true,
			});
			h.transport.open();
			reopenCaps(h);
			h.sent();
			h.client.open(id);
			clock.tick(MARKREAD_DEBOUNCE_MS);
			expect(markreads(h.sent())).to.deep.equal([]);
			welcome(h);
			expect(markreads(h.sent())).to.deep.equal([
				"MARKREAD #seance timestamp=2026-08-25T12:01:00.000Z",
			]);
		});

		describe("markReadAt (a notification's Mark read)", function () {
			it("replaces the pending debounced send", function () {
				const h = setup();
				const id = joined(h);
				live(h, 1);
				h.client.open(id);
				markReadAt(h.client, "#seance", new Date("2026-08-25T12:05:00.000Z"));
				clock.tick(MARKREAD_DEBOUNCE_MS * 3);
				expect(markreads(h.sent())).to.deep.equal([
					"MARKREAD #seance timestamp=2026-08-25T12:05:00.000Z",
				]);
			});

			it("sends nothing for a time already marked", function () {
				const h = setup();
				joined(h);
				marker(h, "2026-08-25T12:05:00.000Z");
				markReadAt(h.client, "#seance", new Date("2026-08-25T12:01:00.000Z"));
				expect(markreads(h.sent())).to.deep.equal([]);
			});

			it("sends nothing for the lobby", function () {
				const h = setup();
				joined(h);
				markReadAt(h.client, h.client.lobby.name, new Date("2026-08-25T12:05:00.000Z"));
				expect(markreads(h.sent())).to.deep.equal([]);
			});

			it("leaves nothing for the next registration to send", function () {
				const h = setup();
				joined(h);
				markReadAt(h.client, "#seance", new Date("2026-08-25T12:05:00.000Z"));
				h.sent();
				h.transport.event({
					type: "close",
					code: 1006,
					reason: "",
					wasClean: false,
					willReconnect: true,
				});
				h.transport.open();
				reopenCaps(h);
				welcome(h);
				expect(
					markreads(h.sent()).filter((l) => l.startsWith("MARKREAD #seance timestamp="))
				).to.deep.equal([]);
			});
		});
	});
});
