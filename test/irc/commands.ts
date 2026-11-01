import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import storage from "../../client/js/localStorage";
import {IrcClient, IrcClientOptions} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {commandNames} from "../../client/js/irc/commands";
import {
	loadAliases,
	MAX_ALIASES,
	MAX_BODY_LENGTH,
	MAX_NAME_LENGTH,
	saveAliases,
} from "../../client/js/helpers/aliases";
import eventbus from "../../client/js/eventbus";
import {splitTarget} from "../../client/js/irc/commands/target";
import {ignoreListFor} from "../../client/js/ignore";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import {ChanType, SpecialChanType} from "../../shared/types/chan";
import {MessageType, SharedMsg} from "../../shared/types/msg";
import type {SharedNetworkChan} from "../../shared/types/network";

/** In-memory transport driven by the tests (same shape as test/irc/client.ts). */
class FakeTransport implements Transport {
	state: TransportState = "closed";
	sent: string[] = [];
	connectCalls = 0;
	connectOpts: ({force?: boolean} | undefined)[] = [];
	closeCalls: {code: number; reason: string}[] = [];
	private listeners: ((ev: TransportEvent) => void)[] = [];

	on(listener: (ev: TransportEvent) => void): () => void {
		this.listeners.push(listener);

		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	connect(opts?: {force?: boolean}): void {
		this.connectCalls++;
		this.connectOpts.push(opts);
		this.state = "connecting";
	}

	send(line: string): void {
		if (this.state !== "open") {
			throw new Error("WsTransport: not open");
		}

		this.sent.push(line);
	}

	close(code = 1000, reason = ""): void {
		this.closeCalls.push({code, reason});
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

	closed(code: number, reason = ""): void {
		this.state = "closed";
		this.emit({
			type: "close",
			code,
			reason,
			wasClean: code === 1000,
			willReconnect: false,
			delayMs: undefined,
		});
	}

	private emit(ev: TransportEvent): void {
		for (const listener of [...this.listeners]) {
			listener(ev);
		}
	}
}

interface Harness {
	client: IrcClient;
	transport: FakeTransport;
	sentAfter(): string[];
}

/** Bus spy the client under test dispatches to (not the app bus, so this
 * file can run alongside test/irc/client.ts, which spies on that one). */
let dispatch: sinon.SinonSpy;
let uuidCounter = 0;

function setup(overrides: Partial<IrcClientOptions> = {}): Harness {
	const transport = new FakeTransport();
	const client = new IrcClient({
		bus: {dispatch},
		host: "irc.test",
		port: 8443,
		tls: true,
		nick: "alice",
		join: "#seance key",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
		// A fresh uuid per test keeps the (module-cached) ignore lists apart.
		uuid: `test-net-${++uuidCounter}`,
		ids: new IdAllocator(),
		transportFactory: () => transport,
		highlights: () => ({keywords: [], exceptions: []}),
		...overrides,
	});
	let mark = 0;

	return {
		client,
		transport,
		sentAfter() {
			const result = transport.sent.slice(mark);
			mark = transport.sent.length;
			return result;
		},
	};
}

function payloads<T = any>(event: string): T[] {
	return dispatch
		.getCalls()
		.filter((call) => call.args[0] === event)
		.map((call) => call.args[1] as T);
}

function messages(chanId?: number): SharedMsg[] {
	return payloads<{chan: number; msg: SharedMsg}>("msg")
		.filter((p) => chanId === undefined || p.chan === chanId)
		.map((p) => p.msg);
}

function lastMessage(chanId?: number): SharedMsg {
	const list = messages(chanId);
	return list[list.length - 1];
}

/** Register (with echo-message) and join #seance with a small NAMES burst. */
function joined(h: Harness, isupportExtra = "", capsExtra = ""): number {
	const ls = `echo-message multi-prefix ${capsExtra}`.trim();
	// ACK names the caps without their LS values.
	const ack = ls
		.split(" ")
		.map((cap) => cap.split("=")[0])
		.join(" ");

	h.client.connect();
	h.transport.open();
	h.transport.line(`:irc.test CAP * LS :${ls}`);
	h.transport.line(`:irc.test CAP alice ACK :${ack}`);
	h.transport.lines(
		":irc.test 001 alice :Welcome",
		`:irc.test 005 alice CHANTYPES=#& PREFIX=(ov)@+ CASEMAPPING=rfc1459 ${isupportExtra} :are supported`,
		":irc.test 422 alice :MOTD File is missing",
		":alice!alice@host.example JOIN #seance",
		":irc.test 353 alice = #seance :@alice bob +carol",
		":irc.test 366 alice #seance :End of /NAMES list."
	);
	h.sentAfter();
	return h.client.findChannel("#seance")!.id;
}

describe("irc commands", function () {
	beforeEach(function () {
		dispatch = sinon.spy();
		const data = new Map<string, string>();
		sinon.stub(storage, "get").callsFake((key: string) => data.get(key) ?? null);
		sinon
			.stub(storage, "set")
			.callsFake((key: string, value: string) => void data.set(key, value));
		sinon.stub(storage, "remove").callsFake((key: string) => void data.delete(key));
	});

	afterEach(function () {
		sinon.restore();
		socket.unhandle("network:new");
	});

	it("lists every new command for autocompletion", function () {
		const names = commandNames();

		for (const name of [
			"/alias",
			"/ban",
			"/unban",
			"/banlist",
			"/kickban",
			"/exceptlist",
			"/kick",
			"/whois",
			"/list",
			"/mode",
			"/umode",
			"/op",
			"/deop",
			"/hop",
			"/dehop",
			"/voice",
			"/devoice",
			"/notice",
			"/ctcp",
			"/ver",
			"/away",
			"/back",
			"/invite",
			"/invitelist",
			"/kill",
			"/join",
			"/j",
			"/rejoin",
			"/cycle",
			"/ignore",
			"/unignore",
			"/ignorelist",
			"/mute",
			"/unmute",
			"/disconnect",
			"/connect",
			"/server",
		]) {
			expect(names, name).to.include(name);
		}
	});

	describe("/ban family", function () {
		it("sends MODE +b / -b / b and KICK+ban for kickban", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ban *!*@evil.example");
			h.client.input(id, "/unban *!*@evil.example");
			h.client.input(id, "/banlist");
			h.client.input(id, "/kickban troll go away");
			h.client.input(id, "/kickban troll");
			h.client.input(id, "/exceptlist");
			expect(h.sentAfter()).to.deep.equal([
				"MODE #seance +b *!*@evil.example",
				"MODE #seance -b *!*@evil.example",
				"MODE #seance b",
				"KICK #seance troll :go away",
				"MODE #seance +b troll",
				"KICK #seance troll",
				"MODE #seance +b troll",
				"MODE #seance e",
			]);
		});

		it("uses the EXCEPTS mode letter for /exceptlist", function () {
			const h = setup();
			const id = joined(h, "EXCEPTS=X");
			h.client.input(id, "/exceptlist");
			expect(h.sentAfter()).to.deep.equal(["MODE #seance X"]);

			h.client.input(1, "/exceptlist");
			expect(lastMessage(1).text).to.equal(
				"exceptlist command can only be used in channels."
			);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("rejects use outside channels and missing arguments", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(1, "/ban troll");
			expect(lastMessage(1).type).to.equal(MessageType.ERROR);
			expect(lastMessage(1).text).to.equal("ban command can only be used in channels.");

			h.client.input(id, "/unban");
			expect(lastMessage(id).text).to.equal("Usage: /unban <nick>");
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/kick", function () {
		it("kicks with and without a reason, only in channels", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/kick bob");
			h.client.input(id, "/kick bob be nice");
			h.client.input(id, "/kick");
			expect(h.sentAfter()).to.deep.equal(["KICK #seance bob", "KICK #seance bob :be nice"]);

			h.client.input(1, "/kick bob");
			expect(lastMessage(1).text).to.equal("kick command can only be used in channels.");
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/whois", function () {
		it("doubles a single nick so the remote server answers with idle time", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/whois bob");
			h.client.input(id, "/whois irc.other bob");
			h.client.input(id, "/whois");
			expect(h.sentAfter()).to.deep.equal(["WHOIS bob bob", "WHOIS irc.other bob", "WHOIS"]);
		});

		it("assembles the numerics into one whois message where the user is", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test 311 alice bob ~bob host.example * :Bob Example",
				":irc.test 319 alice bob :@#seance +#other",
				":irc.test 319 alice bob :#third",
				":irc.test 312 alice bob irc.test :Test server",
				":irc.test 313 alice bob :is an IRC operator",
				":irc.test 301 alice bob :gone fishing",
				":irc.test 330 alice bob bobacct :is logged in as",
				":irc.test 338 alice bob ~real@10.0.0.1 10.0.0.1 :Actual user@host, Actual IP",
				":irc.test 378 alice bob :is connecting from *@real.example 10.0.0.2",
				":irc.test 379 alice bob :is using modes +iw",
				":irc.test 671 alice bob :is using a secure connection",
				":irc.test 276 alice bob :has client certificate fingerprint abc123",
				":irc.test 320 alice bob :is a cool person",
				":irc.test 307 alice bob :is a registered nick",
				":irc.test 317 alice bob 120 1700000000 :seconds idle, signon time",
				":irc.test 318 alice bob :End of /WHOIS list."
			);

			// No query window opens; the summary follows the user instead.
			expect(payloads("join")).to.have.length(0);

			const msg = lastMessage(1);
			expect(msg.type).to.equal(MessageType.WHOIS);
			expect(msg.showInActive).to.equal(true);
			expect(msg.whois).to.include({
				nick: "bob",
				ident: "~bob",
				hostname: "host.example",
				real_name: "Bob Example",
				channels: "@#seance +#other #third",
				server: "irc.test",
				server_info: "Test server",
				operator: "is an IRC operator",
				away: "gone fishing",
				account: "bobacct",
				actual_ip: "10.0.0.2",
				actual_hostname: "real.example",
				actual_username: "~real",
				modes: "is using modes +iw",
				secure: true,
				registered_nick: "is a registered nick",
				idle: "120",
				logon: "1700000000",
				logonTime: 1700000000 * 1000,
			});
			expect(msg.whois.certfps).to.deep.equal(["has client certificate fingerprint abc123"]);
			expect(msg.whois.special).to.deep.equal(["is a cool person"]);
			expect(msg.whois.idleTime).to.be.closeTo(Date.now() - 120 * 1000, 2000);
			expect(msg.whois.whowas).to.equal(undefined);
		});

		it("reports an unknown nick in the lobby without opening a window", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 318 alice no/such :End of /WHOIS list.");
			expect(payloads("join")).to.have.length(0);
			expect(lastMessage(1).type).to.equal(MessageType.ERROR);
			expect(lastMessage(1).text).to.equal("No such nick: no/such");
			expect(lastMessage(1).showInActive).to.equal(true);
		});

		it("marks WHOWAS results and keeps the newest session", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test 314 alice bob ~new host.new * :Newer",
				":irc.test 314 alice bob ~old host.old * :Older",
				":irc.test 369 alice bob :End of WHOWAS"
			);
			expect(payloads("join")).to.have.length(0);
			const msg = lastMessage(1);
			expect(msg.type).to.equal(MessageType.WHOIS);
			expect(msg.whois).to.include({whowas: true, ident: "~new", hostname: "host.new"});
		});

		it("shows a standalone 301 once in the query window", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/query bob");
			const query = h.client.findChannel("bob")!;
			h.transport.line(":irc.test 301 alice bob :gone fishing");
			h.transport.line(":irc.test 301 alice bob :gone fishing");
			const away = messages(query.id).filter((m) => m.type === MessageType.AWAY);
			expect(away).to.have.length(1);
			expect(away[0].text).to.equal("gone fishing");
			expect(away[0].from?.nick).to.equal("bob");
		});
	});

	describe("reply routing", function () {
		it("shows an asked-for topic again, following the user", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":irc.test 332 alice #seance :Welcome");
			expect(lastMessage(id).type).to.equal(MessageType.TOPIC);
			expect(lastMessage(id).showInActive).to.equal(undefined);

			h.client.input(id, "/topic");
			expect(h.sentAfter()).to.deep.equal(["TOPIC #seance"]);
			h.transport.lines(
				":irc.test 332 alice #seance :Welcome",
				":irc.test 333 alice #seance bob!bob@host 1756000000"
			);
			const [topic, setBy] = messages(id).slice(-2);
			expect(topic.type).to.equal(MessageType.TOPIC);
			expect(topic.showInActive).to.equal(true);
			expect(setBy.type).to.equal(MessageType.TOPIC_SET_BY);
			expect(setBy.showInActive).to.equal(true);
		});

		it("queries and sets the topic of a named channel", function () {
			const h = setup();
			const id = joined(h);
			h.transport.lines(
				":alice!alice@host.example JOIN #other",
				":irc.test 366 alice #other :End of /NAMES list."
			);
			const other = h.client.findChannel("#other")!;
			h.sentAfter();

			h.client.input(id, "/topic #other");
			h.client.input(id, "/topic #other fresh paint");
			expect(h.sentAfter()).to.deep.equal(["TOPIC #other", "TOPIC #other :fresh paint"]);

			h.transport.line(":irc.test 332 alice #other :fresh paint");
			expect(lastMessage(other.id).type).to.equal(MessageType.TOPIC);
			expect(lastMessage(other.id).showInActive).to.equal(true);
		});

		it("shows the topic of a channel we are not in, in the lobby, once", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/topic #secret");
			expect(h.sentAfter()).to.deep.equal(["TOPIC #secret"]);

			h.transport.line(":irc.test 332 alice #secret :Hidden gem");
			expect(lastMessage(1).text).to.equal("Topic for #secret: Hidden gem");
			expect(lastMessage(1).showInActive).to.equal(true);

			// Unasked, the same numeric is state with nowhere to go.
			const before = messages().length;
			h.transport.line(":irc.test 332 alice #secret :Hidden gem");
			expect(messages()).to.have.length(before);

			h.client.input(id, "/topic #void");
			h.transport.line(":irc.test 331 alice #void :No topic is set");
			expect(lastMessage(1).text).to.equal("No topic is set for #void.");
			expect(lastMessage(1).showInActive).to.equal(true);
		});

		it("shows the modes of a channel we are not in, in the lobby, once", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/mode #secret");
			expect(h.sentAfter()).to.deep.equal(["MODE #secret"]);

			h.transport.line(":irc.test 324 alice #secret +ntk hunter2");
			expect(lastMessage(1).type).to.equal(MessageType.MODE_CHANNEL);
			expect(lastMessage(1).text).to.equal("#secret +ntk hunter2");
			expect(lastMessage(1).showInActive).to.equal(true);

			const before = messages().length;
			h.transport.line(":irc.test 324 alice #secret +ntk hunter2");
			expect(messages()).to.have.length(before);
		});

		it("shows unhandled numerics where the user is", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 391 alice irc.test :Thursday afternoon");
			expect(lastMessage(1).type).to.equal(MessageType.UNHANDLED);
			expect(lastMessage(1).text).to.equal("391 irc.test Thursday afternoon");
			expect(lastMessage(1).showInActive).to.equal(true);
		});

		it("confirms /away and /back where the user is", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/away gone fishing");
			h.transport.line(":irc.test 306 alice :You have been marked as being away");
			expect(lastMessage(1).type).to.equal(MessageType.AWAY);
			expect(lastMessage(1).self).to.equal(true);
			expect(lastMessage(1).text).to.equal("You have been marked as being away");
			expect(lastMessage(1).showInActive).to.equal(true);

			h.client.input(id, "/back");
			h.transport.line(":irc.test 305 alice :You are no longer marked as being away");
			expect(lastMessage(1).type).to.equal(MessageType.BACK);
			expect(lastMessage(1).showInActive).to.equal(true);
		});
	});

	describe("/list", function () {
		it("sends LIST and builds the Channel List special window", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/list >10");
			expect(h.sentAfter()).to.deep.equal(["LIST >10"]);

			h.transport.line(":irc.test 321 alice Channel :Users  Name");
			const [join] = payloads<{chan: SharedNetworkChan; shouldOpen: boolean}>("join");
			expect(join.chan.type).to.equal(ChanType.SPECIAL);
			expect(join.chan.special).to.equal(SpecialChanType.CHANNELLIST);
			expect(join.chan.name).to.equal("Channel List");
			expect(join.chan.data).to.deep.equal({
				text: "Loading channel list, this can take a moment...",
			});
			expect(join.shouldOpen).to.equal(false);

			h.transport.lines(
				":irc.test 322 alice #small 3 :tiny",
				":irc.test 322 alice #big 42 :",
				":irc.test 322 alice #mid 10"
			);
			const specials = payloads<{chan: number; data: any}>("msg:special");
			expect(specials).to.have.length(3);
			expect(specials[2]).to.deep.equal({
				chan: join.chan.id,
				data: {text: "Loaded 3 channels..."},
			});

			h.transport.line(":irc.test 323 alice :End of /LIST");
			const final = payloads<{chan: number; data: any}>("msg:special").pop();
			expect(final?.data).to.deep.equal([
				{channel: "#big", num_users: 42, topic: ""},
				{channel: "#mid", num_users: 10, topic: ""},
				{channel: "#small", num_users: 3, topic: "tiny"},
			]);
			expect(h.client.findChannel("Channel List")!.shared.data).to.deep.equal(final?.data);
		});
	});

	describe("/mode family", function () {
		it("fills in the target for bare mode changes", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/mode +m");
			h.client.input(id, "/mode");
			h.client.input(id, "/mode #other +o bob");
			h.client.input(1, "/mode +i");
			h.client.input(id, "/umode -i");
			expect(h.sentAfter()).to.deep.equal([
				"MODE #seance +m",
				"MODE #seance",
				"MODE #other +o bob",
				"MODE alice +i",
				"MODE alice -i",
			]);
		});

		it("batches prefix shortcuts per the MODES limit", function () {
			const h = setup();
			const id = joined(h, "MODES=2");
			h.client.input(id, "/op bob carol dave");
			h.client.input(id, "/devoice  bob");
			h.client.input(id, "/hop bob");
			h.client.input(id, "/dehop bob");
			expect(h.sentAfter()).to.deep.equal([
				"MODE #seance +oo bob carol",
				"MODE #seance +o dave",
				"MODE #seance -v bob",
				"MODE #seance +h bob",
				"MODE #seance -h bob",
			]);
		});

		it("sends one MODE when MODES is unknown and validates the shortcuts", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/voice bob carol");
			expect(h.sentAfter()).to.deep.equal(["MODE #seance +vv bob carol"]);

			h.client.input(id, "/deop");
			expect(lastMessage(id).text).to.equal("Usage: /deop <nick> [...nick]");
			h.client.input(1, "/op bob");
			expect(lastMessage(1).text).to.equal("op command can only be used in channels.");
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/notice and /ctcp", function () {
		it("sends NOTICE and ignores incomplete input", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/notice bob hello there");
			h.client.input(id, "/notice bob");
			expect(h.sentAfter()).to.deep.equal(["NOTICE bob :hello there"]);
		});

		it("sends a CTCP request and notes it locally", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ctcp bob version");
			h.client.input(id, "/ctcp bob ping 12345");
			expect(h.sentAfter()).to.deep.equal([
				"PRIVMSG bob :\x01VERSION\x01",
				"PRIVMSG bob :\x01PING 12345\x01",
			]);
			const note = messages(id).find((m) => m.type === MessageType.CTCP_REQUEST);
			expect(note?.ctcpMessage).to.equal('"VERSION" to bob');
			expect(note?.from).to.deep.equal({nick: "alice", mode: "@"});

			h.client.input(id, "/ctcp bob");
			expect(lastMessage(id).text).to.equal("Usage: /ctcp <nick> <ctcp_type>");
		});

		it("/ver is a CTCP VERSION request", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ver bob");
			expect(h.sentAfter()).to.deep.equal(["PRIVMSG bob :\x01VERSION\x01"]);
			const note = messages(id).find((m) => m.type === MessageType.CTCP_REQUEST);
			expect(note?.ctcpMessage).to.equal('"VERSION" to bob');

			h.client.input(id, "/ver");
			expect(lastMessage(id).text).to.equal("Usage: /ver <nick>");
			h.client.input(id, "/ver bob carol");
			expect(lastMessage(id).text).to.equal("Usage: /ver <nick>");
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/away, /back, /kill, /invite", function () {
		it("sends AWAY with a reason, a placeholder space, or nothing for /back", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/away lunch time");
			h.client.input(id, "/away");
			h.client.input(id, "/back");
			expect(h.sentAfter()).to.deep.equal(["AWAY :lunch time", "AWAY : ", "AWAY"]);
		});

		it("sends KILL with the reason", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/kill troll spamming");
			h.client.input(id, "/kill");
			expect(h.sentAfter()).to.deep.equal(["KILL troll :spamming"]);
		});

		it("invites to the current or a named channel", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/invite bob");
			h.client.input(1, "/invite bob #other");
			h.client.input(id, "/invitelist");
			expect(h.sentAfter()).to.deep.equal([
				"INVITE bob #seance",
				"INVITE bob #other",
				"MODE #seance I",
			]);

			h.client.input(1, "/invite bob");
			expect(lastMessage(1).text).to.equal(
				"invite command can only be used in channels or by specifying a target."
			);
			h.client.input(1, "/invitelist");
			expect(lastMessage(1).text).to.equal(
				"invitelist command can only be used in channels."
			);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("uses the INVEX mode letter for /invitelist", function () {
			const h = setup();
			const id = joined(h, "INVEX=X");
			h.client.input(id, "/invitelist");
			expect(h.sentAfter()).to.deep.equal(["MODE #seance X"]);
		});
	});

	describe("/join", function () {
		it("takes /j as the same command", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/j #other secret");
			expect(h.sentAfter()).to.deep.equal(["JOIN #other secret"]);

			h.client.input(id, "/j other");
			expect(h.sentAfter()).to.deep.equal(["JOIN #other"]);

			h.client.input(id, "/j");
			expect(h.sentAfter()).to.deep.equal(["JOIN #seance key"]);
		});
	});

	describe("/rejoin", function () {
		it("parts and re-joins with the channel key", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/cycle");
			expect(h.sentAfter()).to.deep.equal(["PART #seance :Rejoining", "JOIN #seance key"]);

			h.client.input(1, "/rejoin");
			expect(lastMessage(1).text).to.equal("You can only rejoin channels.");
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/ignore, /unignore, /ignorelist", function () {
		it("adds and removes entries with the old server's messages", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ignore Troll!*@evil.example");
			expect(lastMessage(id).type).to.equal(MessageType.ERROR);
			expect(lastMessage(id).text).to.equal(
				"\u0002troll!*@evil.example\u000f added to ignorelist"
			);
			expect(ignoreListFor(h.client.uuid).list).to.have.length(1);

			h.client.input(id, "/ignore troll!abc@evil.example");
			expect(lastMessage(id).text).to.equal("The specified user/hostmask is already ignored");
			h.client.input(id, "/ignore alice");
			expect(lastMessage(id).text).to.equal("You can't ignore yourself");
			h.client.input(id, "/ignore");
			expect(lastMessage(id).text).to.equal("Usage: /ignore <nick>[!ident][@host]");

			h.client.input(id, "/unignore nobody");
			expect(lastMessage(id).text).to.equal("The specified user/hostmask is not ignored");
			h.client.input(id, "/unignore troll!*@evil.example");
			expect(lastMessage(id).text).to.equal(
				"Successfully removed \u0002troll!*@evil.example\u000f from ignorelist"
			);
			expect(ignoreListFor(h.client.uuid).list).to.have.length(0);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("drops PRIVMSG, NOTICE and ACTION from ignored senders", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ignore *!*@*.evil.example");
			const before = messages().length;

			h.transport.lines(
				":troll!t@lair.evil.example PRIVMSG #seance :hi",
				":troll!t@lair.evil.example PRIVMSG alice :psst",
				":troll!t@lair.evil.example NOTICE #seance :notice",
				":troll!t@lair.evil.example PRIVMSG #seance :\x01ACTION waves\x01"
			);
			expect(messages()).to.have.length(before);
			expect(h.client.findChannel("troll")).to.equal(undefined);

			h.transport.line(":bob!b@nice.example PRIVMSG #seance :hello");
			expect(lastMessage(id).text).to.equal("hello");
		});

		it("still shows our own and server messages while ignoring", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ignore *!*@*");
			h.transport.line(":alice!alice@host.example PRIVMSG #seance :me too");
			expect(lastMessage(id).text).to.equal("me too");
			expect(lastMessage(id).self).to.equal(true);
			h.transport.line(":irc.test NOTICE alice :server notice");
			expect(lastMessage(1).text).to.equal("server notice");
		});

		it("works while disconnected", function () {
			const h = setup();
			h.client.input(1, "/ignore troll");
			expect(lastMessage(1).text).to.equal("\u0002troll!*@*\u000f added to ignorelist");
		});

		it("opens and refreshes the Ignored users window", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ignorelist");
			expect(lastMessage(id).text).to.equal("Ignorelist is empty");

			h.client.input(id, "/ignore troll");
			h.client.input(id, "/ignorelist");
			const [join] = payloads<{chan: SharedNetworkChan; shouldOpen: boolean}>("join");
			expect(join.chan.type).to.equal(ChanType.SPECIAL);
			expect(join.chan.special).to.equal(SpecialChanType.IGNORELIST);
			expect(join.chan.name).to.equal("Ignored users");
			expect(join.chan.data).to.have.length(1);
			expect(join.chan.data[0].hostmask).to.equal("troll!*@*");
			expect(join.chan.data[0].when).to.be.a("number");

			h.client.input(id, "/ignore spammer");
			h.client.input(id, "/ignorelist");
			const [special] = payloads<{chan: number; data: {hostmask: string}[]}>("msg:special");
			expect(special.chan).to.equal(join.chan.id);
			expect(special.data.map((e) => e.hostmask)).to.deep.equal(["troll!*@*", "spammer!*@*"]);
		});
	});

	describe("/mute and /unmute", function () {
		it("flags the current or named channels through the mute hook", function () {
			const setMuteStatus = sinon.spy();
			const h = setup({setMuteStatus});
			const id = joined(h);
			h.client.input(id, "/mute");
			expect(h.client.findChannel("#seance")!.shared.muted).to.equal(true);
			expect(setMuteStatus.args).to.deep.equal([[id, true]]);

			h.client.input(1, "/unmute #SEANCE");
			expect(h.client.findChannel("#seance")!.shared.muted).to.equal(false);
			expect(setMuteStatus.args).to.deep.equal([
				[id, true],
				[id, false],
			]);
		});

		it("reports channels that are not open", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/mute #nope");
			expect(lastMessage(id).text).to.equal("No open channel or user found for #nope");
			h.client.input(id, "/mute #nope #seance #nah");
			expect(lastMessage(id).text).to.equal("No open channels or users found for #nope,#nah");
			expect(h.client.findChannel("#seance")!.shared.muted).to.equal(false);
		});

		it("works while disconnected", function () {
			const h = setup();
			h.client.input(1, "/mute");
			expect(h.client.lobby.shared.muted).to.equal(true);
		});
	});

	describe("/disconnect and /connect", function () {
		it("quits with the reason and closes without reconnecting", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/disconnect back later");
			expect(h.sentAfter()).to.deep.equal(["QUIT :back later"]);
			expect(h.transport.closeCalls).to.have.length(1);
			expect(h.client.isQuitting).to.equal(true);

			h.transport.closed(1000);
			h.client.input(1, "/disconnect");
			expect(h.transport.closeCalls).to.have.length(2);
		});

		it("still closes when the reason holds a line break or runs long", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/disconnect one\rtwo");
			expect(h.sentAfter()).to.deep.equal(["QUIT :one two"]);
			expect(h.transport.closeCalls).to.have.length(1);

			const h2 = setup();
			const id2 = joined(h2);
			h2.client.input(id2, `/quit ${"word ".repeat(200)}`);
			const [quit] = h2.sentAfter();
			expect(quit).to.match(/^QUIT :word word/);
			expect(new TextEncoder().encode(quit).length).to.be.at.most(500);
			expect(h2.transport.closeCalls).to.have.length(1);
		});

		it("reconnects the current network with no arguments", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/connect");
			expect(lastMessage(id).text).to.equal("You are already connected.");
			expect(h.transport.connectCalls).to.equal(1);

			h.client.input(id, "/disconnect");
			h.transport.closed(1000);
			h.client.input(1, "/connect");
			expect(h.transport.connectCalls).to.equal(2);
			expect(h.client.state).to.equal("connecting");
			expect(h.transport.connectOpts[1], "typed: the user asked").to.deep.equal({
				force: true,
			});
		});

		it("a saved command's /connect does not force past the throttle gate", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/disconnect");
			h.transport.closed(1000);
			h.client.input(1, "/connect", {auto: true});
			expect(h.transport.connectOpts[1]).to.deep.equal({force: false});
		});

		it("asks the manager for a new network via network:new", function () {
			const created: unknown[] = [];
			socket.handle("network:new", (data) => void created.push(data));
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/connect irc.other +7443");
			h.client.input(id, "/server irc.plain 8067");
			h.client.input(id, "/server irc.default");
			expect(created).to.deep.equal([
				{
					host: "irc.other",
					port: 7443,
					tls: true,
					nick: "alice",
					join: "",
					sasl: "",
					saslAccount: "",
					saslPassword: "",
				},
				{
					host: "irc.plain",
					port: 8067,
					tls: false,
					nick: "alice",
					join: "",
					sasl: "",
					saslAccount: "",
					saslPassword: "",
				},
				{
					host: "irc.default",
					port: 8067,
					tls: false,
					nick: "alice",
					join: "",
					sasl: "",
					saslAccount: "",
					saslPassword: "",
				},
			]);
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/alias", function () {
		it("says so when there are no aliases", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias");
			expect(lastMessage(id).type).to.equal(MessageType.ERROR);
			expect(lastMessage(id).text).to.contain("No aliases defined");
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("adds an alias, and nothing reaches the server", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias greet /say Hello, $1!");
			expect(lastMessage(id).text).to.equal("Alias /greet added.");
			expect(loadAliases()).to.deep.equal([{name: "greet", body: "/say Hello, $1!"}]);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("overwrites in place, matching the name case-insensitively", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias greet /say hi");
			h.client.input(id, "/alias wave /me waves");
			h.client.input(id, "/alias GREET /say hello");
			expect(lastMessage(id).text).to.equal("Alias /GREET updated.");
			expect(loadAliases()).to.deep.equal([
				{name: "GREET", body: "/say hello"},
				{name: "wave", body: "/me waves"},
			]);
		});

		it("lists every alias verbatim in a monospace block", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias greet /say Hello, $1!");
			h.client.input(id, "/alias wave /me waves");
			h.client.input(id, "/alias");
			expect(lastMessage(id).type).to.equal(MessageType.MONOSPACE_BLOCK);
			expect(lastMessage(id).text).to.equal("/greet /say Hello, $1!\n/wave /me waves");
		});

		it("shows one alias, continuation lines of a multi-line body indented", function () {
			const h = setup();
			// The whole multi-line input is one /alias only under draft/multiline.
			const id = joined(
				h,
				"",
				"batch message-tags draft/multiline=max-bytes=4096,max-lines=24"
			);
			h.client.input(id, "/alias hi /say hello\n/me waves");
			h.client.input(id, "/alias hi");
			expect(lastMessage(id).type).to.equal(MessageType.MONOSPACE_BLOCK);
			expect(lastMessage(id).text).to.equal("/hi /say hello\n    /me waves");
		});

		it("accepts the name typed with its slash", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias /greet /say hi");
			expect(loadAliases()).to.deep.equal([{name: "greet", body: "/say hi"}]);
		});

		it("rejects an invalid name and an unknown lookup", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias bad!name /say hi");
			expect(lastMessage(id).type).to.equal(MessageType.ERROR);
			expect(loadAliases()).to.deep.equal([]);

			h.client.input(id, "/alias nosuch");
			expect(lastMessage(id).type).to.equal(MessageType.ERROR);
			expect(lastMessage(id).text).to.contain("No alias /nosuch");
		});

		it("works disconnected, from the lobby", function () {
			const h = setup();
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/alias greet /say hi");
			expect(lastMessage(lobby).text).to.equal("Alias /greet added.");
			expect(loadAliases()).to.deep.equal([{name: "greet", body: "/say hi"}]);
		});
	});
});

describe("irc commands: edges", function () {
	const MULTILINE = "batch message-tags draft/multiline=max-bytes=4096,max-lines=24";

	beforeEach(function () {
		dispatch = sinon.spy();
		const data = new Map<string, string>();
		sinon.stub(storage, "get").callsFake((key: string) => data.get(key) ?? null);
		sinon
			.stub(storage, "set")
			.callsFake((key: string, value: string) => void data.set(key, value));
		sinon.stub(storage, "remove").callsFake((key: string) => void data.delete(key));
	});

	afterEach(function () {
		sinon.restore();
		socket.unhandle("network:new");
	});

	/** Lines sent as a plain one-line PRIVMSG to `target` with `text`. */
	function plainPrivmsg(sent: string[], target: string, text: string): boolean {
		return sent.some(
			(l) => l === `PRIVMSG ${target} :${text}` || l === `PRIVMSG ${target} ${text}`
		);
	}

	describe("dispatchInput", function () {
		it("lists the client-side and service commands for autocompletion, sorted", function () {
			const names = commandNames();

			for (const name of [
				"/collapse",
				"/expand",
				"/search",
				"/as",
				"/bs",
				"/cs",
				"/ho",
				"/hs",
				"/ms",
				"/ns",
				"/os",
				"/rs",
			]) {
				expect(names, name).to.include(name);
			}

			expect(names).to.not.include("/");
			expect(names).to.deep.equal([...names].sort());
		});

		it("ignores an empty line, even in the lobby", function () {
			const h = setup();
			joined(h);
			const lobby = h.client.lobby.id;
			dispatch.resetHistory();
			h.client.input(lobby, "");
			h.client.input(lobby, "\n");
			expect(messages(lobby)).to.deep.equal([]);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("says a line with a slash past its first character as typed", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "either/or");
			h.client.input(id, "//usr/bin");
			expect(h.sentAfter()).to.deep.equal([
				"PRIVMSG #seance :either/or",
				"PRIVMSG #seance :/usr/bin",
			]);
		});

		it("reports an unknown command while disconnected instead of sending it", function () {
			const h = setup();
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/frobnicate now");
			expect(lastMessage(lobby).type).to.equal(MessageType.ERROR);
			expect(lastMessage(lobby).text).to.equal(
				"You are not connected to the IRC network, unable to send your command."
			);
			expect(h.transport.sent).to.deep.equal([]);
		});

		it("reports an unknown command where it was typed while the network is down", function () {
			const h = setup();
			const id = joined(h);
			h.transport.closed(1006);
			dispatch.resetHistory();
			h.client.input(id, "/frobnicate now");
			expect(lastMessage(id).text).to.equal(
				"You are not connected to the IRC network, unable to send your command."
			);
			expect(messages(h.client.lobby.id)).to.deep.equal([]);
		});

		it("an edit without draft/multiline is one trimmed line", function () {
			const h = setup();
			const id = joined(h, "", "message-tags");
			h.client.input(id, "  fixed\ntypo  ", {edit: "m1"});
			const sent = h.sentAfter();
			expect(sent).to.have.length(1);
			expect(sent[0]).to.be.a("string");
			expect(sent[0]).to.match(/ PRIVMSG #seance :fixed typo$/);
		});

		describe("with draft/multiline", function () {
			it("keeps plain multi-line text one message", function () {
				const h = setup();
				const id = joined(h, "", MULTILINE);
				h.client.input(id, "hello\nworld");
				const sent = h.sentAfter();
				expect(sent.some((l) => /^BATCH \+\S+ draft\/multiline #seance$/.test(l))).to.equal(
					true
				);
				expect(plainPrivmsg(sent, "#seance", "world")).to.equal(false);
			});

			it("keeps an escaped slash line one message", function () {
				const h = setup();
				const id = joined(h, "", MULTILINE);
				h.client.input(id, "//etc\nsecond");
				const sent = h.sentAfter();
				expect(sent.some((l) => /^BATCH \+\S+ draft\/multiline #seance$/.test(l))).to.equal(
					true
				);
				expect(sent.some((l) => / PRIVMSG #seance :?\/etc$/.test(l))).to.equal(true);
				expect(plainPrivmsg(sent, "#seance", "second")).to.equal(false);
			});

			for (const [typed, target] of [
				["/msg bob first\nsecond", "bob"],
				["/query bob first\nsecond", "bob"],
				["/notice bob first\nsecond", "bob"],
				["/say first\nsecond", "#seance"],
				["/me first\nsecond", "#seance"],
			]) {
				it(`sends ${typed.split(" ")[0]} with a line break as one message`, function () {
					const h = setup();
					const id = joined(h, "", MULTILINE);
					h.client.input(id, typed);
					const sent = h.sentAfter();
					expect(
						sent.some((l) =>
							new RegExp(`^BATCH \\+\\S+ draft/multiline ${target}$`).test(l)
						)
					).to.equal(true);
					expect(plainPrivmsg(sent, "#seance", "second")).to.equal(false);
				});
			}

			it("an alias body typed over several lines is one definition", function () {
				const h = setup();
				const id = joined(h, "", MULTILINE);
				h.client.input(id, "/alias greet /say hi\n/say there");
				expect(loadAliases()).to.deep.equal([{name: "greet", body: "/say hi\n/say there"}]);
				expect(h.sentAfter()).to.deep.equal([]);
			});

			it("a /lua snippet over several lines is one snippet", function () {
				const h = setup();
				const id = joined(h, "", MULTILINE);
				h.client.input(id, "/lua x = 1\nreturn x");
				expect(plainPrivmsg(h.sentAfter(), "#seance", "return x")).to.equal(false);
			});
		});
	});

	describe("/join", function () {
		it("a bare /join outside a channel is a usage error", function () {
			const h = setup();
			joined(h);
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/join");
			expect(lastMessage(lobby).text).to.equal("Usage: /join <channel> [key]");
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("drops empty names and keeps the keys in place", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/join #a,,#b");
			h.client.input(id, "/join #a,#b,#c k1,,k3,");
			h.client.input(id, "/join #a,#b k1,,");
			expect(h.sentAfter()).to.deep.equal([
				"JOIN #a,#b",
				"JOIN #a,#b,#c k1,,k3",
				"JOIN #a,#b k1",
			]);
		});

		it("marks a listed channel for autojoin and keeps its key unless a new one is given", function () {
			const h = setup();
			const id = joined(h);
			const chan = h.client.findChannel("#seance")!;
			chan.autoJoin = false;

			h.client.input(id, "/join #seance");
			expect(chan.autoJoin).to.equal(true);
			expect(chan.shared.key).to.equal("key");

			h.client.input(id, "/join #seance newkey");
			expect(chan.shared.key).to.equal("newkey");
			h.client.input(id, "/join #seance");
			expect(h.sentAfter()).to.deep.equal([
				"JOIN #seance",
				"JOIN #seance newkey",
				"JOIN #seance",
			]);

			// A bare /join here now rejoins with the new key.
			h.client.input(id, "/join");
			expect(h.sentAfter()).to.deep.equal(["JOIN #seance newkey"]);
		});

		it("joins a channel not yet listed without touching another", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/join #fresh");
			expect(h.sentAfter()).to.deep.equal(["JOIN #fresh"]);
			expect(h.client.findChannel("#seance")!.shared.key).to.equal("key");
		});
	});

	describe("/topic", function () {
		it("queries a named channel from anywhere, and the current one from a channel", function () {
			const h = setup();
			const id = joined(h);
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/topic #seance");
			h.client.input(lobby, "/topic #elsewhere");
			h.client.input(id, "/topic");
			h.client.input(id, "/topic   ");
			expect(h.sentAfter()).to.deep.equal([
				"TOPIC #seance",
				"TOPIC #elsewhere",
				"TOPIC #seance",
				"TOPIC #seance",
			]);
			expect(h.client.findChannel("#seance")!.topicAsked).to.equal(true);
		});

		it("whitespace other than spaces is still a query, not a topic", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/topic \t");
			expect(h.sentAfter()).to.deep.equal(["TOPIC #seance"]);
		});

		it("sets the topic here when the first word is not a channel", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/topic hello world");
			h.client.input(id, "/topic #seance new topic");
			expect(h.sentAfter()).to.deep.equal([
				"TOPIC #seance :hello world",
				"TOPIC #seance :new topic",
			]);
		});

		it("outside a channel needs a channel name, and /cleartopic never takes one", function () {
			const h = setup();
			joined(h);
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/topic hello");
			expect(lastMessage(lobby).text).to.equal("topic command can only be used in channels.");
			h.client.input(lobby, "/cleartopic #seance");
			expect(lastMessage(lobby).text).to.equal(
				"cleartopic command can only be used in channels."
			);
			h.client.input(lobby, "/topic");
			expect(lastMessage(lobby).text).to.equal("topic command can only be used in channels.");
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/part", function () {
		it("/close, /leave and /part part the named or current channel", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/close");
			h.client.input(id, "/leave bye now");
			h.client.input(h.client.lobby.id, "/part #seance later");
			expect(h.sentAfter()).to.deep.equal([
				"PART #seance :Seance",
				"PART #seance :bye now",
				"PART #seance :later",
			]);
		});

		it("a first word that is no open window is the reason", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/part #nowhere");
			expect(h.sentAfter()).to.deep.equal(["PART #seance :#nowhere"]);
		});

		it("parting a channel never records a closed query", function () {
			const h = setup();
			const id = joined(h, "", "message-tags");
			h.transport.line(
				"@msgid=c1;time=2026-10-01T10:00:00.000Z :bob!b@h PRIVMSG #seance :hello"
			);
			h.client.input(id, "/part");
			expect(h.sentAfter()).to.deep.equal(["PART #seance :Seance"]);
			expect(h.client.closed.entries()).to.deep.equal([]);
		});

		it("refuses to part the lobby", function () {
			const h = setup();
			joined(h);
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/part");
			expect(lastMessage(lobby).text).to.equal(
				"You can not part from networks, use /quit instead."
			);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("works disconnected: the channel is dropped and leaves autojoin", function () {
			const h = setup();
			const id = joined(h);
			const chan = h.client.findChannel("#seance")!;
			h.transport.closed(1006);
			h.client.input(id, "/part");
			expect(chan.autoJoin).to.equal(false);
			expect(h.client.findChannel("#seance")).to.equal(undefined);
		});

		it("closing a query only remembers the close when the server sent something there", function () {
			const h = setup();
			const id = joined(h, "", "message-tags");
			h.transport.line(
				"@msgid=q1;time=2026-10-01T10:00:00.000Z :bob!b@h PRIVMSG alice :psst"
			);
			const query = h.client.findChannel("bob")!;
			h.client.input(query.id, "/close");
			expect(h.client.findChannel("bob")).to.equal(undefined);
			expect(h.client.closed.entries().map((e) => e.nick)).to.deep.equal(["bob"]);

			h.client.input(id, "/query carol");
			const empty = h.client.findChannel("carol")!;
			h.client.input(empty.id, "/close");
			expect(h.client.findChannel("carol")).to.equal(undefined);
			expect(h.client.closed.entries().map((e) => e.nick)).to.deep.equal(["bob"]);
		});
	});

	describe("/alias", function () {
		it("treats whitespace alone as a bare /alias", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias   ");
			expect(lastMessage(id).text).to.equal(
				"No aliases defined. /alias <name> <commands> creates one."
			);
		});

		it("trims the body and accepts a slash only before the name", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/alias greet    /say hi");
			expect(loadAliases()).to.deep.equal([{name: "greet", body: "/say hi"}]);

			h.client.input(id, "/alias gr/eet /say hi");
			expect(lastMessage(id).type).to.equal(MessageType.ERROR);
			expect(lastMessage(id).text).to.equal(
				`Alias names are letters, digits, _ and - (up to ${MAX_NAME_LENGTH} characters).`
			);
			expect(loadAliases()).to.have.length(1);
		});

		it("takes a body of the maximum length and refuses a longer one", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, `/alias long /say ${"x".repeat(MAX_BODY_LENGTH - 5)}`);
			expect(lastMessage(id).text).to.equal("Alias /long added.");

			h.client.input(id, `/alias longer /say ${"x".repeat(MAX_BODY_LENGTH - 4)}`);
			expect(lastMessage(id).type).to.equal(MessageType.ERROR);
			expect(lastMessage(id).text).to.match(/^That alias is too long/);
			expect(loadAliases().map((a) => a.name)).to.deep.equal(["long"]);
		});

		it("refuses a new alias past the limit but still updates an existing one", function () {
			const h = setup();
			const id = joined(h);
			const full = Array.from({length: MAX_ALIASES - 1}, (_, i) => ({
				name: `a${i}`,
				body: "/say hi",
			}));
			saveAliases(full);

			h.client.input(id, "/alias last /say bye");
			expect(lastMessage(id).text).to.equal("Alias /last added.");
			expect(loadAliases()).to.have.length(MAX_ALIASES);

			h.client.input(id, "/alias onemore /say no");
			expect(lastMessage(id).type).to.equal(MessageType.ERROR);
			expect(lastMessage(id).text).to.equal(
				`You already have ${MAX_ALIASES} aliases; delete one in Settings → Aliases first.`
			);

			h.client.input(id, "/alias a0 /say changed");
			expect(lastMessage(id).text).to.equal("Alias /a0 updated.");
			expect(loadAliases()).to.have.length(MAX_ALIASES);
			expect(loadAliases()[0]).to.deep.equal({name: "a0", body: "/say changed"});
		});
	});

	describe("/msg and /query", function () {
		it("refuses query windows for channels, user prefixes and NULs", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/query #nowhere hello");
			expect(lastMessage(id).text).to.equal(
				"You can not open query windows for channels, use /join instead."
			);
			h.client.input(id, "/query @bob hello");
			expect(lastMessage(id).text).to.equal(
				"You can not open query windows for names starting with a user prefix."
			);
			h.client.input(id, "/query bo\0b hello");
			expect(lastMessage(id).text).to.equal(
				"You can not open query windows for names containing spaces."
			);
			expect(h.sentAfter()).to.deep.equal([]);
			expect(h.client.findChannel("@bob")).to.equal(undefined);
		});

		it("/query of an open window just opens it", function () {
			const h = setup();
			const id = joined(h);
			dispatch.resetHistory();
			h.client.input(id, "/query #seance hello");
			expect(messages(id).filter((m) => m.type === MessageType.ERROR)).to.deep.equal([]);
			expect(h.sentAfter()).to.deep.equal(["PRIVMSG #seance :hello"]);
		});

		it("sends nothing without a body", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/msg bob");
			h.client.input(id, "/msg");
			h.client.input(id, "/query carol");
			expect(h.sentAfter()).to.deep.equal([]);
			expect(h.client.findChannel("carol")).to.not.equal(undefined);
		});

		it("a bare /msg or /notice to a query is not writing in it", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":bob!b@h PRIVMSG alice :psst");
			const query = h.client.findChannel("bob")!;
			expect(query.autoOpened).to.equal(true);
			h.client.input(id, "/msg bob");
			h.client.input(id, "/notice bob");
			expect(query.autoOpened).to.equal(true);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("splitTarget keeps the body and names nothing for empty input", function () {
			expect(splitTarget("bob hi there")).to.deep.equal({target: "bob", body: "hi there"});
			expect(splitTarget("bob")).to.deep.equal({target: "bob", body: ""});
			expect(splitTarget("")).to.deep.equal({target: "", body: ""});
			expect(splitTarget(" bob")).to.deep.equal({target: "", body: ""});
		});
	});

	describe("/react", function () {
		function withMessage(h: Harness): number {
			const id = joined(h, "", "message-tags");
			h.transport.line("@msgid=abc :bob!b@h PRIVMSG #seance :hi");
			h.sentAfter();
			return id;
		}

		it("reacts to the newest message, or to the msgid given last", function () {
			const h = setup();
			const id = withMessage(h);
			h.client.input(id, "/react 👍");
			h.client.input(id, "/react abc");
			h.client.input(id, "/react lol wow abc");
			h.client.input(id, "/react  abc");
			expect(h.sentAfter()).to.deep.equal([
				"@+draft/react=👍;+draft/reply=abc TAGMSG #seance",
				"@+draft/react=abc;+draft/reply=abc TAGMSG #seance",
				"@+draft/react=lol\\swow;+draft/reply=abc TAGMSG #seance",
				"@+draft/react=abc;+draft/reply=abc TAGMSG #seance",
			]);
		});

		it("says when nothing here carries a msgid", function () {
			const h = setup();
			const id = joined(h, "", "message-tags");
			h.client.input(id, "/react 👍");
			expect(lastMessage(id).text).to.equal(
				"No message to react to: none here carries a msgid."
			);
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/me and /slap", function () {
		it("slaps the named user, and a bare /slap or /me sends nothing", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/slap");
			h.client.input(id, "/me");
			h.client.input(id, "/slap bob");
			expect(h.sentAfter()).to.deep.equal([
				"PRIVMSG #seance :\x01ACTION slaps bob around a bit with a large trout\x01",
			]);
		});

		it("only works in channels and queries", function () {
			const h = setup();
			joined(h);
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/me waves");
			expect(lastMessage(lobby).text).to.equal(
				"me command can only be used in channels and queries."
			);
			expect(h.sentAfter()).to.deep.equal([]);
		});
	});

	describe("/nick", function () {
		it("validates the new nick before sending it", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/nick");
			expect(lastMessage(id).text).to.equal("Usage: /nick <your new nick>");
			h.client.input(id, "/nick  ");
			expect(lastMessage(id).text).to.equal("Usage: /nick <your new nick>");
			h.client.input(id, "/nick two words");
			expect(lastMessage(id).text).to.equal("Nicknames may not contain spaces.");
			h.client.input(id, `/nick ${"n".repeat(101)}`);
			expect(lastMessage(id).text).to.equal("Nicknames may not be this long.");
			expect(h.sentAfter()).to.deep.equal([]);

			h.client.input(id, `/nick ${"n".repeat(100)}`);
			expect(h.sentAfter()).to.deep.equal([`NICK ${"n".repeat(100)}`]);
		});
	});

	describe("/mode", function () {
		it("fills in the query's name, and /deop takes ops", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":bob!b@h PRIVMSG alice :psst");
			const query = h.client.findChannel("bob")!;
			h.sentAfter();
			h.client.input(query.id, "/mode +x");
			h.client.input(id, "/mode -m");
			h.client.input(id, "/deop bob");
			expect(h.sentAfter()).to.deep.equal([
				"MODE bob +x",
				"MODE #seance -m",
				"MODE #seance -o bob",
			]);
		});

		it("marks the modes as asked for only for a bare query", function () {
			const h = setup();
			const id = joined(h);
			const chan = h.client.findChannel("#seance")!;
			h.client.input(id, "/mode #seance +m");
			expect(chan.modesAsked).to.not.equal(true);
			h.client.input(id, "/mode #seance");
			expect(chan.modesAsked).to.equal(true);
		});
	});

	describe("/connect", function () {
		it("skips empty words and takes only a whole number as the port", function () {
			const created: {host: string; port: number}[] = [];
			socket.handle("network:new", (data) => void created.push(data as never));
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/server  irc.other  7000");
			h.client.input(id, "/server irc.other abc123");
			h.client.input(id, "/server irc.other 123abc");
			expect(created.map((c) => [c.host, c.port])).to.deep.equal([
				["irc.other", 7000],
				["irc.other", 8067],
				["irc.other", 8067],
			]);
		});
	});

	describe("words split by a double space", function () {
		it("are dropped before the command sees them", function () {
			const h = setup();
			const id = joined(h, "", "message-tags draft/message-redaction");
			h.client.input(id, "/whois  bob");
			h.client.input(id, "/who  #seance");
			h.client.input(id, "/list  >5");
			h.client.input(id, "/invite  bob");
			h.client.input(id, "/ctcp  bob  version");
			h.client.input(id, "/redact  m1");
			expect(h.sentAfter()).to.deep.equal([
				"WHOIS bob bob",
				"WHO #seance",
				"LIST >5",
				"INVITE bob #seance",
				"PRIVMSG bob :\x01VERSION\x01",
				"REDACT #seance m1",
			]);
		});

		it("/mute  #seance mutes it", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/mute  #seance");
			expect(h.client.findChannel("#seance")!.shared.muted).to.equal(true);
		});
	});

	describe("small commands", function () {
		it("/raw, /send and /quote send the line; whitespace alone sends nothing", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/raw PING a");
			h.client.input(id, "/send PING b");
			h.client.input(id, "/quote PING c");
			h.client.input(id, "/raw   ");
			expect(h.sentAfter()).to.deep.equal(["PING a", "PING b", "PING c"]);
		});

		it("/notice without a body sends nothing", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/notice bob");
			h.client.input(id, "/notice");
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("/invite with one name outside a channel needs a target", function () {
			const h = setup();
			joined(h);
			const lobby = h.client.lobby.id;
			h.client.input(lobby, "/invite bob");
			expect(lastMessage(lobby).text).to.equal(
				"invite command can only be used in channels or by specifying a target."
			);
			expect(h.sentAfter()).to.deep.equal([]);
		});

		it("/kill keeps the reason's spaces; a bare /kill, /kick, /ban send nothing", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/kill");
			h.client.input(id, "/kick");
			h.client.input(id, "/ban");
			expect(lastMessage(id).text).to.equal("Usage: /ban <nick>");
			h.client.input(id, "/kill bob go away");
			expect(h.sentAfter()).to.deep.equal(["KILL bob :go away"]);
		});

		it("a bare /quit uses the default reason", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/quit");
			expect(h.sentAfter()).to.deep.equal(["QUIT :Seance"]);
		});

		it("a bare /disconnect uses the default reason", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/disconnect");
			expect(h.sentAfter()).to.deep.equal(["QUIT :Seance"]);
		});

		it("/quit, /ignorelist, /lua and /investigate work while disconnected", function () {
			const h = setup();
			const lobby = h.client.lobby.id;
			const investigations: unknown[] = [];
			const listener = (data: unknown) => void investigations.push(data);
			eventbus.on("oper:investigate", listener);

			try {
				h.client.input(lobby, "/ignorelist");
				expect(lastMessage(lobby).text).to.equal("Ignorelist is empty");
				h.client.input(lobby, "/lua");
				expect(lastMessage(lobby).text).to.match(/^Usage: \/lua /);
				h.client.input(lobby, "/investigate bob");
				expect(investigations).to.deep.equal([
					{network: h.client.uuid, kind: "user", target: "bob"},
				]);
				h.client.input(lobby, "/quit");
				expect(payloads("quit")).to.deep.equal([{network: h.client.uuid}]);
				expect(
					messages(lobby).filter((m) => /You are not connected/.test(m.text ?? ""))
				).to.deep.equal([]);
			} finally {
				eventbus.off("oper:investigate", listener);
			}
		});

		it("a bare /ignore is a usage error", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/ignore");
			expect(lastMessage(id).text).to.equal("Usage: /ignore <nick>[!ident][@host]");
		});

		it("/mute in a special window changes nothing", function () {
			const h = setup();
			const id = joined(h);
			const muted: [number, boolean][] = [];
			h.client.options.setMuteStatus = (chanId, value) => void muted.push([chanId, value]);
			h.client.input(id, "/list");
			h.transport.line(":irc.test 321 alice Channel :Users  Name");
			const list = h.client.findChannel("Channel List")!;
			h.client.input(list.id, "/mute");
			expect(list.shared.muted).to.not.equal(true);
			expect(muted).to.deep.equal([]);
		});

		it("/list starts a fresh list even when the last one never finished", function () {
			const h = setup();
			const id = joined(h);
			h.client.input(id, "/list");
			h.transport.lines(
				":irc.test 321 alice Channel :Users  Name",
				":irc.test 322 alice #old 3 :stale"
			);
			h.client.input(id, "/list");
			h.transport.lines(
				":irc.test 322 alice #new 5 :fresh",
				":irc.test 323 alice :End of /LIST"
			);
			const final = payloads<{chan: number; data: any}>("msg:special").pop();
			expect(final?.data).to.deep.equal([{channel: "#new", num_users: 5, topic: "fresh"}]);
		});
	});
});
