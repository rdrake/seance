/**
 * Sizes the app to the visual viewport on touch devices.
 *
 * iOS does not shrink the layout viewport for the on-screen keyboard:
 * `innerHeight` stays put while `visualViewport.height` drops, so an app at
 * `height: 100%` keeps its composer behind the keyboard. `--viewport-height`
 * publishes the visual viewport and <body> is sized from it (style.css).
 * Touch-primary devices only, so a desktop pinch-zoom leaves the layout
 * alone; a no-op on Android, where the two viewports agree.
 *
 * Two iOS quirks shape the rest. The resize that announces the keyboard
 * carries a mid-animation height, so a measurement is re-read a few times
 * after the event. And an app switch dismisses the keyboard without a
 * `focusout` or a `resize`, after which `visualViewport.height` keeps the
 * keyboard-up value while `innerHeight` is restored: so the page drops its
 * own focus as it goes hidden, and while no text field has focus — the only
 * time the keyboard is down for certain — the larger of the two wins.
 *
 * Vue-free; boot.ts installs it.
 */

import {hasVirtualKeyboard} from "./device";

/** When a measurement is re-read after its event, in ms. The keyboard animates for ~250 ms. */
export const SETTLE_DELAYS_MS = [50, 150, 300, 600];

/** The height to size the app to. */
export function effectiveHeight(visual: number, inner: number, textFieldFocused: boolean): number {
	return textFieldFocused ? visual : Math.max(visual, inner);
}

/** Calls `apply` now and once more at each delay. Returns a function that stops the re-reads. */
export function settle(apply: () => void, delays: number[] = SETTLE_DELAYS_MS): () => void {
	apply();
	const timers = delays.map((ms) => setTimeout(apply, ms));

	return () => timers.forEach((timer) => clearTimeout(timer));
}

function isTextField(el: Element | null): el is HTMLElement {
	return (
		el instanceof HTMLInputElement ||
		el instanceof HTMLTextAreaElement ||
		(el instanceof HTMLElement && el.isContentEditable)
	);
}

export function installViewportHooks(): void {
	const viewport = window.visualViewport;

	if (!viewport || !hasVirtualKeyboard()) {
		return;
	}

	// Every iOS browser is WebKit; the same probe as style.css's @supports.
	const ios = typeof CSS !== "undefined" && CSS.supports("-webkit-touch-callout", "none");

	const apply = () => {
		const height = effectiveHeight(
			viewport.height,
			window.innerHeight,
			isTextField(document.activeElement)
		);

		document.documentElement.style.setProperty("--viewport-height", `${Math.round(height)}px`);

		// The app fills the visible band, so anything iOS scrolled away is the
		// header. scrollTo(0, 0) at 0 fires no scroll event, so this cannot loop.
		if (viewport.offsetTop > 0 || window.scrollY > 0) {
			window.scrollTo(0, 0);
		}
	};

	let cancel = () => {};

	const applySettled = () => {
		cancel();
		cancel = settle(apply);
	};

	viewport.addEventListener("resize", applySettled);
	viewport.addEventListener("scroll", apply);
	window.addEventListener("resize", applySettled);
	// Focus is what summons and dismisses the keyboard, and it is not a resize.
	window.addEventListener("focusin", applySettled);
	window.addEventListener("focusout", applySettled);
	window.addEventListener("pageshow", applySettled);
	document.addEventListener("visibilitychange", () => {
		const active = document.activeElement;

		if (ios && document.visibilityState === "hidden" && isTextField(active)) {
			active.blur();
		}

		applySettled();
	});

	applySettled();
}
