// Message-row appearance: own-message contrast and the hover band.
//
//   corepack yarn build && python3 -m http.server 8100 &
//   node tools/browser-drive.mjs tools/scenarios/message-hover.mjs
//   node tools/browser-drive.mjs tools/scenarios/message-hover.mjs --mobile
//
// Runs against tools/scenarios/fixtures/message-rows.html — the markup
// Message.vue and MessageCondensed.vue emit, served flat against the built
// stylesheet — because neither rule reads the store, the IRC layer or a socket,
// and an ircd would only slow the check down. Checks:
//
//   1. own message text clears 7:1 against the chat background on every theme
//      (it used to sit at 5.4:1 in coffee while everyone else's read 14.1:1);
//   2. it is still a visible step quieter than another user's message, so a
//      fast scroll can still tell them apart;
//   3. hovering a row paints `--msg-hover-bg` on that row and nothing else;
//   4. a condensed block bands its children and its summary, never the wrapper
//      (it is a `.msg` holding `.msg`s, so the band would be painted twice);
//   5. a highlight row keeps its own background under the band;
//   6. with `--mobile` (`hover: none`) nothing bands on hover — WebKit fakes a
//      hover on long press and that is also how a selection starts — and
//      `.actions-open` bands instead.

const THEMES = ["coffee", "cobalt", "creama", "frost", "molokai", "day", "morning"];

const base = "http://127.0.0.1:8100/tools/scenarios/fixtures/message-rows.html";

// WCAG 2.x relative luminance and contrast, over the *computed* colours, so
// this measures what the cascade actually produced rather than the tokens.
const contrastHelpers = `
	// Resolve through a canvas: a computed \`color-mix()\` comes back as
	// \`color(srgb 0.85 0.83 0.79)\`, whose numbers are 0..1, and a naive
	// number scrape reads those as 0..255 and reports near-black.
	const _cv = document.createElement("canvas").getContext("2d", {willReadFrequently: true});
	const _rgb = (s) => {
		_cv.clearRect(0, 0, 1, 1);
		_cv.fillStyle = "#000";
		_cv.fillStyle = s;
		_cv.fillRect(0, 0, 1, 1);
		const d = _cv.getImageData(0, 0, 1, 1).data;
		return [d[0], d[1], d[2]];
	};
	const _lum = (c) => {
		const [r, g, b] = _rgb(c).map((v) => {
			const x = v / 255;
			return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const _contrast = (a, b) => {
		const [x, y] = [_lum(a), _lum(b)].sort((p, q) => q - p);
		return (x + 0.05) / (y + 0.05);
	};
	const _clear = (c) => !c || c === "transparent" || /,\\s*0\\)$/.test(c);
	const _bg = () => {
		let el = document.querySelector("#chat .messages");
		while (el) {
			const c = getComputedStyle(el).backgroundColor;
			if (!_clear(c)) return c;
			el = el.parentElement;
		}
		return "rgb(255, 255, 255)";
	};
	const _fg = (sel) => getComputedStyle(document.querySelector(sel)).color;
	// The band is translucent, so its visibility is the contrast between a
	// banded row and an unbanded one. Chrome resolves the token to
	// \`oklab(... / 0.06)\`; the canvas does the compositing rather than this
	// script guessing at how a mix toward \`transparent\` lands in sRGB.
	const _band = () => {
		const d = document.createElement("div");
		d.style.backgroundColor = "var(--msg-hover-bg)";
		document.body.appendChild(d);
		const c = getComputedStyle(d).backgroundColor;
		d.remove();
		return c;
	};
	const _over = (over, base) => {
		_cv.clearRect(0, 0, 1, 1);
		_cv.fillStyle = "#000";
		_cv.fillStyle = base;
		_cv.fillRect(0, 0, 1, 1);
		_cv.fillStyle = "#000";
		_cv.fillStyle = over;
		_cv.fillRect(0, 0, 1, 1);
		const d = _cv.getImageData(0, 0, 1, 1).data;
		return "rgb(" + d[0] + ", " + d[1] + ", " + d[2] + ")";
	};
	const _bandContrast = () => _contrast(_over(_band(), _bg()), _bg());
`;

/** `evaluate` runs every expression in the one page global, so the helpers go
 *  inside an IIFE — declaring them at top level twice is a redeclaration. */
const withHelpers = (expr) => `(() => {${contrastHelpers} return ${expr};})()`;

const styleOf = (sel, prop) =>
	`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).${prop}`;

/** The band is a flat gradient laid over whatever background-color won, so
 *  "banded" is a background-image, not a colour. */
const banded = async (page, sel) =>
	(await page.evaluate(styleOf(sel, "backgroundImage"))) !== "none";

export default async function run(page) {
	const touch = "matchMedia('(hover: none)').matches";

	// ---- 1 & 2: own-message contrast, every theme -------------------------
	for (const theme of THEMES) {
		await page.goto(`${base}?theme=${theme}`, {waitForSelector: "#msg-2 .content"});
		const self = await page.evaluate(
			withHelpers(`_contrast(_fg("#msg-2 .content"), _bg()).toFixed(2)`)
		);
		const other = await page.evaluate(
			withHelpers(`_contrast(_fg("#msg-1 .content"), _bg()).toFixed(2)`)
		);

		page.check(
			`${theme}: own message reads at ${self}:1 (others ${other}:1), at or above 7:1`,
			Number(self) >= 7
		);
		page.check(
			`${theme}: own message is still a step quieter than another user's`,
			Number(self) < Number(other)
		);

		// An action line is a whole message in the action colour, so it has to
		// clear normal-text AA like any other message. `day` had no
		// `--action-color` of its own and took #f39c12 straight from the rule:
		// 2.19:1 on white.
		const action = await page.evaluate(
			withHelpers(`_contrast(_fg("#msg-action .content"), _bg()).toFixed(2)`)
		);

		page.check(
			`${theme}: action text reads at ${action}:1, at or above 4.5:1`,
			Number(action) >= 4.5
		);

		// The reaction count sits on the pill's translucent fill, not on the
		// row, so the pill is composited first.
		const count = await page.evaluate(
			withHelpers(`(() => {
				const pill = getComputedStyle(document.querySelector("#msg-reacted .msg-reaction"));
				return _contrast(
					_fg("#msg-reacted .msg-reaction-count"),
					_over(pill.backgroundColor, _bg())
				).toFixed(2);
			})()`)
		);

		page.check(
			`${theme}: reaction count reads at ${count}:1 on its pill, at or above 4.5:1`,
			Number(count) >= 4.5
		);

		// The band is derived from each theme's text colour, so its strength
		// has to be checked per theme: a mix that vanishes on one palette
		// would leave that theme with the problem the band exists to solve.
		// The handoff's 3% lands near 1.06; this is the 6% deviation.
		const band = await page.evaluate(withHelpers(`_bandContrast().toFixed(3)`));

		page.check(
			`${theme}: the hover band reads at ${band} against the row (1.10-1.30)`,
			Number(band) >= 1.1 && Number(band) <= 1.3
		);
	}

	await page.goto(`${base}?theme=coffee`, {waitForSelector: "#msg-2 .content"});
	await page.screenshot("rows-idle");

	const isTouch = await page.evaluate(touch);

	// ---- 3: one row bands, and only that row ------------------------------
	await page.hover("#msg-1");
	page.check(
		isTouch ? "touch: hovering a row does not band it" : "hovering a row bands it",
		(await banded(page, "#msg-1")) === !isTouch
	);
	page.check("the row below the pointer is untouched", !(await banded(page, "#msg-7")));
	await page.screenshot("row-hovered");

	// ---- 4: a condensed block bands its child, not its wrapper ------------
	await page.hover("#msg-5");
	page.check(
		isTouch ? "touch: a condensed child does not band" : "a condensed child bands",
		(await banded(page, "#msg-5")) === !isTouch
	);
	page.check(
		"the condensed wrapper never bands",
		!(await banded(page, '.msg[data-type="condensed"]'))
	);
	await page.screenshot("condensed-child-hovered");

	await page.hover(".condensed-summary");
	page.check(
		isTouch ? "touch: the condensed summary does not band" : "the condensed summary bands",
		(await banded(page, ".condensed-summary")) === !isTouch
	);

	// ---- 5: a highlight keeps its own background under the band -----------
	const highlightIdle = await page.evaluate(styleOf("#msg-4", "backgroundColor"));

	await page.hover("#msg-4");
	const highlightHovered = await page.evaluate(styleOf("#msg-4", "backgroundColor"));

	page.check(
		isTouch ? "touch: a highlight row does not band" : "a highlight row bands",
		(await banded(page, "#msg-4")) === !isTouch
	);
	page.check(
		"the band leaves the highlight's own colour alone",
		highlightHovered === highlightIdle && !/, *0\)$/.test(highlightHovered)
	);
	await page.screenshot("highlight-hovered");

	// ---- 6: the band follows the toolbar, not only the pointer ------------
	// The toolbar outlives the hover in two states, and the row it belongs to
	// has to keep saying so: an emoji picker left open, and keyboard focus.
	await page.hover("#msg-1");
	await page.evaluate(
		`document.querySelector("#msg-7 .msg-actions").classList.add("active"); true`
	);
	page.check(
		"an open picker bands its row with the pointer elsewhere",
		await banded(page, "#msg-7")
	);
	await page.screenshot("picker-open");

	await page.evaluate(
		`document.querySelector("#msg-7 .msg-actions").classList.remove("active"); true`
	);
	page.check("and stops when the picker closes", !(await banded(page, "#msg-7")));

	// A toolbar button is `display: none` until something reveals the toolbar,
	// and `.focus()` on an unrendered element does nothing — so this is also
	// the only order a keyboard user can reach it in: the toolbar comes up,
	// focus lands on a button, and the reveal that brought it up goes away.
	await page.evaluate(
		`(() => {
			const bar = document.querySelector("#msg-7 .msg-actions");
			bar.classList.add("active");
			bar.querySelector(".msg-action-reply").focus();
			bar.classList.remove("active");
			return document.activeElement.className;
		})()`
	);
	page.check("a focused toolbar button bands its row", await banded(page, "#msg-7"));
	page.check(
		"the condensed wrapper never bands, whatever the state",
		!(await banded(page, '.msg[data-type="condensed"]'))
	);
	await page.screenshot("focus-within");

	await page.evaluate(`document.activeElement.blur(); true`);
	await page.evaluate(`document.querySelector("#msg-7").classList.add("actions-open"); true`);
	page.check("a tapped-open toolbar bands its row", await banded(page, "#msg-7"));
	await page.screenshot("actions-open");
}
