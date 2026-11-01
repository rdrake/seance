/**
 * WHOIS / WHOWAS (client/js/irc/handlers/whois.ts): the one card a reply
 * builds, and RPL_AWAY outside a WHOIS.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import type {WhoisData} from "../../../client/js/irc/handlers/whois";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {Harness, joined, setup, stubStorage} from "../support";

const FP = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

/** Feed a WHOIS reply for bob (311 first, 318 last) and return the card. */
function whois(h: Harness, ...lines: string[]): WhoisData {
	h.transport.lines(
		":irc.test 311 alice bob ~bob host.example * :Bob Example",
		...lines,
		":irc.test 318 alice bob :End of /WHOIS list."
	);
	const card = lobbyMsgs(h).find((m) => m.type === MessageType.WHOIS);
	expect(card, "a whois card").to.not.equal(undefined);
	return card!.whois as WhoisData;
}

describe("handlers/whois.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	it("builds the card from the user line and shows it in the active window", function () {
		const h = setup();
		joined(h);
		const card = whois(h, ":irc.test 312 alice bob irc.test :The test server");
		expect(card).to.include({
			nick: "bob",
			ident: "~bob",
			hostname: "host.example",
			real_name: "Bob Example",
			server: "irc.test",
			server_info: "The test server",
		});
		expect(lobbyMsgs(h)[0].showInActive).to.equal(true);
	});

	it("a later 311 replaces the first; a later 314 does not", function () {
		const h = setup();
		joined(h);
		const card = whois(h, ":irc.test 311 alice bob ~b2 other.example * :Second");
		expect(card.ident).to.equal("~b2");

		const g = setup();
		joined(g);
		g.transport.lines(
			":irc.test 314 alice bob ~new new.example * :Newest",
			":irc.test 314 alice bob ~old old.example * :Older",
			":irc.test 369 alice bob :End of WHOWAS"
		);
		const was = lobbyMsgs(g)[0].whois as WhoisData;
		expect(was.ident).to.equal("~new");
		expect(was.whowas).to.equal(true);
	});

	it("without a user line it is `No such nick`", function () {
		const h = setup();
		joined(h);
		h.transport.lines(
			":irc.test 312 alice bob irc.test :The test server",
			":irc.test 318 alice bob :End of /WHOIS list."
		);
		const [m] = lobbyMsgs(h);
		expect(m.type).to.equal(MessageType.ERROR);
		expect(m.text).to.equal("No such nick: bob");
	});

	it("lines that name no nick add nothing and show nothing", function () {
		const h = setup();
		joined(h);
		h.transport.lines(
			":irc.test 311 alice",
			":irc.test 301 alice",
			":irc.test 320 alice",
			":irc.test 318 alice"
		);
		expect(lobbyMsgs(h)).to.deep.equal([]);
	});

	it("idle and sign-on only when the server sent them", function () {
		const h = setup();
		joined(h);
		const plain = whois(h);
		expect(plain).to.not.have.property("idleTime");
		expect(plain).to.not.have.property("logonTime");

		const g = setup();
		joined(g);
		const idleOnly = whois(g, ":irc.test 317 alice bob 10 :seconds idle");
		expect(idleOnly.idle).to.equal("10");
		expect(idleOnly).to.not.have.property("logon");
		expect(idleOnly).to.not.have.property("logonTime");

		const k = setup();
		joined(k);
		const both = whois(k, ":irc.test 317 alice bob 10 1700000000 :seconds idle, signon time");
		expect(both.logonTime).to.equal(1700000000 * 1000);
	});

	it("338 takes user, host and IP; a bare host has no user; Unreal's 338 is ignored", function () {
		const h = setup();
		joined(h);
		expect(
			whois(
				h,
				":irc.test 338 alice bob ~u@real.example 10.0.0.9 :Actual user@host, Actual IP"
			)
		).to.include({
			actual_username: "~u",
			actual_hostname: "real.example",
			actual_ip: "10.0.0.9",
		});

		const g = setup();
		joined(g);
		const bare = whois(g, ":irc.test 338 alice bob real.example 10.0.0.9 :Actual host, IP");
		expect(bare.actual_hostname).to.equal("real.example");
		expect(bare).to.not.have.property("actual_username");

		const k = setup();
		joined(k);
		const unreal = whois(k, ":irc.test 338 alice bob :is actually using host");
		expect(unreal).to.not.have.property("actual_ip");
		expect(unreal).to.not.have.property("actual_hostname");
	});

	it("378 takes the real host and IP", function () {
		const h = setup();
		joined(h);
		expect(
			whois(h, ":irc.test 378 alice bob :is connecting from ~u@real.example 10.0.0.9")
		).to.include({actual_hostname: "real.example", actual_ip: "10.0.0.9"});
	});

	it("certificate fingerprints: the hex at the end, else the whole text; the first is the one", function () {
		const h = setup();
		joined(h);
		const card = whois(
			h,
			`:irc.test 616 alice bob :has client certificate fingerprint ${FP}`,
			`:irc.test 616 alice bob :has client certificate fingerprint ${FP}.`,
			`:irc.test 276 alice bob :has client certificate fingerprint ${FP} (sha256)`
		);
		expect(card.certfp).to.equal(FP);
		expect(card.certfps).to.deep.equal([
			FP,
			`has client certificate fingerprint ${FP}.`,
			`has client certificate fingerprint ${FP} (sha256)`,
		]);
	});

	it("320: the bouncer line on its own, anything else as special text", function () {
		const h = setup();
		joined(h);
		const card = whois(
			h,
			":irc.test 320 alice bob :has a bouncer session (2 connections)",
			":irc.test 320 alice bob :is a friend who has a bouncer session"
		);
		expect(card.bouncer).to.equal("bouncer session (2 connections)");
		expect(card.special).to.deep.equal(["is a friend who has a bouncer session"]);
	});

	it("keeps helpop, bot and ASN lines under their names", function () {
		const h = setup();
		joined(h);
		expect(
			whois(
				h,
				":irc.test 310 alice bob :is available for help",
				":irc.test 335 alice bob :is a bot",
				":irc.test 569 alice bob :is connecting from AS64496"
			)
		).to.include({
			helpop: "is available for help",
			bot: "is a bot",
			asn: "is connecting from AS64496",
		});
	});

	describe("301 outside a WHOIS", function () {
		function withQuery(h: Harness): number {
			joined(h);
			h.transport.line(":bob!bob@host.example PRIVMSG alice :hi");
			h.dispatch.resetHistory();
			return h.client.findChannel("bob")!.id;
		}

		it("shows the away message once in the query", function () {
			const h = setup();
			const id = withQuery(h);
			h.transport.lines(":irc.test 301 alice bob :lunch", ":irc.test 301 alice bob :lunch");
			expect(h.messages(id).map((m) => [m.type, m.text])).to.deep.equal([
				[MessageType.AWAY, "lunch"],
			]);
		});

		it("lets the user's return show as back", function () {
			const h = setup();
			const id = withQuery(h);
			h.transport.lines(":irc.test 301 alice bob :lunch", ":bob!bob@host.example AWAY");
			expect(h.messages(id).map((m) => m.type)).to.deep.equal([
				MessageType.AWAY,
				MessageType.BACK,
			]);
		});

		it("shows nothing in a channel of that name or for a nick with no query", function () {
			const h = setup();
			const id = joined(h);
			h.transport.lines(":irc.test 301 alice #seance :x", ":irc.test 301 alice dave :x");
			expect(h.messages(id)).to.deep.equal([]);
			expect(lobbyMsgs(h)).to.deep.equal([]);
		});
	});
});

describe("handlers/away.ts", function () {
	beforeEach(function () {
		stubStorage();
	});

	afterEach(function () {
		sinon.restore();
		socket.removeAllListeners();
	});

	function queries(h: Harness): {bob: number; carol: number} {
		joined(h);
		h.transport.lines(
			":bob!bob@host.example PRIVMSG alice :hi",
			":carol!carol@host.example PRIVMSG alice :hi"
		);
		h.dispatch.resetHistory();
		return {bob: h.client.findChannel("bob")!.id, carol: h.client.findChannel("carol")!.id};
	}

	it("our own AWAY is shown in the lobby, our own star is not", function () {
		const h = setup();
		joined(h);
		h.transport.lines(
			":alice!alice@host.example AWAY :brb",
			":alice!alice@host.example AWAY *"
		);
		const shown = lobbyMsgs(h);
		expect(shown.map((m) => [m.type, m.text, m.self])).to.deep.equal([
			[MessageType.AWAY, "brb", true],
		]);
	});

	it("someone's AWAY shows its text in their query only, once", function () {
		const h = setup();
		const q = queries(h);
		h.transport.lines(":bob!bob@host.example AWAY :lunch", ":bob!bob@host.example AWAY :lunch");
		expect(h.messages(q.bob).map((m) => m.text)).to.deep.equal(["lunch"]);
		expect(h.messages(q.carol)).to.deep.equal([]);
	});

	it("a return from a star alone says nothing", function () {
		const h = setup();
		const q = queries(h);
		h.transport.lines(
			":bob!bob@host.example AWAY :lunch",
			":bob!bob@host.example AWAY",
			":bob!bob@host.example AWAY *",
			":bob!bob@host.example AWAY"
		);
		expect(h.messages(q.bob).map((m) => m.type)).to.deep.equal([
			MessageType.AWAY,
			MessageType.BACK,
		]);
	});

	it("306 is shown in the active window", function () {
		const h = setup();
		joined(h);
		h.transport.line(":irc.test 306 alice :You have been marked as being away");
		const [m] = lobbyMsgs(h);
		expect(m.text).to.equal("You have been marked as being away");
		expect(m.showInActive).to.equal(true);
	});
});
