// How another user's `AWAY *` (draft/pre-away: away, no message) renders,
// in a query and in the WHOIS card (docs/projects/do-not-disturb.md). No
// account needed: a pre-away helper connection says `AWAY *`, the page
// messages it (the server answers with a 301 carrying `*`) and asks WHOIS.
//
//   CHROME_BIN=<chromium> node tools/browser-drive.mjs \
//     tools/scenarios/away-star-render.mjs --no-ws
//
// SEANCE_URL (default http://localhost:8001/) and SEANCE_IRC_WS (default
// ws://127.0.0.1:8067/) point it at another build or ircd.
import {observe} from "./lib/irc-observer.mjs";

const RUN = Date.now().toString(36).slice(-5);
const NICK = `rnd${RUN}`;
const PEER = `peer${RUN}`;
const BASE = process.env.SEANCE_URL ?? "http://localhost:8001/";
const IRCD = process.env.SEANCE_IRC_WS ?? "ws://127.0.0.1:8067/";
const IRCD_PORT = Number(new URL(IRCD).port || 8067);

export const url = `${BASE}?host=127.0.0.1&port=${IRCD_PORT}&tls=false&nick=${NICK}&join=%23seance`;

export default async function run(page) {
	const peer = await observe(IRCD, PEER, {caps: ["draft/pre-away"], join: "#seance"});

	try {
		peer.send("AWAY *");
		await page.goto(page.url, {waitForSelector: "#connect form"});
		await page.click('#connect button[type="submit"]');
		await page.waitFor(`!!document.querySelector('.channel-list-item[data-name="#seance"]')`, {
			timeout: 20000,
			label: "joined",
		});
		const command = async (text) => {
			await page.fill("#input", text);
			await page.click("#submit");
			await page.sleep(1500);
		};

		await command(`/query ${PEER}`);
		await command("hello");
		const awayLine = await page.evaluate(
			`[...document.querySelectorAll('#chat .msg[data-type="away"]')].map((m) => m.textContent.replace(/\\s+/g, " ").trim()).pop() ?? ""`
		);
		page.check(
			`query: the 301 star reads "${PEER} is away", no message (${JSON.stringify(awayLine)})`,
			new RegExp(`${PEER}\\s+is away$`).test(awayLine)
		);

		await command(`/whois ${PEER}`);
		const card = await page.evaluate(`(() => {
			const rows = [...document.querySelectorAll('#chat .msg:last-child dl.whois > div')];
			const i = rows.findIndex((r) => r.querySelector("dt")?.textContent.trim() === "Away:");
			if (i < 0) return {found: false};
			const rect = (el) => el && (({top, bottom, left, right}) => ({top, bottom, left, right}))(el.getBoundingClientRect());
			const row = rows[i];
			const next = rows[i + 1]?.querySelector("dt");
			return {
				found: true,
				value: row.querySelector("dd")?.textContent.trim() ?? null,
				label: rect(row.querySelector("dt")),
				dd: rect(row.querySelector("dd")),
				next: rect(next),
				nextText: next?.textContent.trim() ?? null,
			};
		})()`);
		console.log(`  WHOIS Away row: ${JSON.stringify(card)}`);
		page.check(`whois: an "Away:" label`, card.found);
		page.check(
			`whois: its value cell exists and says there is no message (${JSON.stringify(
				card.value
			)})`,
			card.found && card.value === "(no message)" && card.dd && card.dd.bottom > card.dd.top
		);
		page.check(
			`whois: the label does not overlap the next one (${card.nextText}: ${JSON.stringify(
				card.next
			)} vs ${JSON.stringify(card.label)})`,
			card.found && (!card.next || card.next.top >= card.label.bottom - 0.5)
		);
		await page.screenshot("away-star", {selector: "#chat .msg:last-child"});
	} finally {
		peer.close();
	}

	page.check("no console errors", page.consoleErrors.length === 0);
}
