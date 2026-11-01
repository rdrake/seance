/**
 * Registration and informational numerics, nick fallback and the generic
 * error path (client/js/irc/handlers/numerics.ts), and the fallback for
 * anything without a handler (client/js/irc/handlers/index.ts).
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {Harness, joined, setup, stubStorage} from "../support";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

/** Connected with no caps, before 001. */
function opening(h: Harness): void {
	h.client.connect();
	h.transport.open();
	h.transport.line(":irc.test CAP * LS :");
	h.sent();
	h.dispatch.resetHistory();
}

describe("handlers/numerics.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	describe("001", function () {
		it("takes the nick it names and shows the rest of the line, unread", function () {
			const h = setup();
			opening(h);
			const before = h.client.lobby.shared.unread;
			h.transport.line(":irc.test 001 alice2 Welcome :to the network");
			expect(h.client.nick).to.equal("alice2");
			const shown = lobbyMsgs(h);
			expect(shown.map((m) => m.text)).to.deep.equal(["Welcome to the network"]);
			expect(h.client.lobby.shared.unread).to.equal(before + 1);
		});

		it("keeps our nick when it names `*`", function () {
			const h = setup();
			opening(h);
			h.transport.line(":irc.test 001 * :Welcome");
			expect(h.client.nick).to.equal("alice");
		});
	});

	describe("008", function () {
		it("shows an unreadable mask as it came", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 008 alice bogus :Server notice mask");
			expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal(["bogus Server notice mask"]);
		});
	});

	describe("the MOTD", function () {
		it("collects 375/372/376 into one monospace block", function () {
			const h = setup();
			opening(h);
			h.transport.lines(
				":irc.test 001 alice :Welcome",
				":irc.test 375 alice :- irc.test Message of the Day -",
				":irc.test 372 alice :- hello",
				":irc.test 376 alice :End of /MOTD command."
			);
			const block = lobbyMsgs(h).find((m) => m.type === MessageType.MONOSPACE_BLOCK)!;
			expect(block.command).to.equal("motd");
			expect(block.text).to.equal("- irc.test Message of the Day -\n- hello");
			expect(h.client.isConnected).to.equal(true);
		});

		it("an end with nothing collected registers and shows nothing; 422 shows its text", function () {
			const h = setup();
			opening(h);
			h.transport.lines(
				":irc.test 001 alice :Welcome",
				":irc.test 376 alice :End of /MOTD command."
			);
			expect(h.client.isConnected).to.equal(true);
			expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal(["Welcome"]);

			const g = setup();
			opening(g);
			g.transport.lines(
				":irc.test 001 alice :Welcome",
				":irc.test 422 alice :MOTD File is missing"
			);
			expect(lobbyMsgs(g).map((m) => m.text)).to.deep.equal([
				"Welcome",
				"MOTD File is missing",
			]);
		});

		it("a stray MOTD line is shown on its own", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 372 alice :- late line");
			expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal(["- late line"]);
		});
	});

	describe("396", function () {
		it("takes the hidden host and shows the line", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 396 alice cloak.test :is now your hidden host");
			expect(h.client.host).to.equal("cloak.test");
			expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal([
				"cloak.test is now your hidden host",
			]);
		});

		it("without a host keeps the one it has", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 396 alice cloak.test :is now your hidden host");
			h.transport.line(":irc.test 396 alice");
			expect(h.client.host).to.equal("cloak.test");
		});
	});

	describe("432 / 433", function () {
		it("in use while registering: the next nick, and an error shown in the active window", function () {
			const h = setup();
			opening(h);
			const before = h.client.lobby.shared.unread;
			h.transport.line(":irc.test 433 * alice :Taken");
			expect(h.sent()).to.deep.equal(["NICK alice_"]);
			const [m] = lobbyMsgs(h);
			expect(m.text).to.equal("alice: Taken");
			expect(m.type).to.equal(MessageType.ERROR);
			expect(m.showInActive).to.equal(true);
			expect(h.client.lobby.shared.unread).to.equal(before + 1);
		});

		it("without a reason says what happened", function () {
			const h = setup();
			opening(h);
			h.transport.lines(":irc.test 433 * alice", ":irc.test 432 * x");
			expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal([
				"alice: Nickname is already in use.",
				"x: Nickname is invalid.",
			]);
		});

		it("at NICKLEN varies the end of the nick", function () {
			sinon.stub(Math, "random").returns(0.5);
			const h = setup();
			opening(h);
			h.transport.lines(
				":irc.test 001 alice :Welcome",
				":irc.test 005 alice NICKLEN=6 :are supported by this server"
			);
			h.sent();
			h.transport.line(":irc.test 433 alice alice_ :Taken");
			expect(h.sent()).to.deep.equal(["NICK al5500"]);
		});

		it("a nick refused that is not our fallback gets a generated one", function () {
			sinon.stub(Math, "random").returns(0.5);
			const h = setup();
			opening(h);
			h.transport.line(":irc.test 432 * alice :Erroneous");
			expect(h.sent()).to.deep.equal(["NICK seance5500"]);

			const g = setup();
			opening(g);
			g.transport.line(":irc.test 432 * bogus :Erroneous");
			expect(g.sent()).to.deep.equal(["NICK seance5500"]);
		});

		it("our fallback refused as erroneous learns the length and starts again, shorter", function () {
			const h = setup();
			opening(h);
			h.transport.line(":irc.test 433 * alice :Taken");
			expect(h.sent()).to.deep.equal(["NICK alice_"]);
			h.transport.line(":irc.test 432 * alice_ :Erroneous");
			expect(h.sent()).to.deep.equal(["NICK alic_"]);
		});

		it("a generated nick refused as erroneous caps the next try one short of it", function () {
			sinon.stub(Math, "random").returns(0.5);
			const h = setup({nick: "abcdefghijkl"});
			opening(h);
			h.transport.line(":irc.test 432 * abcdefghijkl :Erroneous");
			expect(h.sent()).to.deep.equal(["NICK seance5500"]);
			h.transport.line(":irc.test 432 * seance5500 :Erroneous");
			expect(h.sent()).to.deep.equal(["NICK abcdefgh_"]);
		});

		it("once connected only tells the UI the nick it still has", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test 433 alice bob :Taken");
			expect(h.sent()).to.deep.equal([]);
			expect(h.payloads("nick")).to.deep.equal([{network: h.client.uuid, nick: "alice"}]);
		});
	});

	describe("other errors", function () {
		it("one naming a channel we have lands there", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":irc.test 441 alice bob #seance :They aren't on that channel");
			const [m] = h.messages(id);
			expect(m.type).to.equal(MessageType.ERROR);
			expect(m.error).to.equal("user_not_in_channel");
			expect(m.nick).to.equal("bob");
			expect(m.channel).to.equal("#seance");
			expect(m.showInActive).to.equal(false);
			expect(m).to.not.have.property("command");
		});

		it("one naming nobody goes to the lobby, shown in the active window and unread", function () {
			const h = setup();
			joined(h);
			const before = h.client.lobby.shared.unread;
			h.transport.line(":irc.test 421 alice FOO :Unknown command");
			const [m] = lobbyMsgs(h);
			expect(m.command).to.equal("FOO");
			expect(m.reason).to.equal("Unknown command");
			expect(m.showInActive).to.equal(true);
			expect(m).to.not.have.property("nick");
			expect(m).to.not.have.property("channel");
			expect(h.client.lobby.shared.unread).to.equal(before + 1);
		});

		it("carries only the fields its parameters fill", function () {
			const h = setup();
			joined(h);
			h.transport.lines(":irc.test 401 alice bob :No such nick", ":irc.test 403 alice");
			const [nick, bare] = lobbyMsgs(h);
			expect(nick.nick).to.equal("bob");
			expect(nick).to.not.have.property("channel");
			expect(nick).to.not.have.property("command");
			expect(bare.reason).to.equal("");
			expect(bare).to.not.have.property("channel");
			expect(bare).to.not.have.property("nick");
		});
	});
});

describe("handlers/index.ts unhandled", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("shows a line without a handler in the channel it names, unread", function () {
		const h = setup();
		const id = joined(h);
		const chan = h.client.findChannel("#seance")!;
		const before = chan.shared.unread;
		h.transport.line(":irc.test 329 alice #seance 1700000000");
		h.transport.line(":irc.test FOOBAR #seance x");
		const shown = h.messages(id);
		expect(shown.map((m) => m.text)).to.include("FOOBAR #seance x");
		expect(shown.every((m) => m.type === MessageType.UNHANDLED)).to.equal(true);
		expect(chan.shared.unread).to.be.greaterThan(before);
	});

	it("keeps a first parameter that is not our nick", function () {
		const h = setup();
		joined(h);
		h.transport.lines(":irc.test FOOBAR bob baz", ":irc.test FOOBAR");
		expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal(["FOOBAR bob baz", "FOOBAR "]);
	});

	it("a four-digit numeric is not an error numeric", function () {
		const h = setup();
		joined(h);
		h.transport.lines(":irc.test 1400 alice :x", ":irc.test 4000 alice :y");
		expect(lobbyMsgs(h).map((m) => [m.type, m.text])).to.deep.equal([
			[MessageType.UNHANDLED, "1400 x"],
			[MessageType.UNHANDLED, "4000 y"],
		]);
	});
});
