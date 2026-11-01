/**
 * `/stats`, `/check` and `/privs` (client/js/irc/commands/oper.ts) beyond
 * the happy paths test/irc/oper.ts covers: how each answer ends, what a
 * silent server or a dropped socket leaves on the card, and whose
 * privileges a PRIVS reply describes.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../../client/js/socket";
import {IrcClient} from "../../../client/js/irc/client";
import {IdAllocator} from "../../../client/js/irc/ids";
import {dispatchInput} from "../../../client/js/irc/commands";
import {useNoticeLogBackend} from "../../../client/js/irc/noticelog";
import {useOperPrefsBackend} from "../../../client/js/irc/operprefs";
import {REQUEST_TIMEOUT_MS} from "../../../client/js/irc/request";
import type {Transport} from "../../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../../client/js/irc/transport";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {NO_FAKE_LAG} from "../../../client/js/irc/fakelag";

class FakeTransport implements Transport {
	state: TransportState = "closed";
	sent: string[] = [];
	private listeners: ((ev: TransportEvent) => void)[] = [];

	on(listener: (ev: TransportEvent) => void): () => void {
		this.listeners.push(listener);

		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	connect(): void {
		this.state = "connecting";
	}

	send(line: string): void {
		this.sent.push(line);
	}

	close(): void {
		this.state = "closed";
		this.emit({type: "close", code: 1006, reason: "", willReconnect: false});
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

	private emit(ev: TransportEvent): void {
		for (const listener of [...this.listeners]) {
			listener(ev);
		}
	}
}

let dispatch: sinon.SinonSpy;
let ownsSpy = false;

function installSpy(): void {
	const current = (socket as unknown as Record<string, unknown>).dispatch;

	if ((current as {isSinonProxy?: boolean}).isSinonProxy) {
		dispatch = current as sinon.SinonSpy;
		ownsSpy = false;
	} else {
		dispatch = sinon.spy(socket, "dispatch");
		ownsSpy = true;
	}

	const prefs = new Map<string, string>();
	useOperPrefsBackend({
		get: (key) => prefs.get(key) ?? null,
		set: (key, value) => prefs.set(key, value),
	});
	useNoticeLogBackend({
		load: () => Promise.resolve(undefined),
		save: () => Promise.resolve(),
		remove: () => Promise.resolve(),
	});
}

function removeSpy(): void {
	if (ownsSpy) {
		dispatch.restore();
	}

	useOperPrefsBackend(null);
	useNoticeLogBackend(null);
	socket.removeAllListeners();
}

interface MsgPayload {
	chan: number;
	msg: SharedMsg;
	unread?: number;
}

function payloads(chanId: number): MsgPayload[] {
	return dispatch
		.getCalls()
		.filter((call) => call.args[0] === "msg")
		.map((call) => call.args[1] as MsgPayload)
		.filter((p) => p.chan === chanId);
}

function messages(chanId: number): SharedMsg[] {
	return payloads(chanId).map((p) => p.msg);
}

/** A registered oper-capable client on nefarious2 with labeled-response. */
function setup(): {client: IrcClient; transport: FakeTransport} {
	const caps = "batch labeled-response message-tags server-time";
	const transport = new FakeTransport();
	const client = new IrcClient({
		host: "irc.test",
		port: 8443,
		tls: true,
		nick: "opr",
		join: "#seance,#other",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
		ids: new IdAllocator(),
		transportFactory: () => transport,
		highlights: () => ({keywords: [], exceptions: []}),
		fakeLag: NO_FAKE_LAG,
	});

	client.connect();
	transport.open();
	transport.lines(
		`:irc.test CAP * LS :${caps}`,
		`:irc.test CAP opr ACK :${caps}`,
		":irc.test 001 opr :Welcome to the SeanceDev IRC Network, opr",
		":irc.test 004 opr irc.test u2.10.12.14+Nefarious(2.0.0) abdgiknoqswxyzBDHLMNORWXY abCcDdhHikLlMmNnOopPQRrSsTtvZz bkLlov",
		":irc.test 005 opr CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=b,k,Ll,imnpst CASEMAPPING=rfc1459 WHOX :are supported by this server",
		":irc.test 422 opr :MOTD File is missing",
		":opr!opr@host JOIN #seance",
		":irc.test 353 opr = #seance :@opr bob",
		":irc.test 366 opr #seance :End of /NAMES list.",
		":opr!opr@host JOIN #other",
		":irc.test 353 opr = #other :@opr",
		":irc.test 366 opr #other :End of /NAMES list."
	);
	transport.sent = [];
	dispatch.resetHistory();

	return {client, transport};
}

function lastLabel(transport: FakeTransport): string {
	const m = /^@label=(\S+) /.exec(transport.sent[transport.sent.length - 1] ?? "");
	return m ? m[1] : "";
}

async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

describe("oper commands: /stats, /check, /privs (irc/commands/oper.ts)", function () {
	beforeEach(installSpy);
	afterEach(function () {
		sinon.restore();
		removeSpy();
	});

	describe("/stats", function () {
		it("names the selector the user asked for on the card", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/stats u");
			const label = lastLabel(transport);
			transport.lines(
				`@label=${label} :irc.test 242 opr :Server Up 0 days, 0:01:59`,
				`@label=${label} :irc.test 219 opr u :End of /STATS report`
			);
			await flush();

			const [msg] = messages(chan.id);
			expect(msg.report!.subtitle).to.equal("STATS u");
		});

		it("a bare /stats asks for the server's list of selectors", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/stats");
			expect(transport.sent).to.deep.equal(["@label=r1 STATS"]);
			transport.line("@label=r1 :irc.test 219 opr * :End of /STATS report");
			await flush();

			expect(messages(chan.id)[0].report!.subtitle).to.equal("STATS *");
		});

		it("an unbatched answer runs until the closing 219", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/stats u");
			const label = lastLabel(transport);
			transport.line(`@label=${label} :irc.test 242 opr :Server Up 0 days, 0:01:59`);
			await flush();
			// Not done yet: the 219 has not arrived.
			expect(messages(chan.id)).to.have.length(0);

			transport.lines(
				`@label=${label} :irc.test 250 opr :Highest connection count: 3 (2 clients)`,
				`@label=${label} :irc.test 219 opr u :End of /STATS report`
			);
			await flush();

			const msgs = messages(chan.id);
			expect(msgs).to.have.length(1);
			expect(msgs[0].report!.raw).to.include("Server Up 0 days, 0:01:59");
			expect(msgs[0].report!.raw).to.include("Highest connection count: 3 (2 clients)");
			expect(msgs[0].report!.error).to.equal(undefined);
		});

		it("is shown where it was typed without raising the unread count", async function () {
			const {client, transport} = setup();
			const other = client.findChannel("#other")!;
			client.setAttended(false);

			dispatchInput(client, other, "/stats u");
			transport.line(
				`@label=${lastLabel(transport)} :irc.test 219 opr u :End of /STATS report`
			);
			await flush();

			const [payload] = payloads(other.id);
			expect(payload.msg.type).to.equal(MessageType.REPORT);
			expect(payload.unread).to.equal(0);
			expect(other.shared.unread).to.equal(0);
		});

		it("says the server did not answer when nothing came back", async function () {
			const clock = sinon.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
			const {client} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/stats u");
			clock.tick(REQUEST_TIMEOUT_MS + 1);
			await flush();

			const [msg] = messages(chan.id);
			expect(msg.type).to.equal(MessageType.REPORT);
			expect(msg.report!.error).to.equal("The server did not answer.");
		});

		it("keeps what did arrive before a timeout, with no error", async function () {
			const clock = sinon.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/stats u");
			transport.line(
				`@label=${lastLabel(transport)} :irc.test 242 opr :Server Up 0 days, 0:01:59`
			);
			clock.tick(REQUEST_TIMEOUT_MS + 1);
			await flush();

			const [msg] = messages(chan.id);
			expect(msg.report!.raw).to.deep.equal(["Server Up 0 days, 0:01:59"]);
			expect(msg.report!.error).to.equal(undefined);
		});

		it("says the connection is down when the socket goes", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/stats u");
			transport.close();
			await flush();

			const report = messages(chan.id).find((m) => m.type === MessageType.REPORT)!;
			expect(report.report!.error).to.equal("Not sent: the connection is down.");
		});
	});

	describe("/check", function () {
		it("a bare /check is a usage error and sends nothing", function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/check");
			dispatchInput(client, chan, "/check   ");

			expect(transport.sent).to.deep.equal([]);
			const msgs = messages(chan.id);
			expect(msgs).to.have.length(2);
			msgs.forEach((m) => {
				expect(m.type).to.equal(MessageType.ERROR);
				expect(m.text).to.match(/^Usage: \/check /);
			});
		});

		it("drops the empty words of a double space", function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/check  bob  -o");
			expect(transport.sent).to.deep.equal(["@label=r1 CHECK bob -o"]);
		});

		it("an answer ending in 292 (no match) is the profile's card, not raw lines", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/check nobody");
			transport.line(
				`@label=${lastLabel(
					transport
				)} :irc.test 292 opr :CHECK nobody No matching record(s) found`
			);
			await flush();

			const msgs = messages(chan.id);
			expect(msgs).to.have.length(1);
			expect(msgs[0].report!.kind).to.equal("check");
			expect(msgs[0].report!.error).to.be.a("string").and.not.equal("");
		});

		it("an unbatched answer runs until the closing 291", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/check irc.test");
			const label = lastLabel(transport);
			transport.line(`@label=${label} :irc.test 290 opr :first line of the answer`);
			await flush();
			expect(messages(chan.id)).to.have.length(0);

			transport.lines(
				`@label=${label} :irc.test 290 opr :second line of the answer`,
				`@label=${label} :irc.test 291 opr :End of CHECK`
			);
			await flush();

			const msgs = messages(chan.id);
			expect(msgs).to.have.length(1);
			expect(msgs[0].report!.raw).to.include("first line of the answer");
			expect(msgs[0].report!.raw).to.include("second line of the answer");
		});
	});

	describe("/privs", function () {
		it("titles and counts the privileges, and records them as known", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/privs");
			transport.lines(
				":irc.test 270 opr opr :KILL CHECK",
				`@label=${lastLabel(transport)} :irc.test ACK`
			);
			await flush();

			const [msg] = messages(chan.id);
			const report = msg.report!;
			expect(report.kind).to.equal("privs");
			expect(report.title).to.equal("Privileges of opr");
			expect(msg.text).to.equal("Privileges of opr");
			expect(report.subtitle).to.equal("2 privileges");
			expect(report.command).to.equal("PRIVS");
			expect(report.sections[0].entries![0].label).to.equal("Privileges");
			expect(report.raw).to.deep.equal(["opr KILL CHECK"]);
			expect(client.oper.privsKnown).to.equal(true);
		});

		it("another oper's privileges are shown under their name, not kept as ours", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;
			client.oper.privs = ["KILL"];

			dispatchInput(client, chan, "/privs bob");
			expect(transport.sent).to.deep.equal(["@label=r1 PRIVS bob"]);
			transport.lines(":irc.test 270 opr bob :GLINE SHUN CHECK", "@label=r1 :irc.test ACK");
			await flush();

			const [msg] = messages(chan.id);
			expect(msg.report!.title).to.equal("Privileges of bob");
			expect(msg.report!.subtitle).to.equal("3 privileges");
			expect(client.oper.privs).to.deep.equal(["KILL"]);
		});

		it("an error reply is the card's error, with no privileges", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/privs bob");
			transport.line(
				`@label=${lastLabel(
					transport
				)} :irc.test 481 opr :Permission Denied: Insufficient privileges`
			);
			await flush();

			const msgs = messages(chan.id);
			expect(msgs).to.have.length(1);
			expect(msgs[0].report!.kind).to.equal("privs");
			expect(msgs[0].report!.error)
				.to.be.a("string")
				.and.match(/Permission Denied/);
			expect(msgs[0].report!.title).to.not.equal("Privileges of bob");
		});

		it("an ACK with no 270 says no privileges were reported", async function () {
			const {client, transport} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/privs");
			transport.line(`@label=${lastLabel(transport)} :irc.test ACK`);
			await flush();

			const msgs = messages(chan.id);
			expect(msgs).to.have.length(1);
			expect(msgs[0].report!.error).to.equal("No privileges reported.");
		});

		it("a silent server is reported as such", async function () {
			const clock = sinon.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
			const {client} = setup();
			const chan = client.findChannel("#seance")!;

			dispatchInput(client, chan, "/privs");
			clock.tick(REQUEST_TIMEOUT_MS + 1);
			await flush();

			expect(messages(chan.id)[0].report!.error).to.equal("The server did not answer.");
		});
	});
});
