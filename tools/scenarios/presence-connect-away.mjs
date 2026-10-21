// What others see when Seance connects while the account is on global Away
// (docs/projects/shared-presence-modes.md § 5, "Away until read").
//
// Device A sets Same as global + Away, then reloads, closes and reopens; a
// second device B, which never saw the global mode, logs in and reloads.
// An observer in #seance with away-notify must see no AWAY line about the
// nick at any step (a back line was the bug: B declared its own stale
// state before the registration burst brought the global Away), and WHO
// must keep saying G. Needs an account on the rig:
//
//   SEANCE_SASL_ACCOUNT=idleuser2 SEANCE_SASL_PASSWORD=idlepass \
//     node tools/browser-drive.mjs tools/scenarios/presence-connect-away.mjs
import {observe} from "./lib/irc-observer.mjs";
import {FAKE_PUSH_API} from "./lib/fake-push.mjs";
import {startDevice} from "./lib/device.mjs";

const ACCOUNT = process.env.SEANCE_SASL_ACCOUNT,
	PASSWORD = process.env.SEANCE_SASL_PASSWORD;
const RUN = Date.now().toString(36).slice(-5);
const BASE = process.env.SEANCE_BASE ?? "http://localhost:8001/";
const link = (n) =>
	`${BASE}?host=127.0.0.1&port=8067&tls=false&nick=${n}&join=%23seance&saslAccount=${ACCOUNT}`;
export const url = link(`pca${RUN}`);
export const allowWsFrameErrors = /(Data frame|Close) received after close/;
const LOBBY = '.channel-list-item[data-type="lobby"]';
const PILL = "#sidebar .presence-pill";
const DOT = `${LOBBY} .lobby-presence .presence-dot`;
const MENU_ITEM = (c) => `#context-menu .context-menu-${c}`;
const joined = `!!document.querySelector('.channel-list-item[data-name="#seance"]:not(.parted-channel)')`;
const NICK = `document.querySelector('${LOBBY} .lobby-nick')?.textContent.replace(/^\\s*Nickname:\\s*/, "").trim()`;

export default async function run(page) {
	if (!ACCOUNT || !PASSWORD) throw new Error("set SEANCE_SASL_ACCOUNT and SEANCE_SASL_PASSWORD");
	const origin = new URL(BASE).origin;
	const pick = async (dev, opener, cls) => {
		await dev.click(opener);
		await dev.waitFor(`!!document.querySelector('${MENU_ITEM(cls)}')`, {label: cls});
		await dev.click(MENU_ITEM(cls));
		await dev.sleep(400);
	};
	const login = async (dev, l) => {
		await dev.addInitScript(
			`if (typeof ServiceWorkerRegistration !== "undefined") ${FAKE_PUSH_API}`
		);
		await dev.grantPermissions(["notifications"], origin);
		await dev.goto(l, {waitForSelector: "#connect form"});
		await dev.fill('#connect input[name="saslPassword"]', PASSWORD);
		for (const n of ["rememberPassword", "autoconnect"])
			if (
				!(await dev.evaluate(
					`document.querySelector('#connect input[name="${n}"]').checked`
				))
			)
				await dev.click(`#connect input[name="${n}"]`);
		await dev.click('#connect button[type="submit"]');
		await dev.waitFor(joined, {timeout: 25000, label: "joined"});
	};
	await login(page, page.url);
	const me = await page.evaluate(NICK);
	const obs = await observe("ws://127.0.0.1:8067/", `pco${RUN}`, {
		caps: ["away-notify", "extended-join", "account-notify", "chghost"],
		join: "#seance",
	});
	await page.sleep(12000);
	await pick(page, DOT, "presence-global");
	await pick(page, PILL, "status-away");
	await page.sleep(2000);
	console.log(
		`  set: WHO ${await obs.who(me)}, WHOIS ${JSON.stringify((await obs.whois(me)).away)}`
	);

	// Watch: every line naming the nick, and WHO sampled every 500 ms.
	const watch = async (label, action, ms = 20000) => {
		const t = Date.now();
		const flags = [];
		let done = false;
		const sampler = (async () => {
			while (!done) {
				try {
					flags.push(await obs.who(me));
				} catch {
					flags.push("?");
				}
				await page.sleep(500);
			}
		})();
		await action();
		await page.sleep(ms);
		done = true;
		await sampler;
		const lines = obs
			.since(t)
			.map((l) => l.line ?? l)
			.filter((l) => l.includes(me) && !/ 35[2-9] | 31[1-9] | 30[1-9] | 315 | 318 /.test(l));
		console.log(
			`  [${label}] WHO samples: ${[...new Set(flags)].join(",")} (${flags.join("")})`
		);
		console.log(`    lines about ${me}: ${JSON.stringify(lines)}`);
		const aways = lines.filter((l) => / AWAY( |$)/.test(l));
		if (aways.length) throw new Error(`${label}: others saw ${JSON.stringify(aways)}`);
		if (flags.some((f) => f !== "G" && f !== "?"))
			throw new Error(`${label}: WHO said ${flags.join("")}`);
	};

	await watch("A reloads", async () => {
		await page.goto(BASE, {waitForSelector: "#chat-container"});
		await page.waitFor(joined, {timeout: 25000});
	});
	await watch(
		"A closed",
		async () => {
			await page.evaluate(`addEventListener("unload", () => {})`);
			await page.goto("about:blank");
		},
		10000
	);
	await watch("A reopened", async () => {
		await page.goto(BASE, {waitForSelector: "#chat-container"});
		await page.waitFor(joined, {timeout: 25000});
	});
	const b = await startDevice({name: "B"});
	try {
		await watch(
			"B (never saw the global mode) logs in",
			() => login(b, link(`pcb${RUN}`)),
			22000
		);
		const pill = await b.evaluate(`document.querySelector('${PILL}')?.textContent.trim()`);
		console.log(`  B's pill: ${pill}`);
		if (!/Away/.test(pill ?? "")) throw new Error(`B's pill says ${pill}, not Away`);
		await watch("B reloads", async () => {
			await b.goto(BASE, {waitForSelector: "#chat-container"});
			await b.waitFor(joined, {timeout: 25000});
		});
	} finally {
		await pick(page, PILL, "status-auto");
		await page.sleep(1000);
		await b.close();
		obs.close();
	}
}
