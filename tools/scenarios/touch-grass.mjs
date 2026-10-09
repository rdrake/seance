// Touch grass (client/js/touchGrass.ts): the conversation menu's "Touch
// grass" fades the app away over the ps scene until a click or a key brings
// it back, and the press that ends it never lands on the app it uncovers.
//
//   NODE_ENV=production corepack yarn build && python3 -m http.server -d public 8007 &
//   node tools/browser-drive.mjs tools/scenarios/touch-grass.mjs
//
// Needs the dev ircd (the menu is a conversation's). Exports `sceneRest` so
// browser-drive sends no input of its own: the run shows that a watched scene
// keeps moving past the 15 s rest of a window without the focus.

const IRCD = process.env.SEANCE_IRC_URL ?? "ws://127.0.0.1:8067/";
const PORT = process.env.SEANCE_PORT ?? "8007";
const RUN = Math.random().toString(36).slice(2, 6);
const CHANNEL = `#grass${RUN}`;
const NICK = `grass${RUN}`;
const ircd = new URL(IRCD);

export const url =
	`http://localhost:${PORT}/?host=${ircd.hostname}&port=${ircd.port}&tls=false&nick=${NICK}` +
	`&join=${encodeURIComponent(CHANNEL)}`;
export const sceneRest = true;

const STATE = `(async () => {
	const s = document.querySelector("#theme-scene");
	const anims = s.getAnimations({subtree: true}).filter((a) => "animationName" in a);
	const at = anims.map((a) => a.currentTime);
	await new Promise((r) => setTimeout(r, 300));
	return {
		mark: document.documentElement.dataset.touchGrass ?? null,
		opacity: getComputedStyle(document.querySelector("#viewport")).opacity,
		hint: document.querySelector("#touch-grass-hint")?.textContent ?? null,
		paused: s.classList.contains("ps-paused"),
		frosted: s.classList.contains("ps-private"),
		moving: anims.filter((a, i) => a.currentTime !== at[i]).length,
		hash: location.hash,
		input: document.querySelector("#input")?.value ?? null,
		focused: document.activeElement?.id ?? "",
	};
})()`;

async function enter(page) {
	await page.click("#chat .header .menu");
	await page.waitFor(`document.querySelector("#context-menu .context-menu-touch-grass")`, {
		timeout: 5000,
		label: "the conversation menu's Touch grass",
	});
	await page.click("#context-menu .context-menu-touch-grass");
	await page.sleep(900); // the fade
}

export default async function run(page) {
	await page.addInitScript(
		`try { localStorage.setItem("settings", JSON.stringify({theme: "ps"})); } catch (e) {}`
	);
	await page.goto(url, {waitForSelector: "#connect form"});
	await page.evaluate(`document.querySelector("#connect form").requestSubmit()`);
	await page.waitFor(`document.querySelector("#theme-scene").children.length > 0`);
	await page.waitFor(
		`document.querySelector("#chat .header .title")?.textContent.includes(${JSON.stringify(CHANNEL)})`,
		{timeout: 15000, label: "the channel open"}
	);
	await page.sleep(1500);

	await enter(page);
	let s = await page.evaluate(STATE);
	page.check(`on: html[data-touch-grass] = ${s.mark}`, s.mark === "on");
	page.check(`the app is hidden (#viewport opacity ${s.opacity})`, Number(s.opacity) === 0);
	page.check(`the hint says how to come back: "${s.hint}"`, /come back/.test(s.hint ?? ""));
	page.check(`the scene moves (${s.moving} animations moving)`, !s.paused && s.moving > 0);
	await page.screenshot("touch-grass-on");

	// A window without the focus rests its scene after 15 s; a watched one does not.
	await page.evaluate(`window.dispatchEvent(new Event("blur")); 1`);
	await page.sleep(16500);
	s = await page.evaluate(STATE);
	page.check(
		`16.5 s after a blur with no input, the watched scene still moves (${s.moving}; ps-paused ${s.paused})`,
		!s.paused && s.moving > 0
	);
	page.check(`the hint has gone (${s.hint})`, s.hint === null);
	await page.evaluate(`window.dispatchEvent(new Event("focus")); 1`);

	// A click on a sidebar row ends it and does not open that row.
	const hash = s.hash;
	await page.click("#sidebar .channel-list-item[data-type='lobby']");
	s = await page.evaluate(STATE);
	page.check(`a click ends it (mark ${s.mark})`, s.mark === "leaving" || s.mark === null);
	await page.sleep(700);
	s = await page.evaluate(STATE);
	page.check(`the click did not open the row under it (${hash} → ${s.hash})`, s.hash === hash);
	page.check(
		`the app is back and takes the pointer (mark ${s.mark}, opacity ${s.opacity})`,
		s.mark === null && Number(s.opacity) === 1
	);

	// A key ends it and types nothing.
	await page.evaluate(`document.querySelector("#input").focus(); 1`);
	await enter(page);
	await page.send("Input.dispatchKeyEvent", {type: "keyDown", key: "a", code: "KeyA", text: "a"});
	await page.send("Input.dispatchKeyEvent", {type: "keyUp", key: "a", code: "KeyA"});
	await page.sleep(700);
	s = await page.evaluate(STATE);
	page.check(`a key ends it (mark ${s.mark})`, s.mark === null);
	page.check(`and types nothing into the composer ("${s.input}")`, s.input === "");

	// A query's frost lifts while watching, and comes back after.
	await page.fill("#input", `/query ${NICK}x`);
	await page.click("#form #submit");
	await page.waitFor(`document.querySelector("#theme-scene").classList.contains("ps-private")`, {
		timeout: 8000,
		label: "a query, frosted",
	});
	await enter(page);
	s = await page.evaluate(STATE);
	page.check(`in a query, watching lifts the frost (ps-private ${s.frosted})`, !s.frosted && s.moving > 0);
	await page.send("Input.dispatchKeyEvent", {type: "keyDown", key: "Escape", code: "Escape"});
	await page.send("Input.dispatchKeyEvent", {type: "keyUp", key: "Escape", code: "Escape"});
	await page.sleep(700);
	s = await page.evaluate(STATE);
	page.check(`Escape ends it and the frost is back (ps-private ${s.frosted})`, s.mark === null && s.frosted);

	page.check(`no console errors (${page.consoleErrors.length})`, page.consoleErrors.length === 0);
}
