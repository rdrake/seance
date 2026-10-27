import {expect} from "chai";
import {
	ARM_MS,
	createTouchGrass,
	HINT_MS,
	LEAVE_MS,
	type TouchGrassEnv,
	type WakeLockLike,
} from "../../client/js/touchGrass";

/** A stand-in document: a clock, timers, listeners and a record of what was done. */
function fakeEnv(opts: {wakeLock?: boolean; visible?: boolean} = {}) {
	let now = 1000;
	let visible = opts.visible ?? true;
	const log: string[] = [];
	const timers: Array<{at: number; fn: () => void; live: boolean}> = [];
	const listeners = new Map<string, Set<(event: Event) => void>>();
	const locks: string[] = [];
	let lastActivate: (() => void) | null = null;

	const env: TouchGrassEnv = {
		mark: (state) => log.push(`mark ${state}`),
		watch: (watching) => log.push(`watch ${watching}`),
		control(state, activate) {
			log.push(`control ${state}`);
			lastActivate = activate;
		},
		listen(type, fn) {
			if (!listeners.has(type)) {
				listeners.set(type, new Set());
			}

			listeners.get(type)!.add(fn);
			return () => listeners.get(type)!.delete(fn);
		},
		after(ms, fn) {
			const t = {at: now + ms, fn, live: true};
			timers.push(t);
			return () => (t.live = false);
		},
		now: () => now,
		visible: () => visible,
		wakeLock: opts.wakeLock
			? () => {
					const n = locks.length;
					locks.push(`held ${n}`);
					const sentinel: WakeLockLike = {
						release() {
							locks[n] = `released ${n}`;
							return Promise.resolve();
						},
					};
					return Promise.resolve(sentinel);
			  }
			: undefined,
	};

	const fire = (type: string) => {
		const event = {
			prevented: false,
			stopped: false,
			preventDefault() {
				this.prevented = true;
			},
			stopPropagation() {
				this.stopped = true;
			},
		};

		for (const fn of [...(listeners.get(type) ?? [])]) {
			fn(event as unknown as Event);
		}

		return event;
	};

	const advance = (ms: number) => {
		now += ms;

		for (const t of timers) {
			if (t.live && t.at <= now) {
				t.live = false;
				t.fn();
			}
		}
	};

	const count = (type: string) => listeners.get(type)?.size ?? 0;
	const setVisible = (v: boolean) => (visible = v);
	return {env, log, fire, advance, count, locks, setVisible, activate: () => lastActivate?.()};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("touch grass (client/js/touchGrass.ts)", function () {
	it("hides the app, tells the host and puts up the way out, which goes quiet after HINT_MS", function () {
		const f = fakeEnv();
		const tg = createTouchGrass(f.env);
		tg.enter();
		expect(tg.state).to.equal("on");
		expect(f.log).to.deep.equal(["mark on", "watch true", "control hint"]);
		f.advance(HINT_MS);
		expect(f.log.at(-1)).to.equal("control quiet");
	});

	it("ignores the press that opened it, then any press or key ends it and is swallowed", function () {
		const f = fakeEnv();
		const tg = createTouchGrass(f.env);
		tg.enter();
		f.advance(ARM_MS - 1);
		expect(f.fire("pointerdown").prevented).to.equal(false);
		expect(tg.state).to.equal("on");
		f.advance(1);
		const press = f.fire("keydown");
		expect(press.prevented && press.stopped).to.equal(true);
		expect(tg.state).to.equal("leaving");
		expect(f.count("pointerdown") + f.count("keydown") + f.count("visibilitychange")).to.equal(
			0
		);
	});

	it("keeps the app off the pointer for LEAVE_MS after it ends, then clears the mark", function () {
		const f = fakeEnv();
		const tg = createTouchGrass(f.env);
		tg.enter();
		f.advance(ARM_MS);
		f.log.length = 0;
		f.fire("pointerdown");
		expect(f.log).to.deep.equal(["control null", "mark leaving", "watch false"]);
		f.advance(LEAVE_MS - 1);
		expect(tg.state).to.equal("leaving");
		f.advance(1);
		expect(tg.state).to.equal("off");
		expect(f.log.at(-1)).to.equal("mark null");
	});

	it("leave() ends it once and says whether it was on (the back button's question)", function () {
		const f = fakeEnv();
		const tg = createTouchGrass(f.env);
		expect(tg.leave()).to.equal(false);
		tg.enter();
		expect(tg.leave()).to.equal(true);
		expect(tg.leave()).to.equal(false);
	});

	it("entering again while leaving cancels the pending clear", function () {
		const f = fakeEnv();
		const tg = createTouchGrass(f.env);
		tg.enter();
		tg.leave();
		tg.enter();
		f.advance(LEAVE_MS);
		expect(tg.state).to.equal("on");
		expect(f.log.filter((l) => l === "mark null")).to.have.length(0);
	});

	it("holds a wake lock while on, takes it again when the page comes back, and lets it go at the end", async function () {
		const f = fakeEnv({wakeLock: true});
		const tg = createTouchGrass(f.env);
		tg.enter();
		await flush();
		expect(f.locks).to.deep.equal(["held 0"]);
		// The browser drops the lock with a hidden page; the way back asks again.
		f.setVisible(false);
		f.fire("visibilitychange");
		f.setVisible(true);
		f.fire("visibilitychange");
		await flush();
		expect(f.locks).to.deep.equal(["held 0", "held 1"]);
		tg.leave();
		await flush();
		expect(f.locks).to.deep.equal(["held 0", "released 1"]);
	});

	it("releases a lock granted after it ended", async function () {
		const f = fakeEnv({wakeLock: true});
		const tg = createTouchGrass(f.env);
		tg.enter();
		tg.leave(); // before the request settles
		await flush();
		expect(f.locks).to.deep.equal(["released 0"]);
	});

	it("asks for one lock at a time, so none is left held after it ends", async function () {
		const f = fakeEnv({wakeLock: true});
		const tg = createTouchGrass(f.env);
		tg.enter();
		f.fire("visibilitychange"); // before the first request settles
		tg.leave();
		tg.enter();
		await flush();
		expect(f.locks).to.deep.equal(["held 0"]);
		tg.leave();
		await flush();
		expect(f.locks).to.deep.equal(["released 0"]);
	});

	it("its button ends it: the way out a screen reader or a keyboard takes", function () {
		const f = fakeEnv();
		const tg = createTouchGrass(f.env);
		tg.enter();
		f.activate();
		expect(tg.state).to.equal("leaving");
		expect(f.log).to.include("control null");
	});

	it("works without a wake lock", function () {
		const f = fakeEnv();
		const tg = createTouchGrass(f.env);
		tg.enter();
		expect(tg.state).to.equal("on");
	});
});
