/**
 * The smaller handlers (client/js/irc/handlers/): PERSISTENCE, ERROR, KILL,
 * INVITE, CHGHOST, ACCOUNT/SETNAME, WEBPUSH, SASL numerics outside an
 * exchange, ban/invite lists, NAMES, TAGMSG, REDACT, LIST and BATCH.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {
	registerBatchHandler,
	unregisterBatchHandler,
	type OpenBatch,
} from "../../../client/js/irc/handlers/batch";
import {CHANNEL_LIST_CHAN} from "../../../client/js/irc/handlers/list";
import {parseListTime} from "../../../client/js/irc/handlers/lists";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {ALL_CAPS, Harness, joined, register, setup, stubStorage} from "../support";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

function lobbyTexts(h: Harness): string[] {
	return lobbyMsgs(h).map((m) => m.text);
}

describe("handlers (small)", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	describe("PERSISTENCE", function () {
		it("collects SESSION lines until ENDOFLIST", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test PERSISTENCE SESSION s1 active alice #a,#b :phone",
				":irc.test PERSISTENCE SESSION s2 held alice * :laptop",
				":irc.test PERSISTENCE SESSION s3 held alice #c, :tablet",
				":irc.test PERSISTENCE ENDOFLIST"
			);
			expect(h.payloads("persistence:sessions")).to.deep.equal([
				{
					sessions: [
						{
							sessid: "s1",
							state: "ACTIVE",
							nick: "alice",
							channels: ["#a", "#b"],
							info: "phone",
						},
						{sessid: "s2", state: "HELD", nick: "alice", channels: [], info: "laptop"},
						{
							sessid: "s3",
							state: "HELD",
							nick: "alice",
							channels: ["#c"],
							info: "tablet",
						},
					],
				},
			]);
			expect(lobbyMsgs(h)).to.deep.equal([]);
		});

		it("STATUS asked for says the effective state and a setting that differs", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test PERSISTENCE STATUS DEFAULT ON",
				":irc.test PERSISTENCE STATUS ON ON",
				":irc.test PERSISTENCE STATUS OFF"
			);
			const prefix =
				"Session persistence (the server keeps you in your channels while disconnected): ";
			expect(lobbyTexts(h)).to.deep.equal([
				`${prefix}ON (your setting: DEFAULT)`,
				`${prefix}ON`,
				`${prefix}OFF`,
			]);
		});

		it("SET and anything else are shown once registered, not while registering", function () {
			const h = setup();
			register(h, ALL_CAPS, [":irc.test PERSISTENCE SET ON"]);
			expect(lobbyTexts(h).filter((t) => t.includes("ersistence"))).to.deep.equal([]);
			h.dispatch.resetHistory();
			h.transport.lines(
				":irc.test PERSISTENCE SET off",
				":irc.test PERSISTENCE ATTACH default",
				":irc.test PERSISTENCE PROFILE x y"
			);
			expect(lobbyTexts(h)).to.deep.equal([
				"Session persistence set to: OFF",
				"Persistence: ATTACH default",
				"Persistence: PROFILE x y",
			]);
			expect(h.client.serverReplay).to.not.equal(true);
		});

		it("an ATTACH ack while registering without a cursor of ours is only shown", function () {
			const h = setup();
			register(h, ALL_CAPS, [":irc.test PERSISTENCE ATTACH default"]);
			expect(h.client.serverReplay).to.not.equal(true);
			expect(lobbyTexts(h)).to.include("Persistence: ATTACH default");
		});
	});

	describe("ERROR", function () {
		it("is shown as an error, unread, unless we are quitting", function () {
			const h = setup();
			joined(h);
			const before = h.client.lobby.shared.unread;
			h.transport.line("ERROR :Closing Link: alice (Ping timeout)");
			const [m] = lobbyMsgs(h);
			expect(m.type).to.equal(MessageType.ERROR);
			expect(m.text).to.equal("Closing Link: alice (Ping timeout)");
			expect(h.client.lobby.shared.unread).to.equal(before + 1);

			const g = setup();
			joined(g);
			g.client.disconnect();
			g.dispatch.resetHistory();
			g.transport.line("ERROR :Closing Link: alice (Quit)");
			expect(lobbyMsgs(g).filter((x) => x.type === MessageType.ERROR)).to.deep.equal([]);
		});
	});

	it("KILL is still shown", function () {
		const h = setup();
		joined(h);
		h.transport.line(":oper!o@o.example KILL alice :Bye");
		expect(lobbyMsgs(h).map((m) => m.type)).to.deep.equal([MessageType.UNHANDLED]);
	});

	it("INVITE is an invite, not an unhandled line", function () {
		const h = setup();
		joined(h);
		h.transport.line(":bob!b@bob.example INVITE alice #secret");
		const [m] = lobbyMsgs(h);
		expect(m.type).to.equal(MessageType.INVITE);
		expect(m.invitedYou).to.equal(true);
	});

	it("CHGHOST is shown where the user is", function () {
		const h = setup();
		const id = joined(h);
		h.transport.line(":bob!b@old.example CHGHOST b new.example");
		expect(h.messages(id).map((m) => [m.type, m.new_host])).to.deep.equal([
			[MessageType.CHGHOST, "new.example"],
		]);
		expect(lobbyMsgs(h)).to.deep.equal([]);
	});

	it("ACCOUNT and SETNAME show nothing", function () {
		const h = setup();
		const id = joined(h);
		h.transport.lines(
			":bob!b@bob.example ACCOUNT bobacct",
			":bob!b@bob.example SETNAME :Bob B"
		);
		expect(lobbyMsgs(h)).to.deep.equal([]);
		expect(h.messages(id)).to.deep.equal([]);
	});

	describe("WEBPUSH", function () {
		it("reports a REGISTER or UNREGISTER with its endpoint, nothing else", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test WEBPUSH REGISTER https://push.example/1",
				":irc.test WEBPUSH register",
				":irc.test WEBPUSH FOO https://push.example/2",
				":irc.test WEBPUSH unregister https://push.example/3"
			);
			expect(h.payloads("webpush:state")).to.deep.equal([
				{
					network: h.client.uuid,
					action: "REGISTER",
					endpoint: "https://push.example/1",
					ok: true,
				},
				{
					network: h.client.uuid,
					action: "UNREGISTER",
					endpoint: "https://push.example/3",
					ok: true,
				},
			]);
		});
	});

	describe("SASL numerics with no exchange running", function () {
		it("900 records the account and is shown", function () {
			const h = setup();
			joined(h);
			h.transport.line(
				":irc.test 900 alice alice!a@host.example acct :You are now logged in as acct"
			);
			expect(h.client.account).to.equal("acct");
			expect(lobbyTexts(h)).to.deep.equal(["You are now logged in as acct"]);
		});

		it("903 is plain, a failure is an error with its prefix", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test 903 alice :SASL authentication successful",
				":irc.test 906 alice :SASL authentication aborted"
			);
			expect(lobbyMsgs(h).map((m) => [m.type, m.text])).to.deep.equal([
				[undefined, "SASL authentication successful"],
				[MessageType.ERROR, "SASL: SASL authentication aborted"],
			]);
		});
	});

	describe("ban, invite and exception lists", function () {
		it("parseListTime reads whole seconds only", function () {
			expect(parseListTime("1700000000")?.getTime()).to.equal(1700000000 * 1000);
			expect(parseListTime("1700000000x")).to.equal(undefined);
			expect(parseListTime(undefined)).to.equal(undefined);
		});

		it("keeps each kind's entries apart", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test 367 alice #seance *!*@ban.example bob 1700000000",
				":irc.test 346 alice #seance *!*@invite.example bob 1700000000",
				":irc.test 348 alice #seance *!*@except.example bob 1700000000",
				":irc.test 368 alice #seance :End of Channel Ban List",
				":irc.test 347 alice #seance :End of Channel Invite List",
				":irc.test 349 alice #seance :End of Channel Exception List"
			);
			const data = (name: string) =>
				(h.client.findChannel(name)!.shared.data as {hostmask: string}[]).map(
					(e) => e.hostmask
				);
			expect(data("Ban list for #seance")).to.deep.equal(["*!*@ban.example"]);
			expect(data("Invite list for #seance")).to.deep.equal(["*!*@invite.example"]);
			expect(data("Exception list for #seance")).to.deep.equal(["*!*@except.example"]);
		});

		it("an entry with no mask is no entry; an empty list is an unread error", function () {
			const h = setup();
			const id = joined(h);
			const chan = h.client.findChannel("#seance")!;
			const before = chan.shared.unread;
			h.transport.lines(
				":irc.test 367 alice #seance",
				":irc.test 368 alice #seance :End of Channel Ban List"
			);
			expect(h.messages(id).map((m) => m.text)).to.deep.equal(["Ban list is empty"]);
			expect(chan.shared.unread).to.equal(before + 1);
		});
	});

	describe("NAMES", function () {
		it("ranks prefixes and skips a token that is all prefix", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test 353 alice = #seance :+@dave @ erin",
				":irc.test 366 alice #seance :End of /NAMES list."
			);
			const chan = h.client.findChannel("#seance")!;
			expect(chan.findUser("dave")!.modes).to.deep.equal(["@", "+"]);
			expect(chan.findUser("")).to.equal(undefined);
			expect(chan.findUser("erin")).to.not.equal(undefined);
		});
	});

	describe("TAGMSG", function () {
		it("typing to the lobby's name goes nowhere", function () {
			const h = setup();
			joined(h);
			h.transport.line(`@+typing=active :bob!b@bob.example TAGMSG ${h.client.lobby.name}`);
			expect(h.payloads("typing")).to.deep.equal([]);
		});
	});

	describe("REDACT", function () {
		it("drops the message from the inbox by the conversation's own name, loaded or not", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":bob!b@bob.example REDACT #SEANCE m1",
				":bob!b@bob.example REDACT #nowhere m2",
				"REDACT #seance m3",
				":bob!b@bob.example REDACT #seance"
			);
			expect(h.payloads("inbox:drop")).to.deep.equal([
				{network: h.client.uuid, target: "#seance", msgid: "m1"},
				{network: h.client.uuid, target: "#nowhere", msgid: "m2"},
				{network: h.client.uuid, target: "#seance", msgid: "m3"},
			]);
		});
	});

	describe("LIST", function () {
		const listData = (h: Harness) =>
			h.client.findChannel(CHANNEL_LIST_CHAN)!.shared.data as {channel: string}[];

		it("sorts by users and starts each list afresh", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test 322 alice #stale 9 :left over",
				":irc.test 321 alice Channel :Users  Name",
				":irc.test 322 alice #a 1 :a",
				":irc.test 322 alice #b 5 :b",
				":irc.test 323 alice :End of /LIST"
			);
			expect(listData(h).map((c) => c.channel)).to.deep.equal(["#b", "#a"]);

			h.transport.lines(":irc.test 322 alice #c 3 :c", ":irc.test 323 alice :End of /LIST");
			expect(listData(h).map((c) => c.channel)).to.deep.equal(["#c"]);
		});
	});

	describe("BATCH", function () {
		it("an unregistered type is unwrapped, whatever case it was unregistered in", function () {
			const seen: OpenBatch[] = [];
			registerBatchHandler("Seance-Probe", (_client, b) => void seen.push(b));
			unregisterBatchHandler("SEANCE-PROBE");
			const h = setup();
			const id = joined(h);
			h.transport.lines(
				":irc.test BATCH +p seance-probe",
				"@batch=p :bob!b@bob.example PRIVMSG #seance :inside",
				":irc.test BATCH -p"
			);
			expect(seen).to.deep.equal([]);
			expect(h.messages(id).map((m) => m.text)).to.deep.equal(["inside"]);
		});

		it("a marker that is neither + nor - closes nothing", function () {
			const seen: number[] = [];
			registerBatchHandler("seance-count", (_client, b) => void seen.push(b.messages.length));

			try {
				const h = setup();
				joined(h);
				h.transport.lines(
					":irc.test BATCH +p seance-count",
					"@batch=p :bob!b@bob.example PRIVMSG #seance :one",
					":irc.test BATCH ?p",
					"@batch=p :bob!b@bob.example PRIVMSG #seance :two",
					":irc.test BATCH -p"
				);
				expect(seen).to.deep.equal([2]);
			} finally {
				unregisterBatchHandler("seance-count");
			}
		});

		it("a child that outlives its parent is unwrapped, not lost", function () {
			const h = setup();
			const id = joined(h);
			h.transport.lines(
				":irc.test BATCH +p seance-outer",
				"@batch=p :irc.test BATCH +c seance-inner",
				":irc.test BATCH -p",
				"@batch=c :bob!b@bob.example PRIVMSG #seance :late",
				":irc.test BATCH -c"
			);
			expect(h.messages(id).map((m) => m.text)).to.include("late");
		});
	});
});
