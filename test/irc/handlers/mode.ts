/**
 * MODE, 324 and 221 (client/js/irc/handlers/mode.ts): how a mode string
 * splits, what it does to the user list and what is shown where.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {parseChannelModes} from "../../../client/js/irc/handlers/mode";
import {scriptManager} from "../../../client/js/irc/scripting/manager";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {batch, Harness, joined, setup, stubStorage} from "../support";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

describe("handlers/mode.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	describe("parseChannelModes", function () {
		it("gives each mode its parameter by CHANMODES and PREFIX, signs included", function () {
			const h = setup();
			joined(h);
			expect(
				parseChannelModes(h.client, "ov-v+mlb-lk+k", [
					"bob",
					"carol",
					"carol",
					"10",
					"*!*@x",
					"old",
					"new",
				])
			).to.deep.equal([
				{add: true, mode: "o", param: "bob"},
				{add: true, mode: "v", param: "carol"},
				{add: false, mode: "v", param: "carol"},
				{add: true, mode: "m", param: undefined},
				{add: true, mode: "l", param: "10"},
				{add: true, mode: "b", param: "*!*@x"},
				{add: false, mode: "l", param: undefined},
				{add: false, mode: "k", param: "old"},
				{add: true, mode: "k", param: "new"},
			]);
		});

		it("is empty for an empty string", function () {
			const h = setup();
			joined(h);
			expect(parseChannelModes(h.client, "", [])).to.deep.equal([]);
		});
	});

	describe("channel MODE", function () {
		it("shows the change with the users it names and updates their prefixes", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":bob!bob@host.example MODE #seance +vb carol *!*@x");
			const [m] = h.messages(id);
			expect(m.type).to.equal(MessageType.MODE);
			expect(m.text).to.equal("+vb carol *!*@x");
			expect(m.users).to.deep.equal(["carol"]);
			expect(h.payloads("users")).to.deep.equal([{chan: id}]);
			expect(h.client.findChannel("#seance")!.findUser("carol")!.modes).to.deep.equal(["+"]);
		});

		it("ranks prefixes by PREFIX order", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":bob!bob@host.example MODE #seance +v alice",
				":bob!bob@host.example MODE #seance +o alice"
			);
			expect(h.client.findChannel("#seance")!.findUser("alice")!.modes).to.deep.equal([
				"@",
				"+",
			]);
		});

		it("a change no user's prefix depends on does not touch the list", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":bob!bob@host.example MODE #seance +nt",
				":bob!bob@host.example MODE #seance +o nobody"
			);
			expect(h.payloads("users")).to.deep.equal([]);
		});

		it("a MODE with no prefix is the server's", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line("MODE #seance +n");
			expect(h.messages(id).map((m) => m.from?.nick)).to.deep.equal(["irc.test"]);
		});

		it("is told to scripts live, never from a replay", function () {
			const stub = sinon.stub(scriptManager, "dispatchMode");
			const h = setup();
			joined(h);
			h.transport.line(":bob!bob@host.example MODE #seance +o carol");
			expect(stub.callCount).to.equal(1);
			expect(stub.firstCall.args[0]).to.deep.equal({
				network: h.client.name,
				networkUuid: h.client.uuid,
				target: "#seance",
				mode: "+o",
				params: ["carol"],
				from: "bob",
			});
			batch(h, ["@msgid=h1 :bob!bob@host.example MODE #seance +v carol"]);
			expect(stub.callCount).to.equal(1);
		});
	});

	describe("our own user MODE", function () {
		it("is shown in the lobby by who set it", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test MODE alice :+x");
			const [m] = lobbyMsgs(h);
			expect(m.from).to.deep.equal({nick: "irc.test", mode: ""});
			expect(m.text).to.equal("+x");
		});

		it("from a replay is not the oper signal", function () {
			const h = setup();
			joined(h);
			batch(h, ["@msgid=h1 :irc.test MODE alice +o"]);
			expect(h.payloads("oper:state")).to.deep.equal([]);
			h.transport.line(":irc.test MODE alice :+o");
			expect(h.payloads("oper:state")).to.not.deep.equal([]);
		});
	});

	describe("324", function () {
		it("for a channel we are in sets the key and shows news without following the user", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":irc.test 324 alice #seance +lk 10 sesame");
			const chan = h.client.findChannel("#seance")!;
			expect(chan.shared.key).to.equal("sesame");
			const [m] = h.messages(id);
			expect(m.type).to.equal(MessageType.MODE_CHANNEL);
			expect(m.text).to.equal("+lk 10 sesame");
			expect(m.showInActive).to.equal(undefined);
		});

		it("asked for, follows the user's tab", function () {
			const h = setup();
			const id = joined(h);
			h.client.findChannel("#seance")!.modesAsked = true;
			h.transport.line(":irc.test 324 alice #seance +nt");
			expect(h.messages(id)[0].showInActive).to.equal(true);
		});

		it("for a channel we are not in, only when asked, in the lobby", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 324 alice #other +nt");
			expect(lobbyMsgs(h)).to.deep.equal([]);
			h.client.markInfoAsked("#other");
			h.client.markInfoAsked("#third");
			h.transport.lines(
				":irc.test 324 alice #other +nt",
				":irc.test 324 alice #third +lk 10 sesame"
			);
			expect(lobbyMsgs(h).map((m) => [m.type, m.text, m.showInActive])).to.deep.equal([
				[MessageType.MODE_CHANNEL, "#other +nt", true],
				[MessageType.MODE_CHANNEL, "#third +lk 10 sesame", true],
			]);
		});
	});
});
