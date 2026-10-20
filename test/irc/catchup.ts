import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {CATCHUP_STEP_COST_MS, pendingCatchup} from "../../client/js/irc/catchup";
import {BACKGROUND_BUDGET_MS, IRCU_FAKE_LAG} from "../../client/js/irc/fakelag";
import {ChanState} from "../../shared/types/chan";
import {ALL_CAPS, Harness, register, setup} from "./support";

// The spy from test/irc/client.ts's root-level beforeEach may be installed;
// only restore one we own (see CLAUDE.md).
describe("Connect burst: batched JOIN, catch-up paced by fake lag, lazy MODE (irc/catchup.ts)", function () {
	let clock: sinon.SinonFakeTimers;
	let ownSpy = false;

	beforeEach(function () {
		clock = sinon.useFakeTimers({now: Date.parse("2026-08-27T12:00:00.000Z")});

		if (!(socket.dispatch as any).isSinonProxy) {
			sinon.spy(socket, "dispatch");
			ownSpy = true;
		}
	});

	afterEach(function () {
		clock.restore();

		if (ownSpy) {
			(socket.dispatch as sinon.SinonSpy).restore();
			ownSpy = false;
		}
	});

	const CHANS = ["#seance", "#two", "#three", "#four"];

	const CAPS = ALL_CAPS + " draft/read-marker";

	/** Register (read markers on) with four autojoin channels. */
	function connected(): Harness {
		const h = setup({join: CHANS.join(","), fakeLag: IRCU_FAKE_LAG});
		register(h, CAPS);
		return h;
	}

	function joinAll(h: Harness): void {
		for (const name of CHANS) {
			h.transport.line(`:alice!alice@host JOIN ${name}`);
		}
	}

	/**
	 * Advance the clock to the background queue's next send and return what
	 * went out; checks that background work never pushed the server's clock
	 * past the budget it leaves the user.
	 */
	function nextBackground(h: Harness, filter: (l: string) => boolean = () => true): string[] {
		for (let i = 0; i < 200; i++) {
			clock.tick(100);
			const lines = h.sent().filter(filter);

			if (lines.length > 0) {
				expect(h.client.fakeLag.ahead()).to.be.at.most(BACKGROUND_BUDGET_MS);
				return lines;
			}
		}

		return [];
	}

	/**
	 * Run the clock until `count` more lines passing `filter` have gone out,
	 * with when each went (ms after the call); checks the budget at every send.
	 */
	function collect(
		h: Harness,
		count: number,
		filter: (l: string) => boolean = () => true
	): {line: string; at: number}[] {
		const start = Date.now();
		const out: {line: string; at: number}[] = [];

		for (let i = 0; i < 1000 && out.length < count; i++) {
			clock.tick(100);
			const lines = h.sent().filter(filter);

			if (lines.length > 0) {
				expect(h.client.fakeLag.ahead()).to.be.at.most(BACKGROUND_BUDGET_MS);
				out.push(...lines.map((line) => ({line, at: Date.now() - start})));
			}
		}

		return out;
	}

	function commandsOf(lines: string[]): string[] {
		return lines.map((l) =>
			l
				.replace(/^@\S+ /, "")
				.split(" ")
				.slice(0, 2)
				.join(" ")
		);
	}

	it("JOINs the autojoin list with one command", function () {
		const h = connected();
		const joins = h.transport.sent.filter((l) => l.startsWith("JOIN"));
		// The model keeps channels sorted; one JOIN carries them all.
		expect(joins).to.deep.equal(["JOIN #four,#seance,#three,#two"]);
	});

	it("puts keyed channels first and splits on TARGMAX / line length", function () {
		const h = connected();
		h.sent();
		h.client.joinChannels([
			{name: "#open"},
			{name: "#locked", key: "hunter2"},
			{name: "#open2"},
		]);
		expect(h.sent()).to.deep.equal(["JOIN #locked,#open,#open2 hunter2"]);

		h.transport.line(":irc.test 005 alice TARGMAX=JOIN:2 :are supported by this server");
		h.client.joinChannels([{name: "#a"}, {name: "#b"}, {name: "#c"}]);
		expect(h.sent()).to.deep.equal(["JOIN #a,#b", "JOIN #c"]);

		h.transport.line(":irc.test 005 alice TARGMAX=JOIN: :are supported by this server");
		const many = Array.from({length: 40}, (_, i) => ({name: `#channel-number-${i}`}));
		h.client.joinChannels(many);
		const lines = h.sent();
		expect(lines.length).to.be.greaterThan(1);

		for (const line of lines) {
			expect(Buffer.byteLength(line)).to.be.at.most(500);
		}

		expect(lines.flatMap((l) => l.split(" ")[1].split(","))).to.deep.equal(
			many.map((c) => c.name)
		);
	});

	it("serves only the active channel at once; the rest as the fake-lag clock allows", function () {
		const h = connected();
		const seance = h.client.findChannel("#seance")!;
		h.client.open(seance.id);
		h.sent();
		joinAll(h);

		// Active channel: its history now. Nothing for the others yet.
		const first = h.sent();
		expect(commandsOf(first)).to.deep.equal(["CHATHISTORY LATEST"]);
		expect(first[0]).to.include("#seance");
		expect(pendingCatchup(h.client).map((c) => c.name)).to.deep.equal([
			"#two",
			"#three",
			"#four",
		]);

		// Then, each job only once the clock has drained enough for it to
		// stay within the budget: its marker query (a server that volunteers
		// it has done so by then), its modes, then one channel at a time,
		// history first and its marker query right behind it.
		const sent = collect(h, 8);
		expect(commandsOf(sent.map((s) => s.line))).to.deep.equal([
			"MARKREAD #seance",
			"MODE #seance",
			"CHATHISTORY LATEST",
			"MARKREAD #two",
			"CHATHISTORY LATEST",
			"MARKREAD #three",
			"CHATHISTORY LATEST",
			"MARKREAD #four",
		]);
		// Steady state: a channel's two commands drain in their own 4 s.
		expect(sent[6].at - sent[4].at).to.equal(4000);
		expect(pendingCatchup(h.client)).to.deep.equal([]);
		clock.tick(CATCHUP_STEP_COST_MS * 6);
		expect(h.sent()).to.deep.equal([]);
	});

	it("leaves the user's lines out of the wait: the clock never sits at the ceiling", function () {
		const h = connected();
		h.client.open(h.client.findChannel("#seance")!.id);
		joinAll(h);
		h.sent();
		let peak = 0;

		for (let t = 0; t < 30_000; t += 100) {
			clock.tick(100);
			peak = Math.max(peak, h.client.fakeLag.ahead());
		}

		// Before: two commands every 4 s held it at ~10 s for the whole catch-up.
		expect(peak).to.be.at.most(BACKGROUND_BUDGET_MS + 2000);
		expect(pendingCatchup(h.client)).to.deep.equal([]);

		// Three lines typed now are all read at once by the server.
		for (let i = 0; i < 3; i++) {
			h.client.send(`PRIVMSG #seance :line ${i}`);
		}

		expect(h.client.fakeLag.ahead()).to.be.below(h.client.fakeLag.model.ceiling * 1000);
	});

	it("holds a typing notice back while anything else waits for the clock", function () {
		const h = connected();
		const seance = h.client.findChannel("#seance")!;
		h.client.open(seance.id);
		joinAll(h);
		h.sent();
		const tagmsgs = () => h.sent().filter((l) => l.includes("TAGMSG"));

		// The catch-up is still queued: the notice gives way to it.
		h.client.typing(seance, "active");
		expect(tagmsgs()).to.deep.equal([]);
		clock.tick(4000);
		h.client.typing(seance, "active");
		expect(tagmsgs()).to.deep.equal([]);

		// Once the queue is through and the clock has room, it goes.
		clock.tick(60_000);
		expect(pendingCatchup(h.client)).to.deep.equal([]);
		h.client.typing(seance, "active");
		expect(tagmsgs()).to.have.length(1);
	});

	it("asks the oper-up queries one at a time, behind the catch-up's room", async function () {
		const h = connected();
		h.client.open(h.client.findChannel("#seance")!.id);
		joinAll(h);
		h.sent();
		h.transport.line(":alice!alice@host MODE alice +o");
		await Promise.resolve();
		expect(h.sent().filter((l) => l.includes("PRIVS"))).to.deep.equal([]);
		let privs: string[] = [];

		for (let i = 0; i < 200 && privs.length === 0; i++) {
			await clock.tickAsync(100);
			privs = h.sent().filter((l) => l.includes("PRIVS"));
		}

		expect(privs).to.have.length(1);
		expect(h.client.fakeLag.ahead()).to.be.at.most(BACKGROUND_BUDGET_MS);
	});

	it("never sends MODE on JOIN; asks once when the channel is first opened", function () {
		const h = connected();
		h.sent();
		joinAll(h);
		clock.tick(CATCHUP_STEP_COST_MS * 8);
		expect(h.sent().filter((l) => l.startsWith("MODE"))).to.deep.equal([]);

		const two = h.client.findChannel("#two")!;
		h.client.open(two.id);
		expect(collect(h, 1, (l) => l.startsWith("MODE")).map((s) => s.line)).to.deep.equal([
			"MODE #two",
		]);
		h.client.open(0);
		h.client.open(two.id);
		expect(h.sent().filter((l) => l.startsWith("MODE"))).to.deep.equal([]);

		// A re-JOIN (after a reconnect: everything is PARTED, not removed)
		// asks again — #two is the active channel now, so behind its catch-up.
		h.transport.closed();
		register(h, CAPS);
		h.transport.line(":alice!alice@host JOIN #two");
		expect(nextBackground(h, (l) => l.startsWith("MODE"))).to.deep.equal(["MODE #two"]);
		h.client.open(h.client.findChannel("#two")!.id);
		expect(h.sent().filter((l) => l.startsWith("MODE"))).to.deep.equal([]);
	});

	it("opening a waiting channel serves it immediately and keeps pacing the rest", function () {
		const h = connected();
		const seance = h.client.findChannel("#seance")!;
		h.client.open(seance.id);
		joinAll(h);
		h.sent();

		const four = h.client.findChannel("#four")!;
		clock.tick(1000);
		h.client.open(four.id);
		const now = h.sent();
		// Opening marks the channel read up to its newest line (the JOIN), so
		// the stored marker is not asked for. The user is waiting for the
		// history: it goes out whatever the clock says; the modes wait.
		expect(commandsOf(now)).to.deep.equal(["CHATHISTORY LATEST"]);
		expect(now[0]).to.include("#four");
		expect(pendingCatchup(h.client).map((c) => c.name)).to.deep.equal(["#two", "#three"]);

		// The rest wait for the room those took (the debounced "read up to
		// here" markers are background work of their own).
		const catchupOnly = (l: string) => /^(@\S+ )?(CHATHISTORY|MARKREAD #two$)/.test(l);
		expect(commandsOf(collect(h, 2, catchupOnly).map((s) => s.line))).to.deep.equal([
			"CHATHISTORY LATEST",
			"MARKREAD #two",
		]);
	});

	it("skips the marker query when the server volunteered the marker before its turn", function () {
		const h = connected();
		const seance = h.client.findChannel("#seance")!;
		h.client.open(seance.id);
		// What nefarious2 does for a logged-in account: the marker right
		// behind each JOIN, `*` when none is stored.
		h.transport.line(":alice!alice@host JOIN #seance");
		h.transport.line(":irc.test MARKREAD #seance timestamp=*");
		h.transport.line(":alice!alice@host JOIN #two");
		h.transport.line(":irc.test MARKREAD #two timestamp=2026-08-27T11:00:00.000Z");
		h.sent(); // #seance's history went out with its JOIN
		const lines = collect(h, 2).map((s) => s.line);
		expect(commandsOf(lines), lines.join(" | ")).to.deep.equal([
			"MODE #seance",
			"CHATHISTORY LATEST",
		]);
		clock.tick(30_000);
		expect(h.sent().filter((l) => l.startsWith("MARKREAD"))).to.deep.equal([]);
	});

	it("drops channels that were left or removed while waiting, and everything on close", function () {
		const h = connected();
		const seance = h.client.findChannel("#seance")!;
		h.client.open(seance.id);
		joinAll(h);
		h.sent();

		// Our own PART removes the channel from the model (and the queue).
		h.transport.line(":alice!alice@host PART #two");
		expect(h.client.findChannel("#two")).to.equal(undefined);
		expect(pendingCatchup(h.client).map((c) => c.name)).to.deep.equal(["#three", "#four"]);
		// A channel that is merely no longer JOINED is skipped without spending a slot.
		h.client.findChannel("#three")!.state = ChanState.PARTED;
		const catchupOnly = (l: string) => /^(@\S+ )?(CHATHISTORY|MARKREAD #(three|four))/.test(l);
		expect(commandsOf(collect(h, 2, catchupOnly).map((s) => s.line))).to.deep.equal([
			"CHATHISTORY LATEST",
			"MARKREAD #four",
		]);

		h.client.findChannel("#three")!.state = ChanState.JOINED;
		h.transport.line(":alice!alice@host PART #four");
		h.transport.line(":alice!alice@host JOIN #four");
		expect(pendingCatchup(h.client).map((c) => c.name)).to.deep.equal(["#four"]);
		h.transport.closed();
		expect(pendingCatchup(h.client)).to.deep.equal([]);
		clock.tick(CATCHUP_STEP_COST_MS * 3);
		expect(h.sent()).to.deep.equal([]);
	});

	it("uses the reconnect path (LATEST, walking back) for channels that already had history", function () {
		const h = connected();
		const seance = h.client.findChannel("#seance")!;
		h.client.open(seance.id);
		h.transport.line(":alice!alice@host JOIN #seance");
		h.sent();
		// History was requested on that JOIN; a live message is the newest reference.
		h.transport.line(
			"@time=2026-08-27T12:01:00.000Z;msgid=m1 :bob!bob@host PRIVMSG #seance :hi"
		);
		h.transport.closed();
		h.sent();
		const mark = h.transport.sent.length;
		register(h, CAPS);
		// The active channel's catch-up is pipelined right behind the JOIN,
		// before the echo; the echo then only adds the modes.
		const atRegistration = h.transport.sent.slice(mark);
		const join = atRegistration.findIndex((l) => l.startsWith("JOIN "));
		expect(join).to.be.greaterThan(-1);
		expect(atRegistration[join + 1]).to.match(/CHATHISTORY LATEST #seance \* \d+$/);
		// The marker is already known from before the drop: not asked again.
		expect(atRegistration).to.not.include("MARKREAD #seance");
		h.transport.line(":alice!alice@host JOIN #seance");
		expect(nextBackground(h)).to.deep.equal(["MODE #seance"]);
	});
});
