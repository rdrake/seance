/**
 * What kind of machine the app is running on, as far as behaviour should
 * differ. Vue-free.
 */

/**
 * Whether focusing a text field would raise an on-screen keyboard: a
 * touch-primary device (phone, tablet). `(hover: none) and (pointer: coarse)`
 * describes the *primary* input, so a laptop with a touchscreen still counts
 * as a keyboard machine. False where the query cannot be asked (tests).
 */
export function hasVirtualKeyboard(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}

	return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/**
 * Whether this is an iOS device (iPhone, iPad): a touch-primary device whose
 * engine is WebKit, which every iOS browser is. The same probe as style.css's
 * `@supports (-webkit-touch-callout: none)`, for what only iOS does — the home
 * indicator inside the viewport, the keyboard dismissed behind the page's
 * back on an app switch.
 */
export function isIOS(): boolean {
	if (!hasVirtualKeyboard() || typeof CSS === "undefined" || typeof CSS.supports !== "function") {
		return false;
	}

	return CSS.supports("-webkit-touch-callout", "none");
}
