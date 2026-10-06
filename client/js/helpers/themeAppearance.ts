// The four themes that come as a light/dark pair, and which of the pair to
// show. With the matchSystemAppearance setting on, the chosen theme stands
// for its pair: whichever of the two matches the system's light or dark mode
// (prefers-color-scheme) is the one loaded, and a change of mode swaps it
// live. A theme with no partner is shown as chosen either way. Vue-free:
// test/helpers/themeAppearance.ts.

type Appearance = "light" | "dark";

/** Each paired theme, its own appearance and its partner (docs/resources/themes.md). */
const PAIRS: Record<string, {appearance: Appearance; partner: string}> = {
	coffee: {appearance: "dark", partner: "creama"},
	creama: {appearance: "light", partner: "coffee"},
	cobalt: {appearance: "dark", partner: "frost"},
	frost: {appearance: "light", partner: "cobalt"},
	princess_: {appearance: "dark", partner: "princess"},
	princess: {appearance: "light", partner: "princess_"},
	morning: {appearance: "dark", partner: "day"},
	day: {appearance: "light", partner: "morning"},
};

/** The partner of a paired theme, or null. */
export function themePartner(theme: string): string | null {
	return PAIRS[theme]?.partner ?? null;
}

/** The theme to load for `chosen`: its partner when following the system
 * and the system's mode is the other one, else `chosen` itself. */
export function effectiveTheme(chosen: string, matchSystem: boolean, systemDark: boolean): string {
	const pair = PAIRS[chosen];

	if (!matchSystem || !pair) {
		return chosen;
	}

	const wanted: Appearance = systemDark ? "dark" : "light";
	return pair.appearance === wanted ? chosen : pair.partner;
}
