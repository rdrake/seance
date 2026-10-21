// Presence modes on TWO devices of one account (docs/projects/do-not-disturb.md,
// docs/projects/shared-presence-modes.md): device A sets Away, which both
// devices share (the mode is shared, so they cannot differ), then neither
// looked at (hidden, and
// later closed), then each opened on its own. Records, per step, what other
// users see (an observer's WHO flag and WHOIS 301), whether a highlight is
// pushed (the ircd log's `notify_account … for <account>` line, written only
// when the server decides nobody attends), and each device's own dot.
//
// The server's rules (nefarious2): the account is away to others only when
// every connection is away (bounce_compute_effective_away); a push goes out
// only when no connection attends — held, away, or silent past WEBPUSH_IDLE
// (webpush_attention.c; the rig sets 60 s, the default is 900 s).
//
//   CHROME_BIN=<chromium> SEANCE_SASL_ACCOUNT=idleuser \
//     SEANCE_SASL_PASSWORD=idlepass node tools/browser-drive.mjs \
//     tools/scenarios/presence-modes-two-devices.mjs --no-ws
//
// Needs the testnet rig (SASL, draft/persistence, draft/pre-away,
// draft/metadata-2, draft/webpush) and SEANCE_IRCD_LOG pointing at its log
// (default /seance/tmp/testnet-run/conf/ircd.log).

import {readFileSync, statSync} from "node:fs";
import {observe} from "./lib/irc-observer.mjs";
import {FAKE_PUSH_API} from "./lib/fake-push.mjs";
import {startDevice} from "./lib/device.mjs";

const ACCOUNT = process.env.SEANCE_SASL_ACCOUNT;
const PASSWORD = process.env.SEANCE_SASL_PASSWORD;
const IRCD_LOG = process.env.SEANCE_IRCD_LOG ?? "/seance/tmp/testnet-run/conf/ircd.log";
const RUN = Date.now().toString(36);
const BASE = process.env.SEANCE_URL ?? "http://localhost:8001/";
const IRCD = process.env.SEANCE_IRC_WS ?? "ws://127.0.0.1:8067/";
const IRCD_PORT = Number(new URL(IRCD).port || 8067);
const SETTLE = 1500;
const IDLE_S = Number(process.env.SEANCE_WEBPUSH_IDLE ?? 60);

const linkFor = (nick) =>
	`${BASE}?host=127.0.0.1&port=${IRCD_PORT}&tls=false&nick=${nick}&join=%23seance&saslAccount=${encodeURIComponent(
		ACCOUNT ?? ""
	)}`;

export const url = linkFor(`pma${RUN.slice(-6)}`);

const LOBBY = '.channel-list-item[data-type="lobby"]';
const PILL = "#sidebar .presence-pill";
const DOT = `${LOBBY} .lobby-presence .presence-dot`;
const MENU_ITEM = (cls) => `#context-menu .context-menu-${cls}`;
const joined = (name) =>
	`!!document.querySelector('.channel-list-item[data-name="${name}"]:not(.parted-channel)')`;
const OUR_NICK = `document.querySelector('${LOBBY} .lobby-nick')?.textContent.replace(/^\\s*Nickname:\\s*/, "").trim()`;
const DOT_TEXT = `document.querySelector('${DOT}')?.getAttribute("title")`;

const PUSH_API = `if (typeof ServiceWorkerRegistration !== "undefined") ${FAKE_PUSH_API}`;
const CLOSE_FOR_REAL = `addEventListener("unload", () => {})`;
const HIDE = `(() => {
	Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "hidden"});
	Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
	window.dispatchEvent(new Event("blur"));
	document.dispatchEvent(new Event("visibilitychange"));
})()`;
const SHOW = `(() => {
	delete document.visibilityState;
	delete document.hidden;
	document.dispatchEvent(new Event("visibilitychange"));
	window.dispatchEvent(new Event("focus"));
})()`;

const logSize = () => statSync(IRCD_LOG).size;
const pushesSince = (offset) => {
	const text = readFileSync(IRCD_LOG, "utf8").slice(offset);
	const re = new RegExp(`notify_account: iterating subscriptions for ${ACCOUNT}\\b`, "g");
	return (text.match(re) ?? []).length;
};

export default async function run(page) {
	if (!ACCOUNT || !PASSWORD) {
		throw new Error("set SEANCE_SASL_ACCOUNT and SEANCE_SASL_PASSWORD (an account of its own)");
	}

	const origin = new URL(BASE).origin;
	const b = await startDevice({name: "B"});
	const results = [];

	const command = async (dev, text) => {
		await dev.fill("#input", text);
		await dev.click("#submit");
	};
	const menu = async (dev, opener, cls) => {
		await dev.click(opener);
		await dev.waitFor(`!!document.querySelector('${MENU_ITEM(cls)}')`, {label: `menu ${cls}`});
		await dev.click(MENU_ITEM(cls));
		await dev.sleep(300);
	};
	const login = async (dev, link) => {
		await dev.addInitScript(PUSH_API);
		await dev.grantPermissions(["notifications"], origin);
		await dev.goto(link, {waitForSelector: "#connect form"});
		await dev.fill('#connect input[name="saslPassword"]', PASSWORD);

		for (const name of ["rememberPassword", "autoconnect"]) {
			if (
				!(await dev.evaluate(
					`document.querySelector('#connect input[name="${name}"]').checked`
				))
			) {
				await dev.click(`#connect input[name="${name}"]`);
			}
		}

		await dev.click('#connect button[type="submit"]');
		await dev.waitFor(joined("#seance"), {timeout: 25000, label: "joined"});
	};
	const openChannel = async (dev) => {
		await dev.click('.channel-list-item[data-name="#seance"]');
		await dev.sleep(300);
	};
	const close = async (dev) => {
		await dev.evaluate(CLOSE_FOR_REAL);
		await dev.goto("about:blank");
	};
	const reopen = async (dev) => {
		await dev.goto(BASE, {waitForSelector: "#chat-container"});
		await dev.waitFor(joined("#seance"), {timeout: 25000, label: "session restored"});
		await dev.evaluate(SHOW);
	};
	const dotOf = async (dev, open) => (open ? await dev.evaluate(DOT_TEXT) : "(closed)");

	let obs;
	let me;
	let n = 0;

	// What others see, whether a highlight is pushed now, and each dot.
	const record = async (label, {aOpen = true, bOpen = true} = {}) => {
		const w = await obs.whois(me);
		const flag = await obs.who(me);
		const offset = logSize();
		obs.send(`PRIVMSG #seance :${me}: highlight ${++n}`);
		await page.sleep(2500);
		const pushed = pushesSince(offset) > 0;
		const row = {
			step: label,
			others: flag === "G" ? `away (${JSON.stringify(w.away)})` : "present",
			pushed: pushed ? "yes" : "no",
			dotA: await dotOf(page, aOpen),
			dotB: await dotOf(b, bOpen),
		};
		results.push(row);
		console.log(
			`  ${label}: others see ${row.others}; highlight pushed: ${row.pushed}; A dot "${row.dotA}"; B dot "${row.dotB}"`
		);
		return row;
	};

	try {
		await login(page, page.url);
		me = await page.evaluate(OUR_NICK);
		obs = await observe(IRCD, `pmo${RUN.slice(-6)}`, {
			caps: ["away-notify", "draft/metadata-2"],
			join: "#seance",
		});

		// Clean start: the mute read lands, DND off, no /away.
		await page.sleep(11000);
		await menu(page, PILL, "status-auto");
		await command(page, "/back");
		await page.evaluate(SHOW);

		await login(b, linkFor(`pmb${RUN.slice(-6)}`));
		const bNick = await b.evaluate(OUR_NICK);
		page.check(`B on the same session (${bNick})`, bNick === me);
		await b.evaluate(SHOW);
		await page.sleep(11000);

		// One shared mode: Away on A reaches B (docs/projects/shared-presence-modes.md).
		await menu(page, DOT, "presence-away");
		await page.sleep(4000);

		// 1. Both looked at.
		let r = await record("1. both Away, both open and focused");
		page.check(
			`1. away to others: both devices on Away (${r.others})`,
			r.others.startsWith("away")
		);

		// 2. Neither looked at; B said something just before.
		await openChannel(b);
		await command(b, "b was here");
		await page.evaluate(HIDE);
		await b.evaluate(HIDE);
		await page.sleep(SETTLE);
		r = await record("2. both hidden, B spoke seconds ago");
		page.check(`2. still away to others (${r.others})`, r.others.startsWith("away"));

		// 3. Neither looked at, B silent past the idle window.
		await page.sleep((IDLE_S + 5) * 1000);
		r = await record(`3. both hidden, B silent ${IDLE_S + 5} s`);

		// 4. A opened on its own.
		await page.evaluate(SHOW);
		await page.sleep(SETTLE);
		r = await record("4. A opened (B hidden)");
		page.check("4. B follows A's Away (its dot)", /^Away/.test(r.dotB ?? ""));

		// 5. A put away again, B opened on its own.
		await page.evaluate(HIDE);
		await b.evaluate(SHOW);
		await page.sleep(SETTLE);
		r = await record("5. B opened (A hidden)");
		page.check(`5. away to others (${r.others})`, r.others.startsWith("away"));

		// 6. Both closed (A first, B last).
		await b.evaluate(HIDE);
		await close(page);
		await page.sleep(2000);
		await close(b);
		await page.sleep(8000);
		r = await record("6. both closed (A first, then B)", {aOpen: false, bOpen: false});

		// 7. A reopened alone.
		await reopen(page);
		await page.sleep(16000);
		r = await record("7. A reopened alone (B closed)", {bOpen: false});
		// A resumes the held session on Away (presence.ts presenceRegistered
		// repeats the star; its regression with B on Online is pinned in
		// test/irc/preaway.ts, as the modes can no longer differ).
		page.check(
			`7. A on Away resuming alone is away to others (${r.others})`,
			r.others.startsWith("away")
		);
		page.check("7. and its highlight is pushed", r.pushed === "yes");

		// 8. A closed again, B reopened alone.
		await close(page);
		await page.sleep(8000);
		await reopen(b);
		await page.sleep(16000);
		r = await record("8. B reopened alone (A closed)", {aOpen: false});

		// Leave the account as found: B back to Auto, A back to Auto.
		await menu(b, DOT, "presence-global");
		await reopen(page);
		await page.sleep(SETTLE);
		await menu(page, DOT, "presence-global");
	} finally {
		console.log("\n  RESULTS");
		for (const row of results) {
			console.log(
				`  | ${row.step} | ${row.others} | ${row.pushed} | ${row.dotA} | ${row.dotB} |`
			);
		}

		await b.close();
		obs?.close();
	}
}
