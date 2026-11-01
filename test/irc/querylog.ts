import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {IrcClient} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {CATCHUP_STEP_COST_MS, MARKER_HOLD_MS} from "../../client/js/irc/catchup";
import {MARKREAD_DEBOUNCE_MS} from "../../client/js/irc/handlers/markread";
import * as saved from "../../client/js/irc/saved-networks";
import {
	flushQueryLogs,
	forgetNetworkLog,
	MAX_CHARS,
	MAX_MESSAGES,
	MAX_QUERIES,
	QUERY_LOG_PREFIX,
	QueryLog,
	SAVE_DELAY_MS,
	setQueryLogEnabled,
	StorageBackend,
	useStorageBackend,
} from "../../client/js/irc/querylog";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import {ChanType} from "../../shared/types/chan";
import {MessageType, SharedMsg} from "../../shared/types/msg";

/** In-memory stand-in for the localStorage wrapper. */
class MemoryBackend implements StorageBackend {
	data = new Map<string, string>();

	get(key: string): string | null {
		return this.data.has(key) ? (this.data.get(key) as string) : null;
	}

	set(key: string, value: string): void {
		this.data.set(key, value);
	}

	remove(key: string): void {
		this.data.delete(key);
	}

	keys(): string[] {
		return [...this.data.keys()];
	}
}

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

	send(raw: string): void {
		this.sent.push(raw);
	}

	close(): void {
		this.state = "closed";
	}

	probe(): void {
		// nothing to probe
	}

	abandon(): void {
		this.state = "closed";
	}

	open(): void {
		this.state = "open";
		this.emit({type: "open", subprotocol: "text.ircv3.net"});
	}

	line(raw: string): void {
		this.emit({type: "line", line: raw});
	}

	private emit(ev: TransportEvent): void {
		for (const listener of [...this.listeners]) {
			listener(ev);
		}
	}
}

const UUID = "22222222-2222-4222-8222-222222222222";
const fold = (s: string) => s.toLowerCase();

function line(overrides: Partial<SharedMsg> = {}): SharedMsg {
	return {
		id: 1,
		time: new Date("2026-09-26T10:00:00.000Z"),
		type: MessageType.MESSAGE,
		from: {nick: "bob", mode: ""},
		text: "hi",
		...overrides,
	};
}

/** `n` lines a minute apart from 10:00, msgids m0…m(n-1). */
function lines(n: number, text = (i: number) => `line ${i}`): SharedMsg[] {
	return Array.from({length: n}, (_, i) =>
		line({
			msgid: `m${i}`,
			time: new Date(Date.UTC(2026, 8, 26, 10, i)),
			text: text(i),
		})
	);
}

describe("Query log (irc/querylog.ts)", function () {
	let backend: MemoryBackend;
	let savedBackend: MemoryBackend;
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		backend = new MemoryBackend();
		savedBackend = new MemoryBackend();
		useStorageBackend(backend);
		saved.useStorageBackend(savedBackend);
		clock = sinon.useFakeTimers({
			now: Date.UTC(2026, 8, 26, 12),
			toFake: ["setTimeout", "clearTimeout", "Date"],
		});
	});

	afterEach(function () {
		clock.restore();
		setQueryLogEnabled(true);
		useStorageBackend(null);
		saved.useStorageBackend(null);
	});

	const stored = (): unknown => JSON.parse(backend.get(QUERY_LOG_PREFIX + UUID) ?? "null");

	describe("the log", function () {
		it("keeps messages, actions and notices, writes on a trailing throttle and reads them back", function () {
			const log = new QueryLog(UUID, fold);
			log.append("Bob", line({msgid: "a", text: "hello"}));
			log.append("bob", line({msgid: "b", type: MessageType.ACTION, text: "waves"}));
			log.append("bob", line({msgid: "c", type: MessageType.NOTICE, text: "note"}));
			log.append("bob", line({msgid: "d", type: MessageType.ERROR, text: "no"}));
			log.append("bob", line({msgid: "e", type: undefined, text: "status"}));
			log.append("bob", line({msgid: "f", pending: true, text: "sending"}));

			expect(stored()).to.equal(null);
			clock.tick(SAVE_DELAY_MS);

			const again = new QueryLog(UUID, fold);
			expect(again.names()).to.deep.equal(["Bob"]);
			const back = again.messages("BOB");
			expect(back.map((m) => [m.msgid, m.type, m.text])).to.deep.equal([
				["a", MessageType.MESSAGE, "hello"],
				["b", MessageType.ACTION, "waves"],
				["c", MessageType.NOTICE, "note"],
			]);
			expect(back[0].time).to.be.an.instanceOf(Date);
			expect(back[0].from).to.deep.equal({nick: "bob", mode: ""});
			expect(back[0].previews).to.equal(undefined);
			log.dispose();
			again.dispose();
		});

		it("drops a line it already holds by msgid and keeps lines in time order", function () {
			const log = new QueryLog(UUID, fold);
			const [a, b, c] = lines(3);
			log.append("bob", c);
			log.append("bob", a); // an older page arrives later
			log.append("bob", b);
			log.append("bob", {...b, text: "again"});

			expect(log.messages("bob").map((m) => m.text)).to.deep.equal([
				"line 0",
				"line 1",
				"line 2",
			]);
			log.dispose();
		});

		it(`keeps the newest ${MAX_MESSAGES} lines of a query`, function () {
			const log = new QueryLog(UUID, fold);
			lines(MAX_MESSAGES + 5).forEach((m) => log.append("bob", m));

			const kept = log.messages("bob");
			expect(kept).to.have.length(MAX_MESSAGES);
			expect(kept[0].text).to.equal("line 5");
			log.dispose();
		});

		it(`keeps the ${MAX_QUERIES} most recently active queries`, function () {
			const log = new QueryLog(UUID, fold);

			for (let i = 0; i <= MAX_QUERIES; i++) {
				log.append(
					`nick${i}`,
					line({msgid: `q${i}`, time: new Date(Date.UTC(2026, 8, 26, 10, i))})
				);
			}

			log.flush();
			const names = new QueryLog(UUID, fold).names();
			expect(names).to.have.length(MAX_QUERIES);
			expect(names[0]).to.equal(`nick${MAX_QUERIES}`);
			expect(names).not.to.include("nick0");
			log.dispose();
		});

		it("stays inside its size budget, oldest conversation first", function () {
			const log = new QueryLog(UUID, fold);
			const long = "x".repeat(2000);

			// Two conversations of ~120 lines × 2 kB: both cannot fit.
			for (let i = 0; i < 120; i++) {
				log.append(
					"old",
					line({msgid: `o${i}`, time: new Date(Date.UTC(2026, 8, 25, 10, i)), text: long})
				);
				log.append(
					"new",
					line({msgid: `n${i}`, time: new Date(Date.UTC(2026, 8, 26, 10, i)), text: long})
				);
			}

			log.flush();
			const raw = backend.get(QUERY_LOG_PREFIX + UUID) as string;
			expect(raw.length).to.be.at.most(MAX_CHARS);
			const again = new QueryLog(UUID, fold);
			expect(again.names()).to.deep.equal(["new"]);
			expect(again.messages("new").at(-1)?.msgid).to.equal("n119");
			log.dispose();
		});

		it("folds an edit into the line it replaces and follows redactions and reactions", function () {
			const log = new QueryLog(UUID, fold);
			const [a, b] = lines(2);
			log.append("bob", a);
			log.append("bob", b);
			log.append(
				"bob",
				line({
					msgid: "e1",
					time: new Date(Date.UTC(2026, 8, 26, 11)),
					text: "line 0, fixed",
				})
			);

			log.edit("bob", "m0", "e1");
			log.react("bob", "m1", "👍", "alice", false);
			log.react("bob", "m1", "👍", "Bob", false);
			log.react("bob", "m1", "👍", "ALICE", true);

			let kept = log.messages("bob");
			expect(kept.map((m) => m.text)).to.deep.equal(["line 0, fixed", "line 1"]);
			expect(kept[0].editedAt?.toISOString()).to.equal("2026-09-26T11:00:00.000Z");
			expect(log.aliases("bob")).to.deep.equal([["e1", 0]]);
			expect(kept[1].reactions).to.deep.equal([{text: "👍", nicks: ["Bob"]}]);

			// A redaction reaches the line by its edit's msgid too.
			log.redact("bob", "e1");
			kept = log.messages("bob");
			expect(kept.map((m) => m.msgid)).to.deep.equal(["m1"]);
			log.dispose();
		});

		it("forgets a closed query, and a removed network's whole log", function () {
			const log = new QueryLog(UUID, fold);
			log.append("bob", line({msgid: "a"}));
			log.append("carol", line({msgid: "b"}));
			log.forget("BOB");
			log.flush();
			expect(new QueryLog(UUID, fold).names()).to.deep.equal(["carol"]);

			saved.save({
				uuid: UUID,
				name: "",
				host: "irc.test",
				port: 8443,
				tls: true,
				nick: "alice",
				join: "",
				sasl: "",
				saslAccount: "",
				saslPassword: "",
			});
			saved.remove(UUID);
			expect(stored()).to.equal(null);
			expect(log.names()).to.deep.equal([]);
			log.dispose();
		});

		it("switched off: deletes every kept conversation and keeps nothing more", function () {
			const log = new QueryLog(UUID, fold);
			log.append("bob", line({msgid: "a"}));
			log.flush();
			// A network no client holds right now: its log goes too.
			const other = `${QUERY_LOG_PREFIX}33333333-3333-4333-8333-333333333333`;
			backend.set(other, JSON.stringify({v: 1, queries: []}));
			backend.set("thelounge.networks", "[]");

			setQueryLogEnabled(false);
			expect(stored()).to.equal(null);
			expect(backend.get(other)).to.equal(null);
			expect(backend.get("thelounge.networks")).to.equal("[]"); // nothing else touched
			expect(log.names()).to.deep.equal([]);

			log.append("bob", line({msgid: "b"}));
			clock.tick(SAVE_DELAY_MS);
			expect(stored()).to.equal(null);
			expect(new QueryLog(UUID, fold).names()).to.deep.equal([]);

			// On again: kept from then on, nothing from while it was off.
			setQueryLogEnabled(true);
			log.append("bob", line({msgid: "c"}));
			clock.tick(SAVE_DELAY_MS);
			expect(new QueryLog(UUID, fold).messages("bob").map((m) => m.msgid)).to.deep.equal([
				"c",
			]);
			log.dispose();
		});

		it("writes nothing for a network that is not saved", function () {
			const log = new QueryLog(UUID, fold, () => false);
			log.append("bob", line({msgid: "a"}));
			clock.tick(SAVE_DELAY_MS);
			expect(stored()).to.equal(null);
			expect(log.messages("bob")).to.have.length(1);
			log.dispose();
		});
	});

	describe("in the client", function () {
		let dispatch: sinon.SinonSpy;
		let ownsSpy = false;
		const clients: IrcClient[] = [];

		beforeEach(function () {
			const current = (socket as unknown as Record<string, unknown>).dispatch;

			if ((current as {isSinonProxy?: boolean}).isSinonProxy) {
				dispatch = current as sinon.SinonSpy;
				ownsSpy = false;
			} else {
				dispatch = sinon.spy(socket, "dispatch");
				ownsSpy = true;
			}

			dispatch.resetHistory();
			saved.save({
				uuid: UUID,
				name: "",
				host: "irc.test",
				port: 8443,
				tls: true,
				nick: "alice",
				join: "#seance",
				sasl: "",
				saslAccount: "",
				saslPassword: "",
			});
		});

		afterEach(function () {
			clients.splice(0).forEach((c) => c.queryLog.dispose());

			if (ownsSpy) {
				dispatch.restore();
			}
		});

		function payloads<T>(event: string): T[] {
			return dispatch
				.getCalls()
				.filter((call) => call.args[0] === event)
				.map((call) => call.args[1] as T);
		}

		/** A client on the saved network, registered. */
		function page(caps = "message-tags server-time echo-message"): {
			client: IrcClient;
			transport: FakeTransport;
		} {
			const transport = new FakeTransport();
			const client = new IrcClient({
				uuid: UUID,
				host: "irc.test",
				port: 8443,
				tls: true,
				nick: "alice",
				join: "#seance",
				sasl: "",
				saslAccount: "",
				saslPassword: "",
				ids: new IdAllocator(),
				transportFactory: () => transport,
				highlights: () => ({keywords: [], exceptions: []}),
			});
			clients.push(client);
			client.connect();
			transport.open();
			transport.line(`:irc.test CAP * LS :${caps}`);
			transport.line(`:irc.test CAP alice ACK :${caps}`);
			transport.line(":irc.test 001 alice :Welcome");
			transport.line(":irc.test 422 alice :MOTD File is missing");
			return {client, transport};
		}

		it("brings a private conversation back after a reload, window and lines", function () {
			const first = page();
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			first.transport.line(
				"@time=2026-09-26T11:01:00.000Z;msgid=p2 :alice!a@h PRIVMSG bob :yes"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			// The page is reloaded: a new client for the same saved network.
			dispatch.resetHistory();
			const second = page();
			const network =
				payloads<{network: {channels: {name: string; type: ChanType}[]}}>("network")[0];
			expect(network.network.channels.map((c) => [c.name, c.type])).to.deep.include([
				"bob",
				ChanType.QUERY,
			]);

			const query = second.client.findChannel("bob")!;
			const more =
				payloads<{chan: number; messages: SharedMsg[]; moreAvailable: boolean}>("more");
			expect(more).to.have.length(1);
			expect(more[0].chan).to.equal(query.id);
			expect(more[0].moreAvailable).to.equal(false);
			expect(more[0].messages.map((m) => [m.text, m.self ?? false])).to.deep.equal([
				["are you there?", false],
				["yes", true],
			]);
			expect(more[0].messages.every((m) => m.id < 0)).to.equal(true);
			// Known by msgid, so a server replay of the same lines is deduplicated.
			expect(query.idOf("p1")).to.equal(more[0].messages[0].id);
		});

		it("keeps an unread private message unread across a reload, until it is read elsewhere", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			const query = first.client.findChannel("bob")!;
			first.client.open(query.id); // read it
			first.client.open(first.client.lobby.id);
			first.transport.line(
				"@time=2026-09-26T11:05:00.000Z;msgid=p2 :bob!b@h PRIVMSG alice :hello?"
			);
			expect(query.shared.unread).to.equal(1);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			dispatch.resetHistory();
			const second = page(caps);
			const restored = second.client.findChannel("bob")!;
			expect(restored.shared.unread, "p2 was never read").to.equal(1);
			expect(restored.shared.highlight).to.equal(1);
			expect(payloads<{chan: number; unread: number}>("markread").pop()).to.include({
				chan: restored.id,
				unread: 1,
			});

			// The server is asked for the query's marker, behind the channels,
			// and lowers the count: p2 was read on another device.
			clock.tick(CATCHUP_STEP_COST_MS * 10);
			expect(second.transport.sent).to.include("MARKREAD bob");
			second.transport.line(":irc.test MARKREAD bob timestamp=2026-09-26T11:05:00.000Z");
			expect(restored.shared.unread).to.equal(0);
		});

		it("still asks for a query's read marker when it is opened with nobody looking", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			first.transport.line(
				"@time=2026-09-26T11:01:00.000Z;msgid=p2 :carol!c@h PRIVMSG alice :hi"
			);
			first.transport.line(
				"@time=2026-09-26T11:02:00.000Z;msgid=p3 :dave!d@h PRIVMSG alice :hey"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			// The markers go out as the fake-lag clock has room; dave's waits.
			const second = page(caps);
			const dave = second.client.findChannel("dave")!;
			expect(second.transport.sent).not.to.include("MARKREAD dave");

			// A cold start on a deep link with the page hidden: the open reads nothing.
			second.client.setAttended(false);
			second.client.open(dave.id);
			expect(dave.shared.unread).to.equal(1);

			clock.tick(CATCHUP_STEP_COST_MS * 10);
			expect(second.transport.sent).to.include("MARKREAD bob");
			expect(second.transport.sent).to.include("MARKREAD dave");
		});
		it("queues no marker fetch for a server without read markers, and spends no slot", function () {
			const caps =
				"message-tags server-time echo-message batch labeled-response draft/chathistory=100";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			const second = page(caps);
			expect(second.client.findChannel("bob")!.shared.unread).to.equal(1);
			clock.tick(CATCHUP_STEP_COST_MS * 2);
			expect(second.transport.sent.filter((l) => l.startsWith("MARKREAD"))).to.deep.equal([]);

			// The JOIN echoes after the slot a marker would have taken: the
			// channel's catch-up goes out on it, held behind nothing.
			const n = second.transport.sent.length;
			second.transport.line(":alice!a@h JOIN #seance");
			expect(second.transport.sent.slice(n).some((l) => l.includes("CHATHISTORY"))).to.equal(
				true
			);
		});

		it("asks for a query's marker once per connection, however often autojoin runs", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			const second = page(caps);
			clock.tick(CATCHUP_STEP_COST_MS * 10);
			const asked = () => second.transport.sent.filter((l) => l === "MARKREAD bob").length;
			expect(asked()).to.equal(1);

			// A held session's restoration runs autojoin() again, seconds later.
			second.client.autojoin();
			clock.tick(CATCHUP_STEP_COST_MS * 10);
			expect(asked()).to.equal(1);
		});

		it("asks at once for the marker of a query a late replay leaves unread", function () {
			const caps =
				"message-tags server-time echo-message batch labeled-response draft/chathistory=100 draft/read-marker draft/persistence";
			const h = page(caps);
			h.transport.line(":alice!a@h JOIN #seance");
			clock.tick(10 * 60 * 1000); // the queue drained long ago
			const n = h.transport.sent.length;
			h.transport.line(":irc.test BATCH +r evilnet.github.io/bouncer-replay");
			h.transport.line("@batch=r :irc.test BATCH +c chathistory bob");
			h.transport.line(
				"@batch=c;time=2026-09-26T11:02:00.000Z;msgid=p2 :bob!b@h PRIVMSG alice :hello?"
			);
			h.transport.line(":irc.test BATCH -c");
			h.transport.line(":irc.test BATCH -r");
			expect(h.client.findChannel("bob")!.shared.unread).to.equal(1);
			expect(h.transport.sent.slice(n), "no slot to wait for").to.include("MARKREAD bob");
		});

		it("a query opened with someone looking keeps its fetch, which then has nothing to lower", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			first.transport.line(
				"@time=2026-09-26T11:01:00.000Z;msgid=p2 :carol!c@h PRIVMSG alice :hi"
			);
			first.transport.line(
				"@time=2026-09-26T11:02:00.000Z;msgid=p3 :dave!d@h PRIVMSG alice :hey"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			const second = page(caps);
			const dave = second.client.findChannel("dave")!;
			expect(second.transport.sent).not.to.include("MARKREAD dave");
			second.client.open(dave.id);
			expect(dave.shared.unread).to.equal(0);
			clock.tick(CATCHUP_STEP_COST_MS * 10);
			expect(second.transport.sent.filter((l) => l === "MARKREAD dave")).to.deep.equal([]);
		});
		it("a query's marker never holds up a channel's catch-up", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			const second = page(caps);
			const sent = second.transport.sent;
			expect(sent).to.include("JOIN #seance");
			expect(sent, "held until the JOIN echoes").not.to.include("MARKREAD bob");

			// The channel's catch-up goes out on its echo, whatever the
			// query's marker has spent of the clock.
			second.transport.line(":alice!a@h JOIN #seance");
			expect(sent).to.include("MARKREAD #seance");
			expect(sent.indexOf("MARKREAD #seance")).to.be.lessThan(
				sent.indexOf("MARKREAD bob") === -1 ? Infinity : sent.indexOf("MARKREAD bob")
			);

			clock.tick(CATCHUP_STEP_COST_MS * 10);
			expect(sent.filter((l) => l === "MARKREAD bob")).to.have.length(1);
		});
		it("asks for a query's marker after MARKER_HOLD_MS when a JOIN never echoes", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			// #seance's JOIN is refused: no echo ever releases the hold.
			const second = page(caps);
			second.transport.line(":irc.test 474 alice #seance :Cannot join channel (+b)");
			clock.tick(MARKER_HOLD_MS - 1);
			expect(second.transport.sent).not.to.include("MARKREAD bob");
			clock.tick(1);
			expect(second.transport.sent).to.include("MARKREAD bob");
		});

		it("keeps a query read here read across a reload on a server without read markers", function () {
			const first = page();
			first.client.open(first.client.announceChannel("bob", ChanType.QUERY).id);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			first.transport.line(
				"@time=2026-09-26T11:01:00.000Z;msgid=p2 :bob!b@h PRIVMSG alice :hi"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			const bob = page().client.findChannel("bob")!;
			expect(bob.shared.unread).to.equal(0);
			expect(bob.shared.highlight).to.equal(0);
		});

		it("marks a query read before registration once the connection registers", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			const transport = new FakeTransport();
			const second = new IrcClient({
				uuid: UUID,
				host: "irc.test",
				port: 8443,
				tls: true,
				nick: "alice",
				join: "#seance",
				sasl: "",
				saslAccount: "",
				saslPassword: "",
				ids: new IdAllocator(),
				transportFactory: () => transport,
				highlights: () => ({keywords: [], exceptions: []}),
			});
			clients.push(second);
			// The reloaded page lands on the query once the network is
			// announced, before its socket registers.
			second.connect();
			const bob = second.findChannel("bob")!;
			second.open(bob.id);
			transport.open();
			transport.line(`:irc.test CAP * LS :${caps}`);
			transport.line(`:irc.test CAP alice ACK :${caps}`);
			clock.tick(MARKREAD_DEBOUNCE_MS);
			expect(transport.sent.filter((l) => l.startsWith("MARKREAD"))).to.deep.equal([]);
			transport.line(":irc.test 001 alice :Welcome");
			transport.line(":irc.test 422 alice :MOTD File is missing");
			expect(transport.sent).to.include("MARKREAD bob timestamp=2026-09-26T11:00:00.000Z");
			clock.tick(SAVE_DELAY_MS);
			second.queryLog.dispose();

			expect(page(caps).client.findChannel("bob")!.shared.unread).to.equal(0);
		});

		it("keeps a private message read as it arrived read across a reload", function () {
			const caps = "message-tags server-time echo-message draft/read-marker";
			const first = page(caps);
			first.client.open(first.client.announceChannel("bob", ChanType.QUERY).id);
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :are you there?"
			);
			clock.tick(SAVE_DELAY_MS);
			first.client.queryLog.dispose();

			const second = page(caps);
			expect(second.client.findChannel("bob")!.shared.unread).to.equal(0);
		});

		it("follows an edit and a reaction in a query, and forgets a closed one", function () {
			const first = page();
			first.transport.line(
				"@time=2026-09-26T11:00:00.000Z;msgid=p1 :bob!b@h PRIVMSG alice :helo"
			);
			first.transport.line(
				"@time=2026-09-26T11:00:05.000Z;msgid=p2;+seance/edit=p1 :bob!b@h PRIVMSG alice :hello"
			);
			first.transport.line("@+draft/react=👋;+draft/reply=p1 :alice!a@h TAGMSG bob");
			clock.tick(SAVE_DELAY_MS);

			const log = new QueryLog(UUID, fold);
			const kept = log.messages("bob");
			expect(kept.map((m) => m.text)).to.deep.equal(["hello"]);
			expect(kept[0].reactions).to.deep.equal([{text: "👋", nicks: ["alice"]}]);
			log.dispose();

			first.client.removeChannel(first.client.findChannel("bob")!);
			clock.tick(SAVE_DELAY_MS);
			expect(stored()).to.equal(null);
		});
	});
});

describe("Query log storage edges (irc/querylog.ts)", function () {
	/** Counts writes, so "nothing changed" can be told from "wrote the same". */
	class CountingBackend extends MemoryBackend {
		sets = 0;

		set(key: string, value: string): void {
			this.sets++;
			super.set(key, value);
		}
	}

	const KEY = QUERY_LOG_PREFIX + UUID;
	let backend: CountingBackend;
	let clock: sinon.SinonFakeTimers;
	let logs: QueryLog[];

	const open = (persist?: () => boolean): QueryLog => {
		const log = new QueryLog(UUID, fold, persist);
		logs.push(log);
		return log;
	};

	const raw = (): any => JSON.parse(backend.get(KEY) ?? "null");

	const write = (queries: unknown, v: unknown = 1): void => {
		backend.data.set(KEY, JSON.stringify({v, queries}));
	};

	beforeEach(function () {
		backend = new CountingBackend();
		useStorageBackend(backend);
		logs = [];
		clock = sinon.useFakeTimers({
			now: Date.UTC(2026, 8, 26, 12),
			toFake: ["setTimeout", "clearTimeout", "Date"],
		});
	});

	afterEach(function () {
		logs.forEach((l) => l.dispose());
		clock.restore();
		setQueryLogEnabled(true);
		useStorageBackend(null);
	});

	describe("what a line keeps", function () {
		it("stores every field of a line and reads exactly those back", function () {
			const log = open();
			log.append(
				"bob",
				line({
					msgid: "full",
					self: true,
					highlight: true,
					replyTo: "r0",
					editedAt: new Date("2026-09-26T10:05:00.000Z"),
					fromAccount: "bobacct",
					reactions: [{text: "👍", nicks: ["carol"]}],
					previews: [],
				})
			);
			log.append(
				"bob",
				line({
					msgid: undefined,
					from: undefined,
					time: new Date("2026-09-26T10:01:00.000Z"),
					text: "bare",
				})
			);
			log.flush();

			expect(raw().queries[0].messages).to.deep.equal([
				{
					msgid: "full",
					time: "2026-09-26T10:00:00.000Z",
					type: MessageType.MESSAGE,
					text: "hi",
					nick: "bob",
					self: true,
					highlight: true,
					replyTo: "r0",
					editedAt: "2026-09-26T10:05:00.000Z",
					fromAccount: "bobacct",
					reactions: [{text: "👍", nicks: ["carol"]}],
				},
				{time: "2026-09-26T10:01:00.000Z", type: MessageType.MESSAGE, text: "bare"},
			]);

			const back = open().messages("bob");
			expect(back).to.deep.equal([
				{
					id: 0,
					time: new Date("2026-09-26T10:00:00.000Z"),
					type: MessageType.MESSAGE,
					text: "hi",
					users: [],
					msgid: "full",
					from: {nick: "bob", mode: ""},
					self: true,
					highlight: true,
					replyTo: "r0",
					editedAt: new Date("2026-09-26T10:05:00.000Z"),
					fromAccount: "bobacct",
					reactions: [{text: "👍", nicks: ["carol"]}],
				},
				{
					id: 0,
					time: new Date("2026-09-26T10:01:00.000Z"),
					type: MessageType.MESSAGE,
					text: "bare",
					users: [],
				},
			]);
		});

		it("reads a line back from memory with no keys it does not have", function () {
			const log = open();
			log.append("bob", line({msgid: undefined, from: undefined, text: "bare"}));
			expect(log.messages("bob")).to.deep.equal([
				{
					id: 0,
					time: new Date("2026-09-26T10:00:00.000Z"),
					type: MessageType.MESSAGE,
					text: "bare",
					users: [],
				},
			]);
		});

		it("copies reactions, so a later change to the message does not reach the log", function () {
			const log = open();
			const msg = line({msgid: "a", reactions: [{text: "👍", nicks: ["carol"]}]});
			log.append("bob", msg);
			msg.reactions![0].nicks.push("dave");
			const back = log.messages("bob");
			expect(back[0].reactions).to.deep.equal([{text: "👍", nicks: ["carol"]}]);
			back[0].reactions![0].nicks.push("erin");
			expect(log.messages("bob")[0].reactions).to.deep.equal([
				{text: "👍", nicks: ["carol"]},
			]);
		});

		it("keeps no line whose time is not a time, and no line without text", function () {
			const log = open();
			log.append("bob", line({msgid: "a", time: "not a time" as unknown as Date}));
			log.append("bob", line({msgid: "b", text: undefined as unknown as string}));
			log.append("bob", line({msgid: "c", time: "2026-09-26T09:00:00.000Z" as any}));
			expect(log.messages("bob").map((m) => m.msgid)).to.deep.equal(["c"]);
		});
	});

	describe("what it reads from storage", function () {
		const good = {time: "2026-09-26T10:00:00.000Z", type: "message", text: "ok"};

		it("reads nothing from an empty, foreign-version or broken log", function () {
			for (const value of ["", "{", "null", "[]", '"x"']) {
				backend.data.set(KEY, value);
				expect(open().names(), value).to.deep.equal([]);
			}

			write([{name: "bob", touched: 1, messages: [good]}], 2);
			expect(open().names()).to.deep.equal([]);
			write({name: "bob", touched: 1, messages: [good]});
			expect(open().names()).to.deep.equal([]);
		});

		it("drops a query without a name or a message list, keeps the rest", function () {
			write([
				{touched: 3, messages: [good]},
				{name: 7, touched: 3, messages: [good]},
				{name: "nolist", touched: 3, messages: "x"},
				null,
				{name: "bob", touched: 2, messages: [good]},
			]);
			const log = open();
			expect(log.names()).to.deep.equal(["bob"]);
			expect(log.messages("bob").map((m) => m.text)).to.deep.equal(["ok"]);
		});

		it("drops a line that is not one, keeps the good ones", function () {
			write([
				{
					name: "bob",
					touched: 1,
					messages: [
						null,
						"line",
						{...good, time: 0},
						{...good, time: "garbage"},
						{time: good.time, text: "no type"},
						{time: good.time, type: "message"},
						{...good, type: 1},
						{...good, text: 5},
						good,
					],
				},
			]);
			expect(open().messages("bob")).to.deep.equal([
				{
					id: 0,
					time: new Date(good.time),
					type: "message",
					text: "ok",
					users: [],
				},
			]);
		});

		it("orders queries by their newest line, whatever order they were stored in", function () {
			write([
				{name: "mid", touched: 2, messages: [good]},
				{name: "old", touched: 1, messages: [good]},
				{name: "new", touched: 3, messages: [good]},
				{name: "none", touched: "late", messages: [good]},
			]);
			const log = open();
			expect(log.names()).to.deep.equal(["new", "mid", "old", "none"]);
			expect(log.newestAt("mid")).to.equal(2);
			expect(log.newestAt("none")).to.equal(0);
		});

		it("knows nothing of a query it does not hold", function () {
			const log = open();
			expect(log.messages("nobody")).to.deep.equal([]);
			expect(log.aliases("nobody")).to.deep.equal([]);
			expect(log.newestAt("nobody")).to.equal(undefined);
			expect(log.readUpTo("nobody")).to.equal(undefined);
			log.setRead("nobody", new Date());
			log.edit("nobody", "a", "b");
			log.redact("nobody", "a");
			log.react("nobody", "a", "👍", "bob", false);
			log.forget("nobody");
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(0);
		});

		it("reads a log written before read points were kept, and moves its read point", function () {
			write([{name: "bob", touched: 5, messages: [good]}]);
			const log = open();
			expect(log.readUpTo("bob")).to.equal(undefined);
			log.setRead("bob", new Date(1000));
			expect(log.readUpTo("bob")?.getTime()).to.equal(1000);
			log.flush();
			expect(raw().queries[0].read).to.equal(1000);
			expect(open().readUpTo("bob")?.getTime()).to.equal(1000);
		});

		it("reads a stored read point back, and a new query starts read at nothing", function () {
			write([{name: "bob", touched: 5, read: 4, messages: [good]}]);
			const log = open();
			expect(log.readUpTo("bob")?.getTime()).to.equal(4);
			log.append("carol", line({msgid: "c"}));
			expect(log.readUpTo("carol")?.getTime()).to.equal(0);
		});

		it("only ever moves a read point forward, and writes only when it moves", function () {
			write([{name: "bob", touched: 5, read: 4000, messages: [good]}]);
			const log = open();
			log.setRead("bob", new Date(4000));
			log.setRead("bob", new Date(3000));
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(0);
			expect(log.readUpTo("bob")?.getTime()).to.equal(4000);
			log.setRead("bob", new Date(5000));
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(1);
		});
	});

	describe("changes", function () {
		it("writes once for a burst of lines, on the trailing edge", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			clock.tick(SAVE_DELAY_MS / 2);
			log.append("bob", line({msgid: "b"}));
			clock.tick(SAVE_DELAY_MS / 2 - 1);
			expect(backend.sets).to.equal(0);
			clock.tick(1);
			expect(backend.sets).to.equal(1);
			expect(raw().queries[0].messages).to.have.length(2);
			clock.tick(SAVE_DELAY_MS * 3);
			expect(backend.sets).to.equal(1);
		});

		it("flush writes only what is pending", function () {
			const log = open();
			log.flush();
			expect(backend.sets).to.equal(0);
			log.append("bob", line({msgid: "a"}));
			log.flush();
			expect(backend.sets).to.equal(1);
			log.flush();
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(1);
		});

		it("clearing calls off a pending write", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			clock.tick(500);
			log.clear();
			clock.tick(100);
			log.append("bob", line({msgid: "b"}));
			clock.tick(400); // the first write would have been due now
			expect(backend.get(KEY)).to.equal(null);
			clock.tick(600);
			expect(raw().queries[0].messages.map((m: {msgid: string}) => m.msgid)).to.deep.equal([
				"b",
			]);
		});

		it(`keeps exactly ${MAX_MESSAGES} lines when it has exactly that many`, function () {
			const log = open();
			lines(MAX_MESSAGES).forEach((m) => log.append("bob", m));
			const kept = log.messages("bob");
			expect(kept).to.have.length(MAX_MESSAGES);
			expect(kept[0].text).to.equal("line 0");
		});

		it("cuts a lone conversation too big for the budget from its old end", function () {
			const log = open();
			const long = "x".repeat(2000);

			for (let i = 0; i < 180; i++) {
				log.append(
					"bob",
					line({msgid: `b${i}`, time: new Date(Date.UTC(2026, 8, 26, 9, i)), text: long})
				);
			}

			log.flush();
			const value = backend.get(KEY);
			expect(value).to.be.a("string");
			expect(value!.length).to.be.at.most(MAX_CHARS);
			const kept = open().messages("bob");
			expect(kept.length).to.be.within(100, 150);
			expect(kept.at(-1)?.msgid).to.equal("b179");
		});

		it("writes no conversation that has no lines left, and removes the key when none has", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			log.append("carol", line({msgid: "c"}));
			log.flush();
			log.redact("bob", "a");
			log.flush();
			expect(raw().queries.map((q: {name: string}) => q.name)).to.deep.equal(["carol"]);
			expect(open().names()).to.deep.equal(["carol"]);
			log.redact("carol", "c");
			log.flush();
			expect(backend.get(KEY)).to.equal(null);
		});

		it("an edit, a redaction and a reaction are written", function () {
			const log = open();
			const [a, b] = lines(2);
			log.append("bob", a);
			log.append("bob", b);
			log.append(
				"bob",
				line({msgid: "e1", time: new Date(Date.UTC(2026, 8, 26, 11)), text: "fixed"})
			);
			log.flush();

			log.edit("bob", "m0", "e1");
			clock.tick(SAVE_DELAY_MS);
			let again = open();
			expect(again.messages("bob").map((m) => m.text)).to.deep.equal(["fixed", "line 1"]);
			expect(again.aliases("bob")).to.deep.equal([["e1", 0]]);

			log.react("bob", "m1", "👍", "carol", false);
			clock.tick(SAVE_DELAY_MS);
			again = open();
			expect(again.messages("bob")[1].reactions).to.deep.equal([
				{text: "👍", nicks: ["carol"]},
			]);

			log.redact("bob", "m1");
			clock.tick(SAVE_DELAY_MS);
			expect(
				open()
					.messages("bob")
					.map((m) => m.msgid)
			).to.deep.equal(["m0"]);
		});

		it("an edit it cannot place changes nothing", function () {
			const log = open();
			const [a, b] = lines(2);
			log.append("bob", a);
			log.append("bob", b);
			log.flush();
			const sets = backend.sets;

			log.edit("bob", "m0", "missing");
			log.edit("bob", "missing", "m1");
			log.edit("bob", "m0", "m0");
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(sets);
			expect(log.messages("bob").map((m) => [m.msgid, m.text])).to.deep.equal([
				["m0", "line 0"],
				["m1", "line 1"],
			]);
			expect(log.aliases("bob")).to.deep.equal([]);
		});

		it("a redaction of a line it does not hold changes nothing", function () {
			const log = open();
			lines(2).forEach((m) => log.append("bob", m));
			log.flush();
			const sets = backend.sets;
			log.redact("bob", "missing");
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(sets);
			expect(log.messages("bob").map((m) => m.msgid)).to.deep.equal(["m0", "m1"]);
		});

		it("keeps each reaction apart, each nick once, and drops a reaction nobody holds", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			log.flush();
			const sets = backend.sets;

			log.react("bob", "missing", "👍", "carol", false);
			log.react("bob", "a", "👍", "carol", true); // nothing to take off
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(sets);
			expect(log.messages("bob")[0].reactions).to.equal(undefined);

			log.react("bob", "a", "👍", "carol", false);
			log.react("bob", "a", "🎉", "dave", false);
			log.react("bob", "a", "👍", "erin", false);
			log.react("bob", "a", "👍", "CAROL", false); // already there
			log.react("bob", "a", "🎉", "nobody", true); // not among its nicks
			expect(log.messages("bob")[0].reactions).to.deep.equal([
				{text: "👍", nicks: ["carol", "erin"]},
				{text: "🎉", nicks: ["dave"]},
			]);

			log.react("bob", "a", "🎉", "Dave", true);
			log.flush();
			expect(raw().queries[0].messages[0].reactions).to.deep.equal([
				{text: "👍", nicks: ["carol", "erin"]},
			]);
			log.react("bob", "a", "👍", "carol", true);
			log.react("bob", "a", "👍", "erin", true);
			log.flush();
			expect(raw().queries[0].messages[0]).not.to.have.property("reactions");
		});

		it("forgetting a query it does not hold forgets nothing", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			log.append("carol", line({msgid: "b", time: new Date(Date.UTC(2026, 8, 26, 11))}));
			log.flush();
			const sets = backend.sets;
			log.forget("nobody");
			clock.tick(SAVE_DELAY_MS);
			expect(backend.sets).to.equal(sets);
			expect(log.names()).to.deep.equal(["carol", "bob"]);
			log.forget("CAROL");
			expect(log.names()).to.deep.equal(["bob"]);
		});
	});

	describe("every log at once", function () {
		const OTHER = "33333333-3333-4333-8333-333333333333";

		it("flushQueryLogs writes every pending log now", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			flushQueryLogs();
			expect(raw().queries[0].name).to.equal("bob");
		});

		it("a disposed log writes what was pending and is no longer flushed with the rest", function () {
			const log = new QueryLog(UUID, fold);
			log.append("bob", line({msgid: "a"}));
			log.dispose();
			expect(backend.sets).to.equal(1);
			log.append("bob", line({msgid: "b"}));
			flushQueryLogs();
			expect(backend.sets).to.equal(1);
			log.flush(); // its own timer still stands; leave nothing behind
		});

		it("forgetting one network's log leaves another network's alone", function () {
			const mine = open();
			const theirs = new QueryLog(OTHER, fold);
			logs.push(theirs);
			mine.append("bob", line({msgid: "a"}));
			theirs.append("carol", line({msgid: "b"}));
			flushQueryLogs();

			forgetNetworkLog(UUID);
			expect(mine.names()).to.deep.equal([]);
			expect(backend.get(KEY)).to.equal(null);
			expect(theirs.names()).to.deep.equal(["carol"]);
			expect(backend.get(QUERY_LOG_PREFIX + OTHER)).to.be.a("string");
		});

		it("forgetting a network no live log holds removes its stored log", function () {
			// A uuid no QueryLog in this run was ever made for.
			const key = `${QUERY_LOG_PREFIX}44444444-4444-4444-8444-444444444444`;
			backend.data.set(key, JSON.stringify({v: 1, queries: []}));
			forgetNetworkLog("44444444-4444-4444-8444-444444444444");
			expect(backend.get(key)).to.equal(null);
		});

		it("switching it on deletes nothing", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			log.flush();
			setQueryLogEnabled(true);
			expect(log.names()).to.deep.equal(["bob"]);
			expect(raw().queries[0].name).to.equal("bob");
		});

		it("switched off over a backend that cannot list its keys, still clears the live logs", function () {
			const log = open();
			log.append("bob", line({msgid: "a"}));
			log.flush();
			const bare: StorageBackend = {
				get: (k) => backend.get(k),
				set: (k, v) => backend.set(k, v),
				remove: (k) => backend.remove(k),
			};
			useStorageBackend(bare);
			expect(() => setQueryLogEnabled(false)).not.to.throw();
			expect(backend.get(KEY)).to.equal(null);
		});
	});
});
