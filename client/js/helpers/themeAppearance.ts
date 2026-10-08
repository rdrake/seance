// The themes that come as a light/dark pair, and which of the pair to show.
// With the matchSystemAppearance setting on, the chosen theme stands for its
// pair: whichever of the two matches the system's light or dark mode
// (prefers-color-scheme) is the one loaded, and a change of mode swaps it
// live. A theme with no partner is shown as chosen either way. Vue-free:
// test/helpers/themeAppearance.ts.
//
// The pairs themselves are themePairs.json, `[dark, light]` each, because
// the early loader (loading-error-handlers.js, which is copied rather than
// bundled) needs them too: webpack.config.ts writes the same list into it.

import pairs from "./themePairs.json";

type Appearance = "light" | "dark";

/** The light/dark pairs, dark first (docs/resources/themes.md). */
export const THEME_PAIRS: ReadonlyArray<readonly [dark: string, light: string]> = pairs.map(
	([dark, light]) => [dark, light] as const
);

/** Each paired theme, its own appearance and its partner. */
const PAIRS = new Map<string, {appearance: Appearance; partner: string}>();

for (const [dark, light] of THEME_PAIRS) {
	PAIRS.set(dark, {appearance: "dark", partner: light});
	PAIRS.set(light, {appearance: "light", partner: dark});
}

/** The partner of a paired theme, or null. */
export function themePartner(theme: string): string | null {
	return PAIRS.get(theme)?.partner ?? null;
}

/** The theme to load for `chosen`: its partner when following the system
 * and the system's mode is the other one, else `chosen` itself. */
export function effectiveTheme(chosen: string, matchSystem: boolean, systemDark: boolean): string {
	const pair = PAIRS.get(chosen);

	if (!matchSystem || !pair) {
		return chosen;
	}

	const wanted: Appearance = systemDark ? "dark" : "light";
	return pair.appearance === wanted ? chosen : pair.partner;
}

/** The pairs as a sentence's list, "Coffee/Creama, …and Morning/Day", each
 * dark first and named by `label` (Settings → Appearance's hint). */
export function describeThemePairs(label: (theme: string) => string): string {
	const names = THEME_PAIRS.map(([dark, light]) => `${label(dark)}/${label(light)}`);
	return names.length > 1
		? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
		: names.join("");
}
