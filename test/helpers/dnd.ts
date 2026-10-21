import {expect} from "chai";
import {
	defaultDndState,
	describeDnd,
	dndAt,
	editSchedule,
	nextChangeAt,
	nextWindow,
	effectiveMode,
	parseDndState,
	pillStatus,
	reconcileRemote,
	scheduleTimeText,
	serializeDndState,
	turnOff,
	windowAt,
	type DndState,
} from "../../client/js/helpers/dnd";

// Local-time dates: the schedule is wall-clock time.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
// 2026-10-09 is a Friday (day 5), 2026-10-10 Saturday (6).
const FRI = 5;

function scheduled(days: number[], start = "23:00", end = "07:00"): DndState {
	const s = defaultDndState();
	s.schedule = {enabled: true, start, end, days};
	return s;
}

describe("do not disturb model (helpers/dnd.ts)", function () {
	it("is off by default", function () {
		expect(dndAt(defaultDndState(), at(2026, 10, 9, 23, 30))).to.deep.equal({
			active: false,
			until: null,
			source: null,
		});
	});

	it("manual until a time is on before it and off after it", function () {
		const s = defaultDndState();
		const until = at(2026, 10, 9, 13).getTime();
		s.manual = {kind: "until", until};
		expect(dndAt(s, at(2026, 10, 9, 12))).to.deep.equal({
			active: true,
			until,
			source: "manual",
		});
		expect(dndAt(s, at(2026, 10, 9, 12, 59)).active).to.equal(true);
		expect(dndAt(s, at(2026, 10, 9, 13)).active, "off on the minute it ends").to.equal(false);
		expect(dndAt(s, at(2026, 10, 9, 13, 1)).active).to.equal(false);
	});

	it("manual indefinite has no end", function () {
		const s = defaultDndState();
		s.manual = {kind: "indefinite"};
		expect(dndAt(s, at(2026, 10, 9, 12))).to.deep.equal({
			active: true,
			until: null,
			source: "manual",
		});
	});

	it("a window crossing midnight belongs to the day it starts on", function () {
		const s = scheduled([FRI]);
		const end = at(2026, 10, 10, 7).getTime();
		expect(dndAt(s, at(2026, 10, 9, 23, 30))).to.deep.equal({
			active: true,
			until: end,
			source: "schedule",
		});
		// Saturday 01:00: still Friday's window, though Saturday is not ticked.
		expect(dndAt(s, at(2026, 10, 10, 1)).active).to.equal(true);
		expect(dndAt(s, at(2026, 10, 10, 7)).active).to.equal(false);
		// Thursday night is not ticked.
		expect(dndAt(s, at(2026, 10, 8, 23, 30)).active).to.equal(false);
	});

	it("a same-day window", function () {
		const s = scheduled([FRI], "12:00", "13:00");
		expect(dndAt(s, at(2026, 10, 9, 12, 30)).active).to.equal(true);
		expect(dndAt(s, at(2026, 10, 9, 13)).active).to.equal(false);
		expect(dndAt(s, at(2026, 10, 9, 11, 59)).active).to.equal(false);
	});

	it("a disabled schedule or no days is no schedule", function () {
		const s = scheduled([]);
		expect(dndAt(s, at(2026, 10, 9, 23, 30)).active).to.equal(false);
		const t = scheduled([FRI]);
		t.schedule.enabled = false;
		expect(dndAt(t, at(2026, 10, 9, 23, 30)).active).to.equal(false);
	});

	it("manual wins over the schedule while it is on", function () {
		const s = scheduled([FRI]);
		s.manual = {kind: "indefinite"};
		expect(dndAt(s, at(2026, 10, 9, 23, 30)).source).to.equal("manual");
	});

	it("turning off inside a window skips to its end, then the next window counts", function () {
		const s = turnOff(scheduled([0, 1, 2, 3, 4, 5, 6]), at(2026, 10, 9, 23, 30));
		expect(s.manual).to.deep.equal({kind: "off"});
		expect(s.scheduleSkippedUntil).to.equal(at(2026, 10, 10, 7).getTime());
		expect(dndAt(s, at(2026, 10, 10, 2)).active).to.equal(false);
		expect(dndAt(s, at(2026, 10, 10, 23, 30)).active).to.equal(true);
	});

	it("turning off outside a window skips nothing", function () {
		const s = scheduled([FRI]);
		s.manual = {kind: "indefinite"};
		const next = turnOff(s, at(2026, 10, 9, 12));
		expect(next.scheduleSkippedUntil).to.equal(null);
	});

	it("windowAt and nextWindow", function () {
		const s = scheduled([FRI]).schedule;
		expect(windowAt(s, at(2026, 10, 9, 12))).to.equal(null);
		expect(nextWindow(s, at(2026, 10, 9, 12))).to.deep.equal({
			start: at(2026, 10, 9, 23).getTime(),
			end: at(2026, 10, 10, 7).getTime(),
		});
		expect(nextWindow({...s, days: []}, at(2026, 10, 9, 12))).to.equal(null);
	});

	it("round-trips and survives garbage", function () {
		const s = scheduled([1, 2]);
		s.manual = {kind: "until", until: 123};
		expect(parseDndState(serializeDndState(s))).to.deep.equal(s);
		expect(parseDndState(null)).to.deep.equal(defaultDndState());
		expect(parseDndState("{nope")).to.deep.equal(defaultDndState());
		expect(
			parseDndState(JSON.stringify({manual: {kind: "until"}, schedule: {start: "25:99"}}))
		).to.deep.equal(defaultDndState());
	});

	it("one bad half resets only itself", function () {
		const s = scheduled([1, 2]);
		s.manual = {kind: "indefinite"};
		const raw = JSON.parse(serializeDndState(s)) as Record<string, unknown>;
		const badSchedule = parseDndState(JSON.stringify({...raw, schedule: {start: "25:99"}}));
		expect(badSchedule.manual).to.deep.equal({kind: "indefinite"});
		expect(badSchedule.schedule).to.deep.equal(defaultDndState().schedule);
		const badManual = parseDndState(JSON.stringify({...raw, manual: {kind: "until"}}));
		expect(badManual.manual).to.deep.equal({kind: "off"});
		expect(badManual.schedule).to.deep.equal(s.schedule);
	});

	it("keeps the span a timed DND was picked with", function () {
		const s = defaultDndState();
		s.manual = {kind: "until", until: 123, span: 3600_000};
		expect(parseDndState(serializeDndState(s)).manual).to.deep.equal(s.manual);
		const bad = parseDndState(
			JSON.stringify({...s, manual: {kind: "until", until: 5, span: -1}})
		);
		expect(bad.manual).to.deep.equal({kind: "until", until: 5});
	});

	it("the same start and end is a whole day, from that time to the next day's", function () {
		const s = scheduled([FRI], "09:00", "09:00");
		expect(dndAt(s, at(2026, 10, 9, 8, 59)).active, "Thursday's is no window").to.equal(false);
		expect(dndAt(s, at(2026, 10, 9, 9))).to.deep.equal({
			active: true,
			until: at(2026, 10, 10, 9).getTime(),
			source: "schedule",
		});
		expect(dndAt(s, at(2026, 10, 10, 8, 59)).active, "Friday's, across midnight").to.equal(
			true
		);
		expect(dndAt(s, at(2026, 10, 10, 9)).active).to.equal(false);
	});

	it("a night window across a clock change keeps its wall-clock edges", function () {
		// The DST nights of the US and the EU in 2026; whatever zone the run
		// is in, the window runs from 23:00 to 07:00 on the wall clock.
		for (const [mo, d] of [
			[3, 7],
			[3, 28],
			[10, 24],
			[10, 31],
		]) {
			const day = at(2026, mo, d, 12).getDay();
			const s = scheduled([day]);
			const w = windowAt(s.schedule, at(2026, mo, d, 23, 30));
			expect(w, `${mo}-${d}`).to.not.equal(null);
			const start = new Date(w!.start);
			const end = new Date(w!.end);
			expect([start.getDate(), start.getHours(), start.getMinutes()]).to.deep.equal([
				d,
				23,
				0,
			]);
			expect([end.getDate(), end.getHours(), end.getMinutes()]).to.deep.equal([
				at(2026, mo, d + 1, 12).getDate(),
				7,
				0,
			]);
			expect(dndAt(s, at(2026, mo, d + 1, 6, 59)).active).to.equal(true);
			expect(dndAt(s, at(2026, mo, d + 1, 7)).active).to.equal(false);
		}
	});

	it("a schedule edit keeps the skip only while the current window stays as it was", function () {
		const now = at(2026, 10, 9, 23, 30);
		const off = turnOff(scheduled([FRI]), now);
		const skip = at(2026, 10, 10, 7).getTime();
		expect(off.scheduleSkippedUntil).to.equal(skip);
		// Another weekday: tonight's window is unchanged, DND stays off.
		const days = editSchedule(off, {...off.schedule, days: [1, FRI]}, now);
		expect(days.scheduleSkippedUntil).to.equal(skip);
		expect(dndAt(days, now).active).to.equal(false);
		// The end moved: tonight's window changed, it holds afresh.
		const end = editSchedule(off, {...off.schedule, end: "08:00"}, now);
		expect(end.scheduleSkippedUntil).to.equal(null);
		expect(dndAt(end, now).active).to.equal(true);
		// Outside any window an edit changes nothing current.
		const day = at(2026, 10, 9, 12);
		const plain = editSchedule(off, {...off.schedule, start: "22:00"}, day);
		expect(plain.scheduleSkippedUntil).to.equal(skip);
	});

	it("knows when the verdict can next change", function () {
		const s = defaultDndState();
		const now = new Date(at(2026, 10, 9, 12).getTime() + 15_000);
		expect(nextChangeAt(s, now), "the minute boundary").to.equal(
			at(2026, 10, 9, 12, 1).getTime()
		);
		s.manual = {kind: "until", until: now.getTime() + 20_000};
		expect(nextChangeAt(s, now), "a timed end off the minute").to.equal(now.getTime() + 20_000);
	});

	it("a shared DND cleared elsewhere turns the local manual DND off", function () {
		const s = defaultDndState();
		s.manual = {kind: "indefinite"};
		const now = at(2026, 10, 9, 12);
		expect(reconcileRemote(s, now).manual).to.deep.equal({kind: "off"});
		const off = defaultDndState();
		expect(reconcileRemote(off, now)).to.equal(off);
		// A scheduled DND cleared elsewhere skips the rest of its window.
		const night = scheduled([FRI]);
		expect(reconcileRemote(night, at(2026, 10, 9, 23, 30)).scheduleSkippedUntil).to.equal(
			at(2026, 10, 10, 7).getTime()
		);
	});

	it("describes the state for the pill", function () {
		const now = at(2026, 10, 9, 22);
		expect(
			describeDnd(
				{active: true, until: at(2026, 10, 9, 23).getTime(), source: "manual"},
				now,
				false
			)
		).to.equal("Do not disturb · until 23:00");
		expect(
			describeDnd(
				{active: true, until: at(2026, 10, 10, 7).getTime(), source: "schedule"},
				now,
				false
			)
		).to.equal("Do not disturb · until Sat 07:00");
		expect(describeDnd({active: true, until: null, source: "manual"}, now, false)).to.equal(
			"Do not disturb"
		);
		expect(
			describeDnd(
				{active: true, until: at(2026, 10, 9, 23).getTime(), source: "manual"},
				now,
				true
			)
		).to.equal("Do not disturb · until 11:00 PM");
	});

	it("writes a schedule's times by the clock setting", function () {
		expect(scheduleTimeText("22:00", false)).to.equal("22:00");
		expect(scheduleTimeText("22:00", true)).to.equal("10:00 PM");
		expect(scheduleTimeText("07:05", true)).to.equal("7:05 AM");
		expect(scheduleTimeText("00:30", true)).to.equal("12:30 AM");
		expect(scheduleTimeText("12:00", true)).to.equal("12:00 PM");
		expect(scheduleTimeText("bad", true)).to.equal("bad");
	});

	it("the global mode defaults to Auto, parses, and a bad value resets only itself", function () {
		expect(defaultDndState().mode).to.deep.equal({value: "auto", at: null});
		const s = {...defaultDndState(), mode: {value: "away" as const, at: 1792000000000}};
		expect(parseDndState(serializeDndState(s)).mode).to.deep.equal({
			value: "away",
			at: 1792000000000,
		});

		for (const bad of [
			null,
			"away",
			{value: "dnd", at: 5},
			{value: "away", at: -1},
			{value: "away", at: "5"},
		]) {
			const parsed = parseDndState(JSON.stringify({...s, mode: bad}));
			expect(parsed.mode, JSON.stringify(bad)).to.deep.equal({value: "auto", at: null});
			expect(parsed.schedule).to.deep.equal(s.schedule);
		}
	});

	it("reads the old away field (2026-10-15) as Away or Auto with its time", function () {
		const base = {
			manual: {kind: "off"},
			schedule: defaultDndState().schedule,
			scheduleSkippedUntil: null,
		};
		expect(
			parseDndState(JSON.stringify({...base, away: {on: true, at: 7}})).mode
		).to.deep.equal({value: "away", at: 7});
		expect(
			parseDndState(JSON.stringify({...base, away: {on: false, at: 8}})).mode
		).to.deep.equal({value: "auto", at: 8});
		expect(
			parseDndState(JSON.stringify({...base, away: {on: false, at: null}})).mode
		).to.deep.equal({value: "auto", at: null});
		expect(parseDndState(JSON.stringify(base)).mode).to.deep.equal({value: "auto", at: null});
	});

	it("effectiveMode: a network's own mode wins, global follows the global mode", function () {
		expect(effectiveMode("global", "away")).to.equal("away");
		expect(effectiveMode("global", "online")).to.equal("online");
		expect(effectiveMode("online", "away")).to.equal("online");
		expect(effectiveMode("dnd", "auto")).to.equal("dnd");
	});

	it("pillStatus: do not disturb outranks the global mode", function () {
		const now = at(2026, 10, 9, 12);
		const base = defaultDndState();
		expect(pillStatus(base, now)).to.equal("auto");
		expect(pillStatus({...base, mode: {value: "away", at: 1}}, now)).to.equal("away");
		expect(pillStatus({...base, mode: {value: "online", at: 1}}, now)).to.equal("online");
		const dnd = {
			...base,
			manual: {kind: "indefinite" as const},
			mode: {value: "online" as const, at: 1},
		};
		expect(pillStatus(dnd, now)).to.equal("dnd");
		// DND ending leaves the global mode as it was.
		expect(pillStatus(turnOff(dnd, now), now)).to.equal("online");
	});
});
