/* eslint-disable no-console */
// The yurt at the foot of the Keeki rails (client/themes/keeki.css,
// keekiblush.css): the ps theme's yurt (client/js/scenes/ps/plains.ts
// yurtSvg) redrawn as a still, opaque picture in the rail's own colours —
// every part a mix of the rail's foot colour, so nothing behind it shows
// through: Keeki's lifted a step toward rose gold, Keeki Blush's sunk a step
// toward the plum ink. Keeki is the night (a warm door; keeki.css adds the
// smoke), Keeki Blush the day (a dark doorway).
//
//   npx tsx tools/generate-keeki-yurt.ts
//
// prints the two `--keeki-yurt` declarations to paste into the themes.

import {bandMarkCentres} from "../client/js/scenes/ps/plains.ts";

type Rgb = [number, number, number];

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const toHex = (c: Rgb) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) =>
	toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t) as Rgb);

type Palette = Record<
	| "shadow"
	| "feltEdge"
	| "felt"
	| "roofTop"
	| "roofFoot"
	| "band"
	| "mark"
	| "rope"
	| "rib"
	| "crown"
	| "pipe"
	| "door"
	| "doorOrn"
	| "stone"
	| "wood"
	| "grain",
	string
>;

function palette(base: string, tint: string, mark: string, door: string, doorOrn: string): Palette {
	const felt = mix(base, tint, 0.24);
	return {
		shadow: mix(base, "#000000", 0.22),
		feltEdge: mix(base, tint, 0.17),
		felt,
		roofTop: mix(base, tint, 0.3),
		roofFoot: mix(base, tint, 0.2),
		band: mix(base, tint, 0.36),
		mark: mix(base, mark, 0.4),
		rope: mix(felt, base, 0.55),
		rib: mix(base, tint, 0.12),
		crown: mix(base, tint, 0.36),
		pipe: mix(base, tint, 0.22),
		door,
		doorOrn,
		stone: mix(base, tint, 0.16),
		wood: mix(base, tint, 0.26),
		grain: mix(base, tint, 0.42),
	};
}

const KEEKI_BASE = "#22143a";
const BLUSH_BASE = "#584974";

const keeki = palette(
	KEEKI_BASE,
	"#e9b6a6",
	"#ff7bc8",
	mix(KEEKI_BASE, "#ffb86a", 0.32),
	mix(KEEKI_BASE, "#ffb86a", 0.12)
);
// Keeki Blush's rail is a mid lavender under white text, so its yurt is drawn a
// step below the rail rather than above it: the rail's rows scroll over it,
// and white on a lifted felt fell to 3.4:1 where every part here keeps it at
// 8:1 or more. The lines that must show on the dark (the door's carving, the
// logs' rings) go toward the paper instead.
const PLUM = "#2e1a33";
const PAPER = "#f6e1ec";
const blush: Palette = {
	shadow: mix(BLUSH_BASE, PLUM, 0.45),
	feltEdge: mix(BLUSH_BASE, PLUM, 0.26),
	felt: mix(BLUSH_BASE, PLUM, 0.18),
	roofTop: mix(BLUSH_BASE, PLUM, 0.1),
	roofFoot: mix(BLUSH_BASE, PLUM, 0.24),
	band: mix(BLUSH_BASE, PLUM, 0.34),
	mark: mix(BLUSH_BASE, "#ff7bc8", 0.42),
	rope: mix(BLUSH_BASE, PLUM, 0.36),
	rib: mix(BLUSH_BASE, PLUM, 0.3),
	crown: mix(BLUSH_BASE, PLUM, 0.34),
	pipe: mix(BLUSH_BASE, PLUM, 0.2),
	door: mix(BLUSH_BASE, PLUM, 0.55),
	doorOrn: mix(BLUSH_BASE, PAPER, 0.14),
	stone: mix(BLUSH_BASE, PLUM, 0.22),
	wood: mix(BLUSH_BASE, PLUM, 0.28),
	grain: mix(BLUSH_BASE, PAPER, 0.16),
};

/** The woodpile beside the wall, end on: three logs, two, one. */
const LOGS: Array<[number, number]> = [
	[10, 147],
	[18.5, 147],
	[27, 147],
	[14.25, 139.8],
	[22.75, 139.8],
	[18.5, 132.6],
];

const WALL = "M38,150 L38,98 Q120,90 202,98 L202,150 Q120,158 38,150 Z";

function svg(p: Palette): string {
	const marks = bandMarkCentres()
		.map(
			({x, y}) =>
				`<path d="M${(x - 3).toFixed(2)},${y.toFixed(2)} l3,-2.4 l3,2.4 l-3,2.4 Z"/>`
		)
		.join("");
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 18 226 150">` +
		`<defs>` +
		`<linearGradient id="w" x1="0" x2="1"><stop offset="0" stop-color="${p.feltEdge}"/><stop offset=".48" stop-color="${p.felt}"/><stop offset="1" stop-color="${p.feltEdge}"/></linearGradient>` +
		`<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.roofTop}"/><stop offset="1" stop-color="${p.roofFoot}"/></linearGradient>` +
		`</defs>` +
		`<ellipse cx="120" cy="153" rx="98" ry="6" fill="${p.shadow}"/>` +
		`<g fill="${p.wood}">${LOGS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4"/>`).join(
			""
		)}</g>` +
		`<g fill="none" stroke="${p.grain}" stroke-width=".8">${LOGS.map(
			([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2"/>`
		).join("")}</g>` +
		`<g fill="${p.stone}"><ellipse cx="100" cy="160" rx="5" ry="2.2"/><ellipse cx="140" cy="164" rx="5.5" ry="2.4"/></g>` +
		`<path d="${WALL}" fill="url(#w)"/>` +
		`<g fill="none" stroke="${p.rope}" stroke-width="1.3"><path d="M38,114 Q120,121 202,114"/><path d="M38,130 Q120,137 202,130"/><path d="M38,145 Q120,152 202,145"/></g>` +
		`<path d="M38,98 Q120,90 202,98 L202,107 Q120,99 38,107 Z" fill="${p.band}"/>` +
		`<g fill="${p.mark}">${marks}</g>` +
		`<path d="M24,101 Q120,86 216,101 L133,49 Q120,45 107,49 Z" fill="url(#r)"/>` +
		`<g stroke="${p.rib}" stroke-width=".9" fill="none"><path d="M110,50 L44,99"/><path d="M114,49 L70,95"/><path d="M118,48 L97,92"/><path d="M122,48 L143,92"/><path d="M126,49 L170,95"/><path d="M130,50 L196,99"/></g>` +
		`<ellipse cx="120" cy="48" rx="14" ry="4.2" fill="${p.crown}"/>` +
		`<g fill="${p.pipe}"><rect x="116.5" y="24" width="7" height="24" rx="1.2"/><rect x="114.5" y="22" width="11" height="3" rx="1"/></g>` +
		`<path d="M104,151 L104,120 Q120,114.5 136,120 L136,151 Z" fill="${p.door}"/>` +
		`<g fill="none" stroke="${p.doorOrn}" stroke-width="1.1"><path d="M108,148 L108,123 Q120,118.5 132,123 L132,148 Z"/><path d="M120,122 L120,146"/><path d="M113,134 Q116,130 120,134 Q124,138 127,134"/></g>` +
		`</svg>`
	);
}

// The encoding keeki.css's other drawings use: double quotes become single,
// and only the characters a CSS url("…") data URI cannot carry are escaped.
const dataUri = (s: string) =>
	`url("data:image/svg+xml,${s
		.replaceAll('"', "'")
		.replaceAll("%", "%25")
		.replaceAll("#", "%23")
		.replaceAll("<", "%3C")
		.replaceAll(">", "%3E")}")`;

console.log(`keeki:\t--keeki-yurt: ${dataUri(svg(keeki))};`);
console.log(`blush:\t--keeki-yurt: ${dataUri(svg(blush))};`);
