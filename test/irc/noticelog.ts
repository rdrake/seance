import {expect} from "chai";
import sinon from "ts-sinon";
import {
	forgetNoticeLog,
	LoggedNotice,
	MAX_AGE_MS,
	NoticeLog,
	NoticeLogBackend,
	SAVE_DELAY_MS,
	trim,
	useNoticeLogBackend,
} from "../../client/js/irc/noticelog";

// The IndexedDB backend itself needs a browser: mocha has no indexedDB, so
// these cover the log over a fake backend and the no-IndexedDB default.

describe("notice log (irc/noticelog.ts)", function () {
	const NOW = Date.UTC(2026, 9, 1, 12);
	let clock: sinon.SinonFakeTimers;
	let saves: Array<[string, LoggedNotice[]]>;
	let removed: string[];
	let stored: LoggedNotice[] | undefined;

	const notice = (time: number, text = "x"): LoggedNotice => ({
		time,
		type: "snotice",
		text,
		snotice: {kind: "test"} as LoggedNotice["snotice"],
	});

	beforeEach(function () {
		clock = sinon.useFakeTimers({now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"]});
		saves = [];
		removed = [];
		stored = undefined;
		const fake: NoticeLogBackend = {
			load: () => Promise.resolve(stored),
			save(uuid, entries) {
				saves.push([uuid, entries]);
				return Promise.resolve();
			},
			remove(uuid) {
				removed.push(uuid);
				return Promise.resolve();
			},
		};
		useNoticeLogBackend(fake);
	});

	afterEach(function () {
		clock.restore();
		useNoticeLogBackend(null);
	});

	it("keeps a line exactly a day old, not one older", function () {
		const kept = trim(
			[notice(NOW - MAX_AGE_MS - 1, "old"), notice(NOW - MAX_AGE_MS, "edge")],
			NOW
		);
		expect(kept.map((e) => e.text)).to.deep.equal(["edge"]);
	});

	it("a load with nothing appended meanwhile writes nothing", async function () {
		stored = [notice(NOW - 1000)];
		const log = new NoticeLog("net", () => true);
		expect(await log.load()).to.have.length(1);
		clock.tick(SAVE_DELAY_MS * 2);
		expect(saves).to.deep.equal([]);
	});

	it("lines appended while loading are written once the read is done", async function () {
		stored = [notice(NOW - 2000, "before")];
		const log = new NoticeLog("net", () => true);
		const loading = log.load();
		log.append(notice(NOW - 1000, "during"));
		await loading;
		clock.tick(SAVE_DELAY_MS);
		expect(saves.map(([u, e]) => [u, e.map((n) => n.text)])).to.deep.equal([
			["net", ["before", "during"]],
		]);
	});

	it("writes a burst once, and flush writes only what is pending", async function () {
		const log = new NoticeLog("net", () => true);
		await log.load();
		log.flush();
		expect(saves).to.have.length(0);
		log.append(notice(NOW - 3));
		log.append(notice(NOW - 2));
		clock.tick(SAVE_DELAY_MS);
		expect(saves).to.have.length(1);
		log.append(notice(NOW - 1));
		log.flush();
		expect(saves).to.have.length(2);
		clock.tick(SAVE_DELAY_MS * 2);
		expect(saves).to.have.length(2);
		expect(saves[1][1]).to.have.length(3);
	});

	it("without IndexedDB keeps nothing and never throws", async function () {
		useNoticeLogBackend(null);
		const log = new NoticeLog("net", () => true);
		expect(await log.load()).to.deep.equal([]);
		log.append(notice(NOW));
		expect(() => log.flush()).not.to.throw();
		expect(() => forgetNoticeLog("net")).not.to.throw();
		expect(log.all()).to.have.length(1);
	});

	it("forgetting a network removes its log", function () {
		forgetNoticeLog("net");
		expect(removed).to.deep.equal(["net"]);
	});
});
