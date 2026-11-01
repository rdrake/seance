/**
 * TOPIC / 331 / 332 / 333, QUIT, PART, NICK, TOKEN and METADATA 770
 * (client/js/irc/handlers/{topic,quit,part,nick,token,metadata}.ts): what
 * each line shows, the state it leaves and what scripts hear.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {scriptManager} from "../../../client/js/irc/scripting/manager";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {batch, Harness, joined, setup, stubStorage} from "../support";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

describe("handlers/topic.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("a TOPIC change is shown, kept, announced and told to scripts", function () {
		const stub = sinon.stub(scriptManager, "dispatchTopic");
		const h = setup();
		const id = joined(h);
		h.transport.lines(
			":bob!bob@host.example TOPIC #seance :new topic",
			"TOPIC #seance :by server"
		);
		expect(h.messages(id).map((m) => [m.type, m.text])).to.deep.equal([
			[MessageType.TOPIC, "new topic"],
			[MessageType.TOPIC, "by server"],
		]);
		expect(stub.firstCall.args[0]).to.deep.equal({
			network: h.client.name,
			networkUuid: h.client.uuid,
			channel: "#seance",
			topic: "new topic",
			nick: "bob",
		});
	});

	it("331 for a channel we are not in is shown only when asked", function () {
		const h = setup();
		joined(h);
		h.transport.line(":irc.test 331 alice #other :No topic is set");
		expect(lobbyMsgs(h)).to.deep.equal([]);
		h.client.markInfoAsked("#other");
		h.transport.line(":irc.test 331 alice #other :No topic is set");
		expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal(["No topic is set for #other."]);
	});

	it("331 clears the topic, and a 333 after it is shown", function () {
		const h = setup();
		const id = joined(h);
		h.transport.lines(
			":irc.test 332 alice #seance :hello",
			":irc.test 332 alice #seance :hello", // repeated: quiet
			":irc.test 331 alice #seance :No topic is set"
		);
		const chan = h.client.findChannel("#seance")!;
		expect(chan.shared.topic).to.equal("");
		expect(h.payloads("topic").pop()).to.deep.equal({chan: id, topic: ""});
		h.dispatch.resetHistory();
		h.transport.line(":irc.test 333 alice #seance bob!bob@host 1700000000");
		expect(h.messages(id).map((m) => m.type)).to.deep.equal([MessageType.TOPIC_SET_BY]);
	});

	it("an asked-for 331 is shown once, in the active window", function () {
		const h = setup();
		const id = joined(h);
		const chan = h.client.findChannel("#seance")!;
		chan.topicAsked = true;
		h.transport.lines(
			":irc.test 331 alice #seance :No topic is set",
			":irc.test 332 alice #seance :"
		);
		const shown = h.messages(id);
		expect(shown.map((m) => [m.text, m.showInActive])).to.deep.equal([
			["No topic is set.", true],
		]);
	});

	it("only the asked-for 333 follows the user's tab", function () {
		const h = setup();
		const id = joined(h);
		h.client.findChannel("#seance")!.topicAsked = true;
		h.transport.lines(
			":irc.test 332 alice #seance :one",
			":irc.test 333 alice #seance bob!bob@host 1700000000",
			":irc.test 333 alice #seance bob!bob@host 1700000000",
			":irc.test 332 alice #seance :two",
			":irc.test 333 alice #seance bob!bob@host 1700000001"
		);
		const setBy = h.messages(id).filter((m) => m.type === MessageType.TOPIC_SET_BY);
		expect(setBy.map((m) => m.showInActive)).to.deep.equal([true, undefined, undefined]);
	});
});

describe("handlers/quit.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("is shown only in the channels the user was in, with the hostmask", function () {
		const h = setup();
		const id = joined(h);
		h.transport.lines(
			":alice!alice@host.example JOIN #other",
			":irc.test 353 alice = #other :@alice carol",
			":irc.test 366 alice #other :End of /NAMES list."
		);
		const other = h.client.findChannel("#other")!.id;
		h.dispatch.resetHistory();
		h.transport.line(":bob!b@bob.example QUIT :gone");
		expect(h.messages(id).map((m) => [m.type, m.text, m.hostmask])).to.deep.equal([
			[MessageType.QUIT, "gone", "b@bob.example"],
		]);
		expect(h.messages(other)).to.deep.equal([]);
		expect(h.client.findChannel("#seance")!.findUser("bob")).to.equal(undefined);
	});

	it("tells scripts live, with no message for an empty reason, and never a QUIT from nobody", function () {
		const stub = sinon.stub(scriptManager, "dispatchQuit");
		const h = setup();
		joined(h);
		h.transport.lines(":bob!b@bob.example QUIT :gone", ":carol!c@c.example QUIT", "QUIT :x");
		expect(stub.getCalls().map((c) => c.args[0])).to.deep.equal([
			{network: h.client.name, networkUuid: h.client.uuid, nick: "bob", message: "gone"},
			{network: h.client.name, networkUuid: h.client.uuid, nick: "carol", message: undefined},
		]);
		stub.resetHistory();
		batch(h, ["@msgid=h1 :dave!d@d.example QUIT :old"]);
		expect(stub.called).to.equal(false);
	});
});

describe("handlers/part.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("shows a part without a reason with empty text", function () {
		const h = setup();
		const id = joined(h);
		h.transport.line(":bob!b@bob.example PART #seance");
		expect(h.messages(id).map((m) => [m.type, m.text, m.hostmask])).to.deep.equal([
			[MessageType.PART, "", "b@bob.example"],
		]);
	});

	it("tells scripts live, never for a PART from nobody", function () {
		const stub = sinon.stub(scriptManager, "dispatchPart");
		const h = setup();
		const id = joined(h);
		h.transport.lines(
			":bob!b@bob.example PART #seance :bye",
			":carol!c@c.example PART #seance",
			"PART #seance"
		);
		expect(stub.getCalls().map((c) => c.args[0])).to.deep.equal([
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				channel: "#seance",
				nick: "bob",
				message: "bye",
				self: false,
			},
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				channel: "#seance",
				nick: "carol",
				message: undefined,
				self: false,
			},
		]);
		expect(h.messages(id)).to.have.length(2);
		stub.resetHistory();
		batch(h, ["@msgid=h1 :dave!d@d.example PART #seance"]);
		expect(stub.called).to.equal(false);
	});
});

describe("handlers/nick.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("someone else's change renames them where they are, and is not ours", function () {
		const h = setup();
		const id = joined(h);
		h.transport.line(":bob!b@bob.example NICK bobby");
		expect(h.client.nick).to.equal("alice");
		expect(lobbyMsgs(h)).to.deep.equal([]);
		expect(h.messages(id).map((m) => m.new_nick)).to.deep.equal(["bobby"]);
		expect(h.payloads("users")).to.deep.equal([{chan: id}]);
	});

	it("ours is said in the lobby, unread", function () {
		const h = setup();
		joined(h);
		const before = h.client.lobby.shared.unread;
		h.transport.line(":alice!alice@host.example NICK alice2");
		expect(h.client.nick).to.equal("alice2");
		expect(lobbyMsgs(h).map((m) => m.text)).to.deep.equal(["You're now known as alice2"]);
		expect(h.client.lobby.shared.unread).to.equal(before + 1);
	});

	it("tells scripts live whether it is ours, and never a NICK from nobody", function () {
		const stub = sinon.stub(scriptManager, "dispatchNick");
		const h = setup();
		joined(h);
		h.transport.lines(
			":bob!b@bob.example NICK bobby",
			":alice!alice@host.example NICK alice2",
			"NICK nobody"
		);
		expect(stub.getCalls().map((c) => c.args[0])).to.deep.equal([
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				oldNick: "bob",
				newNick: "bobby",
				self: false,
			},
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				oldNick: "alice",
				newNick: "alice2",
				self: true,
			},
		]);
		stub.resetHistory();
		batch(h, ["@msgid=h1 :carol!c@c.example NICK caroline"]);
		expect(stub.called).to.equal(false);
	});
});

describe("handlers/token.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("only a TOKEN GENERATE for the service answers the request", async function () {
		const h = setup();
		joined(h);
		const p = h.client.generateToken("FILEHOST");
		h.transport.lines(
			":irc.test TOKEN NEW FILEHOST :https://up.example/filehost",
			":irc.test TOKEN GENERATE * :chunk",
			":irc.test TOKEN GENERATE",
			":irc.test TOKEN GENERATE FILEHOST :real"
		);
		expect(await p).to.equal("real");
	});

	it("a batch answers with its GENERATE chunks only, and an empty one answers nothing", async function () {
		const h = setup();
		joined(h);
		const p = h.client.generateToken("FILEHOST");
		h.transport.lines(
			":irc.test BATCH +e draft/authtoken FILEHOST",
			":irc.test BATCH -e",
			":irc.test BATCH +s draft/authtoken *",
			"@batch=s :irc.test TOKEN GENERATE * :service-list",
			":irc.test BATCH -s",
			":irc.test BATCH +t draft/authtoken FILEHOST",
			"@batch=t :irc.test TOKEN SERVICE FILEHOST :x",
			"@batch=t :irc.test NOTICE GENERATE y :z",
			"@batch=t :irc.test TOKEN GENERATE * :one.",
			"@batch=t :irc.test TOKEN GENERATE * :two",
			":irc.test BATCH -t"
		);
		expect(await p).to.equal("one.two");
	});
});

describe("handlers/metadata.ts 770", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("is silent when every key it names is ours, however they are spaced", function () {
		const h = setup();
		joined(h);
		h.transport.line(":irc.test 770 alice :draft/webpush/mute  draft/webpush/payload ");
		expect(lobbyMsgs(h)).to.deep.equal([]);
	});

	it("is shown when it names no key or a key not ours", function () {
		const h = setup();
		joined(h);
		h.transport.lines(
			":irc.test 770 alice",
			":irc.test 770 alice :draft/webpush/mute other/key"
		);
		expect(lobbyMsgs(h).map((m) => m.type)).to.deep.equal([
			MessageType.UNHANDLED,
			MessageType.UNHANDLED,
		]);
	});
});
