/**
 * Standard replies (client/js/irc/handlers/standard-replies.ts): FAIL / WARN /
 * NOTE, which ones the user sees, how they read and where they land.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {Harness, joined, register, setup, stubStorage} from "../support";

function lobbyMsgs(h: Harness): SharedMsg[] {
	return h.messages(h.client.lobby.id);
}

function lobbyTexts(h: Harness): string[] {
	return lobbyMsgs(h).map((m) => m.text);
}

describe("handlers/standard-replies.ts", function () {
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		stubStorage();
		clock = sinon.useFakeTimers({
			now: new Date("2026-08-25T12:00:00.000Z"),
			toFake: ["setTimeout", "clearTimeout", "Date"],
		});
	});

	afterEach(function () {
		clock.restore();
		sinon.restore();
		socket.removeAllListeners();
	});

	describe("anything else is shown raw in the lobby", function () {
		it("FAIL: command, description, context and the code, as an error shown in the active window", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test FAIL FOO SOME_CODE a b :Something broke");
			const [m] = lobbyMsgs(h);
			expect(m.text).to.equal("FOO: Something broke (a b) [FAIL SOME_CODE]");
			expect(m.type).to.equal(MessageType.ERROR);
			expect(m.showInActive).to.equal(true);
		});

		it("counts as unread in the lobby", function () {
			const h = setup();
			joined(h);
			const before = h.client.lobby.shared.unread;
			h.transport.line(":irc.test FAIL FOO SOME_CODE :x");
			expect(h.client.lobby.shared.unread).to.equal(before + 1);
		});

		it("a NOTE is not an error", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test NOTE FOO SOME_CODE :fyi");
			const [m] = lobbyMsgs(h);
			expect(m.text).to.equal("FOO: fyi [NOTE SOME_CODE]");
			expect(m.type).to.not.equal(MessageType.ERROR);
		});

		it("the * command is left out, and a missing description is empty", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test FAIL * ACCOUNT_REQUIRED :Log in first",
				":irc.test FAIL FOO BAR"
			);
			expect(lobbyTexts(h)).to.deep.equal([
				"Log in first [FAIL ACCOUNT_REQUIRED]",
				"FOO:  [FAIL BAR]",
			]);
		});

		it("a MULTILINE_ code on another command is not a multiline failure", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test FAIL FOO MULTILINE_MAX_BYTES 4096 :x");
			expect(lobbyTexts(h)).to.deep.equal(["FOO: x (4096) [FAIL MULTILINE_MAX_BYTES]"]);
		});
	});

	describe("WARN BATCH MULTILINE_FALLBACK", function () {
		it("is swallowed", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test WARN BATCH MULTILINE_FALLBACK :truncated for some");
			expect(lobbyMsgs(h)).to.deep.equal([]);
		});

		it("but other warnings, the code elsewhere and a NOTE of it are shown", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test WARN FOO BAR :w1",
				":irc.test WARN FOO MULTILINE_FALLBACK :w2",
				":irc.test NOTE BATCH MULTILINE_FALLBACK :w3"
			);
			expect(lobbyTexts(h)).to.deep.equal([
				"FOO: w1 [WARN BAR]",
				"FOO: w2 [WARN MULTILINE_FALLBACK]",
				"BATCH: w3 [NOTE MULTILINE_FALLBACK]",
			]);
		});
	});

	describe("PERSISTENCE", function () {
		it("FAIL CURSOR_UNKNOWN is silent, but not as a WARN or on another command", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test FAIL PERSISTENCE CURSOR_UNKNOWN m1 :gone",
				":irc.test WARN PERSISTENCE CURSOR_UNKNOWN m1 :w",
				":irc.test FAIL FOO CURSOR_UNKNOWN m1 :f"
			);
			expect(lobbyTexts(h)).to.deep.equal([
				"PERSISTENCE: w (m1) [WARN CURSOR_UNKNOWN]",
				"FOO: f (m1) [FAIL CURSOR_UNKNOWN]",
			]);
		});
	});

	describe("METADATA", function () {
		it("a FAIL about a key we keep is silent; a WARN, another key or another command is shown", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test FAIL METADATA KEY_INVALID draft/webpush/payload :no",
				":irc.test WARN METADATA KEY_INVALID draft/webpush/payload :w",
				":irc.test FAIL METADATA KEY_INVALID other/key :o",
				":irc.test FAIL FOO KEY_INVALID draft/webpush/payload :f"
			);
			expect(lobbyTexts(h)).to.deep.equal([
				"METADATA: w (draft/webpush/payload) [WARN KEY_INVALID]",
				"METADATA: o (other/key) [FAIL KEY_INVALID]",
				"FOO: f (draft/webpush/payload) [FAIL KEY_INVALID]",
			]);
		});
	});

	describe("NOTE BOUNCER", function () {
		it("ALIAS_ATTACHED inside the settling window is silent and marks the alias", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test NOTE BOUNCER ALIAS_ATTACHED :Attached");
			expect(h.client.bouncerAlias).to.equal(true);
			expect(lobbyMsgs(h)).to.deep.equal([]);
		});

		it("another bouncer note in the window is shown and marks nothing", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test NOTE BOUNCER SESSION_HELD :Held");
			expect(h.client.bouncerAlias).to.equal(false);
			expect(lobbyTexts(h)).to.deep.equal(["BOUNCER: Held [NOTE SESSION_HELD]"]);
		});

		it("ALIAS_ATTACHED after the window is shown", function () {
			const h = setup();
			joined(h);
			clock.tick(60_000);
			h.transport.line(":irc.test NOTE BOUNCER ALIAS_ATTACHED :Attached");
			expect(lobbyTexts(h)).to.deep.equal(["BOUNCER: Attached [NOTE ALIAS_ATTACHED]"]);
		});

		it("the code as a FAIL or under another command marks no alias", function () {
			const h = setup();
			joined(h);
			h.transport.lines(
				":irc.test FAIL BOUNCER ALIAS_ATTACHED :f",
				":irc.test NOTE FOO ALIAS_ATTACHED :n"
			);
			expect(h.client.bouncerAlias).to.equal(false);
			expect(lobbyMsgs(h)).to.have.length(2);
		});
	});

	describe("FAIL REDACT", function () {
		it("lands in the channel it names, not in the active window", function () {
			const h = setup();
			const id = joined(h);
			const before = h.client.findChannel("#seance")!.shared.unread;
			h.transport.line(
				":irc.test FAIL REDACT REDACT_FORBIDDEN #seance m1 :You may not redact that"
			);
			const [m] = h.messages(id);
			expect(m.type).to.equal(MessageType.ERROR);
			expect(m.text).to.equal(
				"Could not delete message: You are not allowed to delete that message."
			);
			expect(m.showInActive).to.equal(false);
			expect(h.client.findChannel("#seance")!.shared.unread).to.equal(before + 1);
		});

		it("without a target it goes to the lobby, shown in the active window", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test FAIL REDACT DISABLED :Disabled");
			const [m] = lobbyMsgs(h);
			expect(m.text).to.equal(
				"Could not delete message: Deleting messages is disabled on this server."
			);
			expect(m.showInActive).to.equal(true);
		});
	});

	describe("FAIL BATCH MULTILINE_*", function () {
		const CAPS =
			"message-tags server-time echo-message batch draft/multiline=max-bytes=16384,max-lines=1";

		it("reports where the context names a channel, even after one we do not have", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(
				":irc.test FAIL BATCH MULTILINE_INVALID_TARGET #other #seance :Mismatched target"
			);
			expect(h.messages(id).map((m) => m.text)).to.deep.equal([
				"Message not sent: its lines did not all go to the same target.",
			]);
			expect(h.messages(id)[0].showInActive).to.equal(false);
		});

		it("a channel whose name ends in a digit is still a channel", function () {
			const h = setup();
			joined(h);
			h.transport.line(":alice!alice@host.example JOIN #c2");
			const c2 = h.client.findChannel("#c2")!.id;
			h.dispatch.resetHistory();
			h.transport.line(":irc.test FAIL BATCH MULTILINE_INVALID_TARGET #c2 :Mismatched");
			expect(h.messages(c2)).to.have.length(1);
		});

		it("the description never names the channel", function () {
			const h = setup();
			const id = joined(h);
			h.transport.line(":irc.test FAIL BATCH MULTILINE_INVALID :#seance");
			expect(h.messages(id)).to.deep.equal([]);
			expect(lobbyTexts(h)).to.deep.equal(["Message not sent: #seance"]);
			expect(lobbyMsgs(h)[0].showInActive).to.equal(true);
		});

		it("the limit is the all-digit parameter", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test FAIL BATCH MULTILINE_MAX_BYTES 12ab #c9 4096 :Too long");
			expect(lobbyTexts(h)).to.deep.equal([
				"Message not sent: it was too long for one multi-line message (the server's limit is 4096 bytes).",
			]);
		});

		it("counts as unread where it lands", function () {
			const h = setup();
			const id = joined(h);
			const chan = h.client.findChannel("#seance")!;
			const before = chan.shared.unread;
			h.transport.line(":irc.test FAIL BATCH MULTILINE_INVALID_TARGET #seance :x");
			expect(h.messages(id)).to.have.length(1);
			expect(chan.shared.unread).to.equal(before + 1);
		});

		it("a cooldown with no seconds waits the one-second margin", function () {
			const h = setup();
			register(h, CAPS);
			h.transport.lines(
				":alice!alice@host.example JOIN #seance",
				":irc.test 366 alice #seance :End of /NAMES list."
			);
			const chan = h.client.findChannel("#seance")!;
			h.client.input(chan.id, "one\ntwo");
			h.sent();
			h.transport.line(":irc.test FAIL BATCH MULTILINE_COOLDOWN :Cooldown active");
			clock.tick(500);
			expect(h.sent()).to.deep.equal([]);
			clock.tick(500);
			expect(h.sent()).to.have.length(3);
		});
	});

	describe("FAIL WEBPUSH", function () {
		it("with no description reports an empty reason", function () {
			const h = setup();
			joined(h);
			h.transport.line(":irc.test FAIL WEBPUSH ACCOUNT_REQUIRED REGISTER");
			expect(h.payloads("webpush:state")).to.deep.equal([
				{
					network: h.client.uuid,
					action: "REGISTER",
					endpoint: "",
					ok: false,
					code: "ACCOUNT_REQUIRED",
					reason: "",
				},
			]);
			expect(lobbyMsgs(h)).to.deep.equal([]);
		});
	});

	describe("FAIL TOKEN", function () {
		it("rejects the waiting request with the code in upper case", async function () {
			const h = setup();
			joined(h);
			const p = h.client.generateToken("FILEHOST", "#seance");
			h.transport.line(":irc.test FAIL TOKEN No_Permissions #seance :Not for you");
			const err = (await p.catch((e: Error) => e)) as Error & {code: string};
			expect(err.code).to.equal("NO_PERMISSIONS");
			expect(err.message).to.equal("Not for you");
			expect(lobbyMsgs(h)).to.deep.equal([]);
		});

		it("another FAIL does not answer a waiting token request", async function () {
			const h = setup();
			joined(h);
			const p = h.client.generateToken("FILEHOST", "#seance");
			h.transport.line(":irc.test FAIL FOO BAR :unrelated");
			expect(lobbyTexts(h)).to.deep.equal(["FOO: unrelated [FAIL BAR]"]);
			h.transport.line(":irc.test TOKEN GENERATE FILEHOST :tok");
			expect(await p).to.equal("tok");
		});
	});
});
