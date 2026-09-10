/**
 * Sizes the app to the visual viewport on touch devices.
 *
 * iOS does not shrink the layout viewport for the on-screen keyboard:
 * `innerHeight` stays put while `visualViewport.height` drops, so an app at
 * `height: 100%` keeps its composer behind the keyboard. `--viewport-height`
 * publishes the visual viewport and <body> is sized from it (style.css).
 *
 * Written on every event rather than behind a guard, so a stale value never
 * outlives the keyboard, and only on touch-primary devices, so a desktop
 * pinch-zoom leaves the layout alone. A no-op on Android, where Chrome
 * honours `interactive-widget=resizes-content` and the two viewports agree.
 *
 * Two things make the measurement unreliable, and both are handled here:
 *
 * - The event that announces the keyboard carries a mid-animation height and
 *   nothing follows once the animation ends. So a measurement is *settled*:
 *   re-read every `SETTLE_POLL_MS` until the height has held still for
 *   `SETTLE_QUIET_MS`, up to `SETTLE_MAX_MS`. A single deferred re-read used
 *   to do this, and missed a keyboard that moved late — one dismissed by iOS
 *   during an app switch, say, while the page's timers were suspended.
 *
 * - An app switch dismisses the keyboard without telling the page: no
 *   `focusout`, the composer keeps focus, and any `resize` either never comes
 *   or arrives while the page is hidden. Back in the foreground the app was
 *   still sized for a keyboard that was gone (bug 1), or sized right but with
 *   the composer's `:focus` rules — no home-indicator strip — still applied
 *   (bug 2). So on iOS the page drops its own focus as it goes to the
 *   background, which is what iOS does to the keyboard anyway, and every way
 *   back into the foreground re-measures. Re-measuring alone is not enough:
 *   `visualViewport.height` itself keeps the keyboard-up value after the
 *   switch (measured on iOS 27), so with no text field focused the layout
 *   viewport — `innerHeight`, which iOS does restore — wins.
 *
 * Vue-free; boot.ts installs it. `createViewportSizer` is the testable core
 * (`test/helpers/viewport.ts`), `installViewportHooks` binds it to the page.
 */

import {hasVirtualKeyboard, isIOS} from "./device";

/** How often a settling measurement re-reads the viewport. */
export const SETTLE_POLL_MS = 50;
/** How long the height has to hold still before it counts as settled. */
export const SETTLE_QUIET_MS = 150;
/** The most a settling measurement keeps re-reading. */
export const SETTLE_MAX_MS = 1500;

export interface ViewportEnv {
	/** `visualViewport.height`. */
	height(): number;
	/** `window.innerHeight`, the layout viewport. */
	innerHeight(): number;
	/** Whether a text field has focus — the only way the keyboard is up. */
	textFieldFocused(): boolean;
	/** `visualViewport.offsetTop`. */
	offsetTop(): number;
	/** `window.scrollY`. */
	scrollY(): number;
	/** Writes `--viewport-height`. */
	publish(px: number): void;
	/** `window.scrollTo(0, 0)`. */
	scrollToTop(): void;
	/** Blurs the focused text field, if any. */
	dropFocus(): void;
	/** Whether the page drops focus when it goes to the background (iOS). */
	dismissesKeyboardOnHide: boolean;
	/** Told whenever a published height differs from the last one. */
	onChange?(px: number): void;
}

export interface ViewportSizer {
	/** Measure once, now. Returns the height published. */
	apply(): number;
	/** Measure now and keep re-measuring until the height holds still. */
	settle(): void;
	/** The page is going to the background. */
	hidden(): void;
	/** The page is back in the foreground. */
	visible(): void;
	/** Stops a settling measurement. */
	cancel(): void;
}

export function createViewportSizer(env: ViewportEnv): ViewportSizer {
	let published = NaN;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const apply = () => {
		let height = Math.round(env.height());

		// After an app switch iOS reports the keyboard-up visual viewport for
		// good — measured on iOS 27: 400 with `innerHeight` back at 793, two
		// seconds after the page was visible again — while nothing has
		// focus, so no keyboard can be up. The layout viewport is the truth
		// then. With a text field focused the visual viewport is the only
		// source that sees the keyboard, so it is trusted as before.
		if (!env.textFieldFocused()) {
			height = Math.max(height, Math.round(env.innerHeight()));
		}

		env.publish(height);

		if (height !== published) {
			published = height;
			env.onChange?.(height);
		}

		// The app fills the visible band, so anything iOS scrolled away is the
		// header. scrollTo(0, 0) at 0 fires no scroll event, so this cannot loop.
		if (env.offsetTop() > 0 || env.scrollY() > 0) {
			env.scrollToTop();
		}

		return height;
	};

	const settle = () => {
		cancel();

		let last = apply();
		let quietFor = 0;
		let waited = 0;

		const tick = () => {
			timer = null;

			const height = apply();
			waited += SETTLE_POLL_MS;
			quietFor = height === last ? quietFor + SETTLE_POLL_MS : 0;
			last = height;

			if (quietFor >= SETTLE_QUIET_MS || waited >= SETTLE_MAX_MS) {
				return;
			}

			timer = setTimeout(tick, SETTLE_POLL_MS);
		};

		timer = setTimeout(tick, SETTLE_POLL_MS);
	};

	const hidden = () => {
		cancel();

		if (env.dismissesKeyboardOnHide) {
			env.dropFocus();
		}
	};

	return {apply, settle, hidden, visible: settle, cancel};
}

function isTextField(el: Element | null): el is HTMLElement {
	if (!(el instanceof HTMLElement)) {
		return false;
	}

	return (
		el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable
	);
}

export function installViewportHooks(onChange?: (px: number) => void): void {
	const viewport = window.visualViewport;

	if (!viewport || !hasVirtualKeyboard()) {
		return;
	}

	const sizer = createViewportSizer({
		height: () => viewport.height,
		innerHeight: () => window.innerHeight,
		textFieldFocused: () => isTextField(document.activeElement),
		offsetTop: () => viewport.offsetTop,
		scrollY: () => window.scrollY,
		publish: (px) => document.documentElement.style.setProperty("--viewport-height", `${px}px`),
		scrollToTop: () => window.scrollTo(0, 0),
		dropFocus() {
			const active = document.activeElement;

			if (isTextField(active)) {
				active.blur();
			}
		},
		dismissesKeyboardOnHide: isIOS(),
		onChange,
	});

	viewport.addEventListener("resize", () => sizer.settle());
	viewport.addEventListener("scroll", () => sizer.apply());
	window.addEventListener("resize", () => sizer.settle());
	// Focus is what summons and dismisses the keyboard, and it is not a resize.
	window.addEventListener("focusin", () => sizer.settle());
	window.addEventListener("focusout", () => sizer.settle());

	// An app switch takes the keyboard down behind the page's back.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			sizer.hidden();
		} else {
			sizer.visible();
		}
	});
	window.addEventListener("pageshow", () => sizer.visible());

	sizer.settle();
}
