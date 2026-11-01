/**
 * WHO replies matched to queries (client/js/irc/handlers/who.ts): which
 * replies are ours, how a row parses, and where a stray or unparsable one
 * is shown. Queries are registered with `beginWho` as commands/who.ts does.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {beginWho} from "../../../client/js/irc/handlers/who";
import {MessageType, SharedMsg, WhoEntry} from "../../../shared/types/msg";
import {Harness, joined, setup, stubStorage} from "../support";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

const ROW354 = (token: string) =>
	`:irc.test 354 alice ${token} #seance ~bob host.example irc.test bob H 0 0 :Bob`;

describe("handlers/who.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	function begin(h: Harness, query: {target: string; token?: string; custom?: boolean}): number {
		const chan = h.client.findChannel("#seance")!;
		beginWho(h.client, {...query, chan});
		return chan.id;
	}

	it("a WHOX row with another token is not ours: shown raw, unread, in the active window", function () {
		const h = setup();
		joined(h);
		const id = begin(h, {target: "#seance", token: "7"});
		const before = h.client.lobby.shared.unread;
		h.transport.lines(
			ROW354("8"),
			ROW354("7"),
			":irc.test 315 alice #seance :End of /WHO list."
		);
		const [raw] = lobbyMsgs(h);
		expect(raw.text).to.equal("8 #seance ~bob host.example irc.test bob H 0 0 Bob");
		expect(raw.showInActive).to.equal(true);
		expect(h.client.lobby.shared.unread).to.equal(before + 1);
		const table = h.messages(id).find((m) => m.type === MessageType.WHO)!;
		expect(table.who!.entries).to.have.length(1);
	});

	it("a plain 352 is not the answer to a WHOX query", function () {
		const h = setup();
		joined(h);
		begin(h, {target: "#seance", token: "7"});
		h.transport.line(":irc.test 352 alice #seance ~bob host.example irc.test bob H :0 Bob");
		expect(lobbyMsgs(h)).to.have.length(1);
	});

	it("a row of the user's own fields is shown raw where they asked, not unread", function () {
		const h = setup();
		const id = joined(h);
		begin(h, {target: "#seance", custom: true});
		const chan = h.client.findChannel("#seance")!;
		const before = chan.shared.unread;
		h.transport.line(":irc.test 354 alice bob 10.0.0.2");
		const [raw] = h.messages(id);
		expect(raw.text).to.equal("bob 10.0.0.2");
		expect(raw.showInActive).to.equal(false);
		expect(chan.shared.unread).to.equal(before);
	});

	it("a 352 cut short is shown raw and adds no row", function () {
		const h = setup();
		const id = joined(h);
		begin(h, {target: "#seance"});
		h.transport.lines(
			":irc.test 352 alice #seance ~bob host.example irc.test",
			":irc.test 315 alice #seance :End of /WHO list."
		);
		expect(h.messages(id).map((m) => [m.type, m.text])).to.deep.equal([
			[undefined, "#seance ~bob host.example irc.test"],
			[MessageType.ERROR, "No one matched WHO #seance"],
		]);
	});

	it("a WHOX row with the wrong number of fields is shown raw and adds no row", function () {
		const h = setup();
		const id = joined(h);
		begin(h, {target: "#seance", token: "7"});
		h.transport.lines(
			":irc.test 354 alice 7 #seance ~bob host.example",
			":irc.test 315 alice #seance :End of /WHO list."
		);
		const shown = h.messages(id);
		expect(shown[0].text).to.equal("7 #seance ~bob host.example");
		expect(shown[1].type).to.equal(MessageType.ERROR);
	});

	it("a 352 trailing with hops alone has no realname", function () {
		const h = setup();
		const id = joined(h);
		begin(h, {target: "#seance"});
		h.transport.lines(
			":irc.test 352 alice #seance ~bob host.example irc.test bob H :3",
			":irc.test 352 alice * ~carol c.example irc.test carol G :12 Carol C",
			":irc.test 315 alice #seance :End of /WHO list."
		);
		const entries = h.messages(id).find((m) => m.type === MessageType.WHO)!.who!
			.entries as WhoEntry[];
		expect(entries.map((e) => [e.hops, e.realname, e.channel])).to.deep.equal([
			[3, "", "#seance"],
			[12, "Carol C", undefined],
		]);
	});

	it("an untitled query takes its name from the 315", function () {
		const h = setup();
		const id = joined(h);
		begin(h, {target: ""});
		h.transport.line(":irc.test 315 alice #x :End of /WHO list.");
		begin(h, {target: ""});
		h.transport.lines(
			":irc.test 352 alice #x ~bob host.example irc.test bob H :0 Bob",
			":irc.test 315 alice #x :End of /WHO list."
		);
		const shown = h.messages(id);
		expect(shown[0].text).to.equal("No one matched WHO #x");
		expect(shown[1].who!.target).to.equal("#x");
	});
});
