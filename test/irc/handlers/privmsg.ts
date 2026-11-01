/**
 * PRIVMSG / NOTICE / CTCP (client/js/irc/handlers/privmsg.ts): what the user
 * sees and what goes back to the server for each kind of line.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {scriptManager} from "../../../client/js/irc/scripting/manager";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {ALL_CAPS, batch, Harness, joined, setup, stubStorage} from "../support";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

describe("handlers/privmsg.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	describe("nicks named in the text", function () {
		it("finds a nick behind a colour code, with or without a background", function () {
			const h = setup();
			const id = joined(h);
			h.transport.lines(
				":bob!bob@host.example PRIVMSG #seance :\x0312carol: hi",
				":bob!bob@host.example PRIVMSG #seance :\x0312,04carol: hi",
				":bob!bob@host.example PRIVMSG #seance :\x033carol"
			);
			expect(h.messages(id).map((m) => m.users)).to.deep.equal([
				["carol"],
				["carol"],
				["carol"],
			]);
		});
	});

	describe("CTCP requests", function () {
		function ctcp(h: Harness, body: string, from = ":bob!bob@host.example"): string[] {
			h.transport.line(`${from} PRIVMSG alice :${body}`);
			return h.sent();
		}

		it("answers VERSION and shows the request in the lobby", function () {
			const h = setup();
			joined(h);
			expect(ctcp(h, "\x01VERSION\x01")).to.deep.equal([
				"NOTICE bob :\x01VERSION Seance\x01",
			]);
			const shown = lobbyMsgs(h);
			expect(shown).to.have.length(1);
			expect(shown[0].type).to.equal(MessageType.CTCP_REQUEST);
			expect(shown[0].from).to.deep.equal({nick: "bob", mode: ""});
			expect(shown[0].hostmask).to.equal("bob@host.example");
			expect(shown[0].ctcpMessage).to.equal("VERSION");
			expect(shown[0].showInActive).to.equal(true);
		});

		it("counts the request as unread in the lobby", function () {
			const h = setup();
			joined(h);
			const before = h.client.lobby.shared.unread;
			ctcp(h, "\x01VERSION\x01");
			expect(h.client.lobby.shared.unread).to.equal(before + 1);
		});

		it("answers CLIENTINFO with the commands it knows", function () {
			const h = setup();
			joined(h);
			expect(ctcp(h, "\x01CLIENTINFO\x01")).to.deep.equal([
				"NOTICE bob :\x01CLIENTINFO CLIENTINFO PING VERSION\x01",
			]);
		});

		it("echoes a PING argument of up to 32 bytes", function () {
			const h = setup();
			joined(h);
			const arg = "a".repeat(32);
			expect(ctcp(h, `\x01PING ${arg}\x01`)).to.deep.equal([
				`NOTICE bob :\x01PING ${arg}\x01`,
			]);
		});

		it("answers PING without an argument with a bare PING", function () {
			const h = setup();
			joined(h);
			expect(ctcp(h, "\x01PING\x01")).to.deep.equal(["NOTICE bob :\x01PING\x01"]);
			expect(lobbyMsgs(h)[0].ctcpMessage).to.equal("PING");
		});

		it("answers a request whose closing \\x01 is missing", function () {
			const h = setup();
			joined(h);
			expect(ctcp(h, "\x01VERSION")).to.deep.equal(["NOTICE bob :\x01VERSION Seance\x01"]);
		});

		it("does not answer an unknown request, but still shows it", function () {
			const h = setup();
			joined(h);
			expect(ctcp(h, "\x01FINGER\x01")).to.deep.equal([]);
			expect(lobbyMsgs(h).map((m) => m.ctcpMessage)).to.deep.equal(["FINGER"]);
		});

		it("shows a request with no prefix without answering it", function () {
			const h = setup();
			joined(h);
			h.transport.line("PRIVMSG alice :\x01VERSION\x01");
			expect(h.sent()).to.deep.equal([]);
			const shown = lobbyMsgs(h);
			expect(shown).to.have.length(1);
			expect(shown[0].type).to.equal(MessageType.CTCP_REQUEST);
			expect(shown[0].hostmask).to.equal("@");
		});

		it("ignores the echo of our own request to someone else", function () {
			const h = setup();
			joined(h);
			expect(ctcp(h, "\x01VERSION\x01", ":alice!alice@host.example").length).to.equal(1);
			h.dispatch.resetHistory();
			h.transport.line(":alice!alice@host.example PRIVMSG bob :\x01VERSION\x01");
			expect(h.sent()).to.deep.equal([]);
			expect(lobbyMsgs(h)).to.deep.equal([]);
		});

		it("is not an ACTION", function () {
			const h = setup();
			joined(h);
			ctcp(h, "\x01VERSION\x01");
			expect(h.messages().some((m) => m.type === MessageType.ACTION)).to.equal(false);
		});
	});

	describe("CTCP replies (NOTICE)", function () {
		it("shows the reply and sends nothing back", function () {
			const h = setup();
			joined(h);
			h.transport.line(":bob!bob@host.example NOTICE alice :\x01VERSION Foo 1.0\x01");
			expect(h.sent()).to.deep.equal([]);
			const shown = lobbyMsgs(h);
			expect(shown).to.have.length(1);
			expect(shown[0].type).to.equal(MessageType.CTCP);
			expect(shown[0].ctcpMessage).to.equal("VERSION Foo 1.0");
		});
	});

	it("a line that only ends in \\x01 is a plain message", function () {
		const h = setup();
		const id = joined(h);
		h.transport.line(":bob!bob@host.example PRIVMSG #seance :hello\x01");
		const shown = h.messages(id);
		expect(shown).to.have.length(1);
		expect(shown[0].type).to.equal(MessageType.MESSAGE);
		expect(shown[0].text).to.equal("hello\x01");
	});

	describe("STATUSMSG targets", function () {
		it("puts @#chan in the channel with its group", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":bob!bob@host.example PRIVMSG @#seance :ops only");
			const shown = h.messages(id);
			expect(shown).to.have.length(1);
			expect(shown[0].statusmsgGroup).to.equal("@");
		});

		it("leaves a plain channel target alone", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":bob!bob@host.example PRIVMSG #seance :everyone");
			const shown = h.messages(id);
			expect(shown).to.have.length(1);
			expect(shown[0]).to.not.have.property("statusmsgGroup");
		});

		it("does not read ##chan as a status prefix on #chan", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":bob!bob@host.example PRIVMSG ##seance :elsewhere");
			expect(h.messages(id)).to.deep.equal([]);
		});
	});

	describe("the message's fields", function () {
		it("carries no optional field a plain line does not have", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":bob!bob@host.example PRIVMSG #seance :plain");
			const [m] = h.messages(id);

			for (const key of [
				"msgid",
				"fromAccount",
				"showInActive",
				"statusmsgGroup",
				"replyTo",
				"editOf",
			]) {
				expect(m, key).to.not.have.property(key);
			}
		});

		it("carries msgid, account, reply and edit from the tags", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(
				"@msgid=m9;account=bobacct;+draft/reply=m1;+seance/edit=m2 :bob!bob@host.example PRIVMSG #seance :x"
			);
			const [m] = h.messages(id);
			expect(m.msgid).to.equal("m9");
			expect(m.fromAccount).to.equal("bobacct");
			expect(m.replyTo).to.equal("m1");
			expect(m.editOf).to.equal("m2");
		});

		it("a NOTICE from someone with no window goes to the lobby, shown in the active one", function () {
			const h = setup();
			joined(h);
			h.transport.line(":dave!dave@host.example NOTICE alice :psst");
			const shown = lobbyMsgs(h);
			expect(shown).to.have.length(1);
			expect(shown[0].type).to.equal(MessageType.NOTICE);
			expect(shown[0].showInActive).to.equal(true);
		});
	});

	describe("edits", function () {
		it("someone else's edit drops the original from the inbox", function () {
			const h = setup();
			joined(h);
			h.transport.line(
				"@msgid=m2;+seance/edit=m1 :bob!bob@host.example PRIVMSG #seance :fixed"
			);
			expect(h.payloads("inbox:drop")).to.deep.equal([
				{network: h.client.uuid, target: "#seance", msgid: "m1", by: "bob"},
			]);
		});

		it("a plain message drops nothing", function () {
			const h = setup();
			joined(h);
			h.transport.line("@msgid=m2 :bob!bob@host.example PRIVMSG #seance :hi");
			expect(h.payloads("inbox:drop")).to.deep.equal([]);
		});

		it("an edit of a message that is not loaded announces no msg:edit", function () {
			const h = setup();
			joined(h);
			h.transport.line(
				"@msgid=m2;+seance/edit=nope :bob!bob@host.example PRIVMSG #seance :fixed"
			);
			expect(h.payloads("msg:edit")).to.deep.equal([]);
		});
	});

	it("someone else's line with our pending text does not settle our copy", function () {
		const h = setup();
		const id = joined(h);
		h.client.sendMessage("#seance", "hello");
		h.transport.line("@msgid=b1 :bob!bob@host.example PRIVMSG #seance :hello");
		expect(h.payloads("msg:settled")).to.deep.equal([]);
		expect(h.messages(id).filter((m) => m.pending)).to.have.length(1);
	});

	describe("server lines", function () {
		it("a server NOTICE to a channel lands in that channel", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":irc.test NOTICE #seance :maintenance");
			expect(h.messages(id).map((m) => m.text)).to.deep.equal(["maintenance"]);
		});

		it("keeps the name of the server that sent it", function () {
			const h = setup();
			joined(h);
			h.transport.line(":srv.other NOTICE alice :hello");
			expect(lobbyMsgs(h).map((m) => m.from?.nick)).to.deep.equal(["srv.other"]);
		});

		it("a NOTICE with no prefix is from the server we dialled", function () {
			const h = setup();
			joined(h);
			h.transport.line("NOTICE alice :hello");
			const shown = lobbyMsgs(h);
			expect(shown.map((m) => m.text)).to.deep.equal(["hello"]);
			expect(shown[0].from?.nick).to.equal("irc.test");
		});
	});

	describe("Your privileges were modified", function () {
		function opered(): Harness {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test MODE alice :+o");
			h.sent();
			return h;
		}

		const asked = (lines: string[]) => lines.some((l) => /\bPRIVS\b/.test(l));

		it("a server NOTICE to us asks for the privileges again", async function () {
			const h = opered();
			h.transport.line(":irc.test NOTICE alice :Your privileges were modified");
			await Promise.resolve();
			expect(asked(h.sent())).to.equal(true);
		});

		it("the same words from a user, to a channel or worded otherwise ask nothing", async function () {
			const h = opered();
			h.transport.lines(
				":X3!x3@services.test NOTICE alice :Your privileges were modified",
				":irc.test NOTICE #seance :Your privileges were modified",
				":irc.test NOTICE alice :Your privileges were not modified"
			);
			await Promise.resolve();
			expect(asked(h.sent())).to.equal(false);
		});
	});

	describe("scripts", function () {
		it("hear a live line with its kind, never a replayed one", function () {
			const stub = sinon.stub(scriptManager, "dispatchMessage");
			const h = setup();
			joined(h, ALL_CAPS);
			h.transport.lines(
				":bob!bob@host.example PRIVMSG #seance :hi",
				":bob!bob@host.example PRIVMSG #seance :\x01ACTION waves\x01",
				":bob!bob@host.example NOTICE #seance :note"
			);
			expect(stub.getCalls().map((c) => [c.args[0].type, c.args[0].text])).to.deep.equal([
				["message", "hi"],
				["action", "waves"],
				["notice", "note"],
			]);
			stub.resetHistory();
			batch(h, ["@msgid=old1 :bob!bob@host.example PRIVMSG #seance :old"]);
			expect(stub.called).to.equal(false);
		});
	});
});
