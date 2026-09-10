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
