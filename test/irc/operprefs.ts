import {expect} from "chai";
import {
	forgetOperPrefs,
	getNote,
	getOperPrefs,
	OPER_PREFS_KEY,
	routeFor,
	setNote,
	setRoute,
	setSnomaskPref,
	setTemporaryRoute,
	setWasOper,
	sweepTemporaryRoutes,
	temporaryRouteFor,
	useOperPrefsBackend,
} from "../../client/js/irc/operprefs";

describe("oper preferences storage (irc/operprefs.ts)", function () {
	const UUID = "net-1";
	let data: Map<string, string>;
	let sets: number;

	beforeEach(function () {
		data = new Map();
		sets = 0;
		useOperPrefsBackend({
			get: (k) => data.get(k) ?? null,
			set(k, v) {
				sets++;
				data.set(k, v);
			},
		});
	});

	afterEach(function () {
		useOperPrefsBackend(null);
	});

	const stored = (): Record<string, unknown> =>
		JSON.parse(data.get(OPER_PREFS_KEY) ?? "null") as Record<string, unknown>;
	const store = (value: unknown): void => void data.set(OPER_PREFS_KEY, JSON.stringify(value));

	it("lives under thelounge.oper", function () {
		expect(OPER_PREFS_KEY).to.equal("thelounge.oper");
		setWasOper(UUID, true);
		expect(JSON.parse(data.get("thelounge.oper")!)).to.deep.equal({[UUID]: {wasOper: true}});
	});

	describe("reading what is stored", function () {
		it("reads a list or garbage as nothing", function () {
			store([{wasOper: true}]);
			expect(getOperPrefs("0")).to.deep.equal({});
			data.set(OPER_PREFS_KEY, "{");
			expect(getOperPrefs(UUID)).to.deep.equal({});
		});

		it("keeps a whole-number snomask and a boolean wasOper, drops the rest", function () {
			store({
				a: {snomask: 5, wasOper: true},
				b: {snomask: "5", wasOper: "yes"},
				c: {snomask: 1.5, wasOper: false},
			});
			expect(getOperPrefs("a")).to.deep.equal({snomask: 5, wasOper: true});
			expect(getOperPrefs("b")).to.deep.equal({});
			expect(getOperPrefs("c")).to.deep.equal({wasOper: false});
		});

		it("keeps only well-formed temporary routes, and everything beside them", function () {
			const good = {route: "active", until: 100, revert: "off"};
			store({
				[UUID]: {
					snomask: 3,
					routes: {x: "network", y: "bogus"},
					temporary: {
						a: null,
						b: 5,
						c: {route: "active", until: "later"},
						d: {route: "nowhere", until: 100},
						e: {route: "active", until: 100, revert: "bogus"},
						f: good,
						g: {route: "off", until: 100},
					},
				},
			});
			expect(getOperPrefs(UUID)).to.deep.equal({
				snomask: 3,
				routes: {x: "network"},
				temporary: {f: good, g: {route: "off", until: 100}},
			});
		});
	});

	describe("routes", function () {
		it("keeps each kind's route, and drops one set back to the default", function () {
			setRoute(UUID, "a", "off");
			setRoute(UUID, "b", "network");
			expect(getOperPrefs(UUID).routes).to.deep.equal({a: "off", b: "network"});
			setRoute(UUID, "a", undefined);
			expect(getOperPrefs(UUID).routes).to.deep.equal({b: "network"});
			setRoute(UUID, "b", undefined);
			expect(stored()).to.deep.equal({});
		});

		it("keeps each kind's temporary route", function () {
			setTemporaryRoute(UUID, "a", "active", 1000);
			setTemporaryRoute(UUID, "b", "off", 2000);
			expect(Object.keys(getOperPrefs(UUID).temporary ?? {})).to.deep.equal(["a", "b"]);
		});

		it("a lapsed temporary route puts back what stood before it", function () {
			setRoute(UUID, "a", "off");
			setTemporaryRoute(UUID, "a", "active", 1000);
			expect(routeFor(UUID, "a", "network", 999)).to.equal("active");
			expect(sweepTemporaryRoutes(UUID, 999)).to.equal(false);
			expect(getOperPrefs(UUID).temporary?.a?.route).to.equal("active");
			expect(sweepTemporaryRoutes(UUID, 1000)).to.equal(true);
			expect(getOperPrefs(UUID)).to.deep.equal({routes: {a: "off"}});
		});

		it("a lapsed temporary route puts back its recorded route, whatever routes holds", function () {
			store({
				[UUID]: {
					routes: {a: "network"},
					temporary: {
						a: {route: "active", until: 10, revert: "off"},
						b: {route: "off", until: 10},
					},
				},
			});
			expect(routeFor(UUID, "a", "active", 20)).to.equal("off");
			expect(getOperPrefs(UUID)).to.deep.equal({
				routes: {a: "off"},
				temporary: {b: {route: "off", until: 10}},
			});
			sweepTemporaryRoutes(UUID, 20);
			expect(getOperPrefs(UUID)).to.deep.equal({routes: {a: "off"}});
		});

		it("a sweep for one kind leaves another's lapsed route alone", function () {
			setTemporaryRoute(UUID, "a", "active", 1000);
			setTemporaryRoute(UUID, "b", "active", 1000);
			expect(sweepTemporaryRoutes(UUID, 2000, "a")).to.equal(true);
			expect(Object.keys(getOperPrefs(UUID).temporary ?? {})).to.deep.equal(["b"]);
		});

		it("reports a temporary route only while it is in force", function () {
			setTemporaryRoute(UUID, "a", "active", 1000);
			expect(temporaryRouteFor(UUID, "a", 999)?.route).to.equal("active");
			expect(temporaryRouteFor(UUID, "a", 1000)).to.equal(undefined);
			expect(temporaryRouteFor(UUID, "b", 0)).to.equal(undefined);
		});
	});

	it("writes wasOper only when it changes", function () {
		setWasOper(UUID, false);
		expect(sets).to.equal(0);
		setWasOper(UUID, true);
		setWasOper(UUID, true);
		expect(sets).to.equal(1);
		setWasOper(UUID, false);
		expect(sets).to.equal(2);
		expect(stored()).to.deep.equal({});
	});

	it("keeps and clears the snomask", function () {
		setSnomaskPref(UUID, 7);
		expect(getOperPrefs(UUID).snomask).to.equal(7);
		setSnomaskPref(UUID, undefined);
		expect(stored()).to.deep.equal({});
	});

	it("trims a note, and a blank one drops it", function () {
		setNote(UUID, "#Chan", "  watch them  ");
		expect(getNote(UUID, "#chan")).to.equal("watch them");
		setNote(UUID, "#chan", "   ");
		expect(getNote(UUID, "#chan")).to.equal("");
		expect(getOperPrefs(UUID)).not.to.have.property("notes");
		expect(stored()).to.deep.equal({});
	});

	it("forgetting a network drops its prefs only, and writes nothing for one it never had", function () {
		setWasOper("a", true);
		setWasOper("b", true);
		const before = sets;
		forgetOperPrefs("none");
		expect(sets).to.equal(before);
		forgetOperPrefs("a");
		expect(stored()).to.deep.equal({b: {wasOper: true}});
	});
});
