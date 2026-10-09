import {themeScene} from "./themeScene";

/**
 * Touch grass: the app fades away and only the theme's scene is left to
 * watch, until a tap, a click or a key brings it back (the ps theme's, from
 * the conversation menu). While it lasts the scene counts as attended — no
 * input is the point — and nothing private is on screen, so a query's frost
 * lifts. The screen is kept awake where the browser allows it.
 *
 * The press that ends it must not land on the app it uncovers: the app comes
 * back at once but takes no pointer for LEAVE_MS (`leaving`), so the click,
 * the focus and the long press that follow a tap all fall on the scene, and
 * the key that ends it is swallowed. Vue-free; the document and the host are
 * injected so mocha drives it with fakes.
 */

/** How long after the press that ends it the app still ignores the pointer. */
export const LEAVE_MS = 450;

/** How long the "tap to come back" hint stays up. */
export const HINT_MS = 3500;

/** The press that opened it (the menu item) must not close it again. */
export const ARM_MS = 300;

export type TouchGrassState = "off" | "on" | "leaving";

export interface WakeLockLike {
	release(): Promise<void>;
}

export interface TouchGrassEnv {
	/** Writes `data-touch-grass` on <html> (`null` removes it). */
	mark(state: "on" | "leaving" | null): void;
	/** Tells the scene host (themeScene.setWatching). */
	watch(watching: boolean): void;
	/** Shows the hint, or takes it down. */
	hint(shown: boolean): void;
	/** Adds a capturing window listener; returns its removal. */
	listen(type: string, fn: (event: Event) => void): () => void;
	after(ms: number, fn: () => void): () => void;
	now(): number;
	/** The screen wake lock, where there is one. */
	wakeLock?: () => Promise<WakeLockLike>;
	/** Whether the page is visible (a wake lock is dropped when it is hidden). */
	visible(): boolean;
}

export interface TouchGrass {
	readonly state: TouchGrassState;
	enter(): void;
	/** Ends it as the press that ends it would (Escape, the Android back button). */
	leave(): boolean;
}

export function createTouchGrass(env: TouchGrassEnv): TouchGrass {
	let state: TouchGrassState = "off";
	let armedAt = 0;
	let lock: WakeLockLike | null = null;
	let wantLock = false;
	const undo: Array<() => void> = [];
	let leaving: (() => void) | undefined;
	let hintTimer: (() => void) | undefined;

	const releaseLock = () => {
		wantLock = false;
		const held = lock;
		lock = null;
		void held?.release().catch(() => undefined);
	};

	const takeLock = () => {
		if (!env.wakeLock || lock || !env.visible()) {
			return;
		}

		wantLock = true;
		env.wakeLock().then(
			(sentinel) => {
				// Ended (or hidden) while the lock was being granted.
				if (!wantLock || state !== "on") {
					void sentinel.release().catch(() => undefined);
					return;
				}

				lock = sentinel;
			},
			() => undefined // refused (battery saver, no permission): watch anyway
		);
	};

	const drop = () => {
		while (undo.length) {
			undo.pop()!();
		}

		hintTimer?.();
		hintTimer = undefined;
		env.hint(false);
		releaseLock();
	};

	const finish = () => {
		leaving = undefined;
		state = "off";
		env.mark(null);
	};

	const leave = (): boolean => {
		if (state !== "on") {
			return false;
		}

		drop();
		state = "leaving";
		env.mark("leaving");
		env.watch(false);
		leaving = env.after(LEAVE_MS, finish);
		return true;
	};

	const onPress = (event: Event) => {
		if (env.now() - armedAt < ARM_MS) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		leave();
	};

	return {
		get state() {
			return state;
		},

		enter() {
			if (state === "on") {
				return;
			}

			// Back in before the last one finished leaving.
			leaving?.();
			leaving = undefined;

			state = "on";
			armedAt = env.now();
			env.mark("on");
			env.watch(true);
			env.hint(true);
			hintTimer = env.after(HINT_MS, () => {
				hintTimer = undefined;
				env.hint(false);
			});
			takeLock();

			undo.push(env.listen("pointerdown", onPress));
			undo.push(env.listen("keydown", onPress));
			// A wake lock is released by the browser when the page is hidden;
			// take it again on the way back.
			undo.push(
				env.listen("visibilitychange", () => {
					if (env.visible()) {
						lock = null;
						takeLock();
					}
				})
			);
		},

		leave,
	};
}

let instance: TouchGrass | null = null;

const HINT_ID = "touch-grass-hint";

/** The app's own, on the real document and the real scene host. */
export function touchGrass(): TouchGrass {
	if (instance) {
		return instance;
	}

	instance = createTouchGrass({
		mark(value) {
			if (value) {
				document.documentElement.dataset.touchGrass = value;
			} else {
				delete document.documentElement.dataset.touchGrass;
			}
		},
		watch(watching) {
			themeScene.setWatching(watching);
		},
		hint(shown) {
			document.getElementById(HINT_ID)?.remove();

			if (!shown) {
				return;
			}

			const el = document.createElement("div");
			el.id = HINT_ID;
			el.setAttribute("role", "status");
			el.textContent =
				document.documentElement.dataset.input === "touch"
					? "Tap anywhere to come back"
					: "Click or press any key to come back";
			document.body.append(el);
		},
		listen(type, fn) {
			const target = type === "visibilitychange" ? document : window;
			target.addEventListener(type, fn, {capture: true});
			return () => target.removeEventListener(type, fn, {capture: true});
		},
		after(ms, fn) {
			const id = window.setTimeout(fn, ms);
			return () => window.clearTimeout(id);
		},
		now: () => performance.now(),
		wakeLock:
			"wakeLock" in navigator
				? () => (navigator as any).wakeLock.request("screen") as Promise<WakeLockLike>
				: undefined,
		visible: () => document.visibilityState !== "hidden",
	});
	return instance;
}

/** Ends touch grass if it is on, and says whether it was (Escape and the Android back button ask first). */
export function leaveTouchGrass(): boolean {
	return instance?.leave() ?? false;
}
