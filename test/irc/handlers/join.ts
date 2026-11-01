/**
 * JOIN and KICK (client/js/irc/handlers/join.ts, kick.ts): the lines shown,
 * the user list and channel state they leave, and what scripts hear.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {ChanState} from "../../../shared/types/chan";
import {scriptManager} from "../../../client/js/irc/scripting/manager";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {batch, joined, setup, stubStorage} from "../support";

describe("handlers/join.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("tells scripts who joined, with their account, only live", function () {
		const stub = sinon.stub(scriptManager, "dispatchJoin");
		const h = setup();
		joined(h);
		stub.resetHistory();
		h.transport.lines(
			":dave!d@dave.example JOIN #seance daveacct :Dave",
			":erin!e@erin.example JOIN #seance * :Erin"
		);
		expect(stub.getCalls().map((c) => c.args[0])).to.deep.equal([
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				channel: "#seance",
				nick: "dave",
				account: "daveacct",
				ident: "d",
				host: "dave.example",
				self: false,
			},
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				channel: "#seance",
				nick: "erin",
				account: undefined,
				ident: "e",
				host: "erin.example",
				self: false,
			},
		]);
		stub.resetHistory();
		batch(h, ["@msgid=h1 :frank!f@f.example JOIN #seance"]);
		expect(stub.called).to.equal(false);
	});

	it("a JOIN with no one behind it is ignored", function () {
		const h = setup();
		const id = joined(h);
		h.transport.line("JOIN #seance");
		expect(h.messages(id)).to.deep.equal([]);
	});

	it("a replayed JOIN is a line with its hostmask in the replay's channel", function () {
		const h = setup();
		const id = joined(h);
		batch(h, [
			"@msgid=h1 :frank!f@f.example JOIN #seance",
			"@msgid=h2 :gina!g@g.example JOIN #elsewhere",
		]);
		const shown = h
			.payloads<{chan: number; messages: SharedMsg[]}>("more")
			.filter((p) => p.chan === id)
			.flatMap((p) => p.messages)
			.filter((m) => m.type === MessageType.JOIN);
		expect(shown.map((m) => [m.from?.nick, m.hostmask])).to.deep.equal([
			["frank", "f@f.example"],
			["gina", "g@g.example"],
		]);
		// History changes no state.
		expect(h.client.findChannel("#seance")!.findUser("frank")).to.equal(undefined);
	});

	it("someone else joining a channel we are not in opens nothing", function () {
		const h = setup();
		joined(h);
		h.transport.line(":dave!d@dave.example JOIN #nowhere");
		expect(h.client.findChannel("#nowhere")).to.equal(undefined);
	});

	it("someone else joining keeps the user list and its prefixes", function () {
		const h = setup();
		joined(h);
		h.transport.lines(
			":dave!d@dave.example JOIN #seance",
			":carol!c@carol.example JOIN #seance"
		);
		const chan = h.client.findChannel("#seance")!;
		expect(chan.findUser("bob")).to.not.equal(undefined);
		expect(chan.findUser("dave")).to.not.equal(undefined);
		expect(chan.findUser("carol")!.modes).to.deep.equal(["+"]);
		expect(h.payloads("channel:state")).to.deep.equal([]);
	});

	it("our JOIN for a channel we are already in changes no state", function () {
		const h = setup();
		const id = joined(h);
		h.transport.line(":alice!alice@host.example JOIN #seance");
		expect(h.payloads("channel:state")).to.deep.equal([]);
		expect(h.client.findChannel("#seance")!.findUser("bob")).to.not.equal(undefined);
		expect(h.messages(id)).to.deep.equal([]);
	});

	it("our JOIN after a kick starts the user list afresh", function () {
		const h = setup();
		const id = joined(h);
		h.transport.lines(
			":bob!bob@host.example KICK #seance alice :bye",
			":dave!d@dave.example JOIN #seance",
			":alice!alice@host.example JOIN #seance"
		);
		const chan = h.client.findChannel("#seance")!;
		expect(chan.state).to.equal(ChanState.JOINED);
		expect(chan.findUser("dave")).to.equal(undefined);
		expect(chan.findUser("alice")).to.not.equal(undefined);
		expect(h.payloads("channel:state")).to.deep.equal([
			{chan: id, state: ChanState.PARTED},
			{chan: id, state: ChanState.JOINED},
		]);
	});
});

describe("handlers/kick.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("tells scripts the reason, or none", function () {
		const stub = sinon.stub(scriptManager, "dispatchKick");
		const h = setup();
		joined(h);
		h.transport.lines(
			":alice!alice@host.example KICK #seance bob :spam",
			":alice!alice@host.example KICK #seance carol"
		);
		expect(stub.getCalls().map((c) => c.args[0])).to.deep.equal([
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				channel: "#seance",
				nick: "alice",
				kicked: "bob",
				reason: "spam",
				self: false,
			},
			{
				network: h.client.name,
				networkUuid: h.client.uuid,
				channel: "#seance",
				nick: "alice",
				kicked: "carol",
				reason: undefined,
				self: false,
			},
		]);
	});

	it("shows a kick without a reason with empty text, and one from the server", function () {
		const h = setup();
		const id = joined(h);
		h.transport.lines(":alice!alice@host.example KICK #seance bob", "KICK #seance carol");
		const shown = h.messages(id);
		expect(shown.map((m) => [m.type, m.text])).to.deep.equal([
			[MessageType.KICK, ""],
			[MessageType.KICK, ""],
		]);
		expect(h.client.findChannel("#seance")!.findUser("carol")).to.equal(undefined);
	});

	it("a KICK naming nobody is ignored", function () {
		const h = setup();
		const id = joined(h);
		h.transport.line(":bob!bob@host.example KICK #seance");
		expect(h.messages(id)).to.deep.equal([]);
	});

	it("being kicked leaves the channel parted and off the autojoin", function () {
		const h = setup();
		joined(h);
		h.transport.line(":bob!bob@host.example KICK #seance alice :bye");
		const chan = h.client.findChannel("#seance")!;
		expect(chan.state).to.equal(ChanState.PARTED);
		expect(chan.autoJoin).to.equal(false);
		expect(h.messages(chan.id)[0].highlight).to.equal(true);
	});
});
