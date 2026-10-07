// Two push networks connecting together each get their turn at the push
// prompt (webpush.ts `heldBack` / `promptOthers`): the prompt is one at a
// time, and the second network used to be skipped until it reconnected.
//
//   npx webpack && python3 -m http.server -d public 8001 &
//   node tools/browser-drive.mjs tools/scenarios/push-prompt-every-network.mjs
//
// Defaults to the testnet ircd the other push scenarios use. Against a real
// network (one SASL account is enough — both saved networks log in with it —
// or a second one in SEANCE_PUSH_ACCOUNT2 / SEANCE_PUSH_PASSWORD2):
//
//   SEANCE_PUSH_HOST=fractalrealities.afternet.org/wockets/secure \
//   SEANCE_PUSH_PORT=9998 SEANCE_PUSH_TLS=1 SEANCE_PUSH_CHANNEL='#textual' \
//   SEANCE_PUSH_ACCOUNT=… SEANCE_PUSH_PASSWORD=… node tools/browser-drive.mjs …
//
// The Push API is faked (lib/fake-push.mjs); SASL and WEBPUSH on the wire are
// real, and the run unsubscribes both networks at the end, so the account is
// left with nothing registered.
//
// Claims under test:
//   1. with notification permission not yet asked, two networks connecting
//      together open one prompt, for one of them;
//   2. accepting it subscribes that network, then the other one silently
//      under the permission just granted — a REGISTER on each socket, two
//      entries — with no second prompt;
//   3. both unsubscribe again (cleanup).

import {FAKE_PUSH_API, storedSubs} from "./lib/fake-push.mjs";

const ORIGIN = "http://127.0.0.1:8001";
const env = process.env;
const HOST = env.SEANCE_PUSH_HOST || "127.0.0.1";
const PORT = Number(env.SEANCE_PUSH_PORT || 8067);
const TLS = env.SEANCE_PUSH_TLS === "1";
const CHANNEL = env.SEANCE_PUSH_CHANNEL || "#seance";
const ACCOUNT1 = env.SEANCE_PUSH_ACCOUNT || "pushtest1";
const PASSWORD1 = env.SEANCE_PUSH_PASSWORD || "pushtest1-pass";
// A second account if given, else the first one again (both log in with it).
const ACCOUNT2 = env.SEANCE_PUSH_ACCOUNT2 || (env.SEANCE_PUSH_ACCOUNT ? ACCOUNT1 : "pushtest2");
const PASSWORD2 =
	env.SEANCE_PUSH_PASSWORD2 || (env.SEANCE_PUSH_ACCOUNT ? PASSWORD1 : "pushtest2-pass");
const tag = Math.random().toString(36).slice(2, 6);
const NET1 = {
	uuid: `pp1-${tag}`,
	name: "First",
	nick: `ppA${tag}`,
	account: ACCOUNT1,
	password: PASSWORD1,
};
const NET2 = {
	uuid: `pp2-${tag}`,
	name: "Second",
	nick: `ppB${tag}`,
	account: ACCOUNT2,
	password: PASSWORD2,
};

export const url = `${ORIGIN}/`;

const frameText = (f) => (typeof f.payloadData === "string" ? f.payloadData : "");
const promptOpened = `document.querySelector("#push-prompt-overlay")?.classList.contains("opened")`;
const promptGone = `getComputedStyle(document.querySelector("#push-prompt-overlay")).visibility === "hidden"`;

const saved = (net) => ({
	uuid: net.uuid,
	name: net.name,
	host: HOST,
	port: PORT,
	tls: TLS,
	nick: net.nick,
	join: CHANNEL,
	sasl: "plain",
	saslAccount: net.account,
	saslPassword: net.password,
	rememberPassword: true,
	autoconnect: true,
	pushEnabled: true,
});

/** The socket (requestId) that sent `NICK <nick>`. */
function socketOfNick(page, since, nick) {
	const hit = page.wsFrames
		.slice(since)
		.find((f) => f.dir === "out" && frameText(f).trim() === `NICK ${nick}`);
	return hit?.requestId;
}

/** Wait for a frame on one socket; returns its text. */
async function waitOn(page, since, requestId, dir, re, what) {
	const deadline = Date.now() + 30000;

	while (Date.now() < deadline) {
		const hit = page.wsFrames
			.slice(since)
			.find((f) => f.dir === dir && f.requestId === requestId && re.test(frameText(f)));

		if (hit) {
			return frameText(hit);
		}

		await page.sleep(100);
	}

	throw new Error(`timed out waiting for ${what}`);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function waitRegisterOn(page, since, requestId, what) {
	const deadline = Date.now() + 30000;

	while (Date.now() < deadline) {
		const hit = page.wsFrames
			.slice(since)
			.find(
				(f) =>
					f.dir === "out" &&
					f.requestId === requestId &&
					/^WEBPUSH REGISTER /.test(frameText(f))
			);

		if (hit) {
			return frameText(hit).split(" ")[2];
		}

		await page.sleep(100);
	}

	throw new Error(`timed out waiting for ${what}`);
}

async function pushOff(page, net, endpoint, requestId) {
	const mark = page.wsFrames.length;
	await page.evaluate(`location.hash = "#/edit-network/${net.uuid}"`);
	await page.waitFor(`!!document.querySelector('input[name="pushEnabled"]')`, {
		label: `the push checkbox for ${net.name}`,
	});

	for (const selector of ['input[name="pushEnabled"]', 'button[type="submit"]']) {
		await page.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block: "center"})`
		);
		await page.click(selector);
	}

	// The server's answer, not just our line: the account keeps nothing.
	await waitOn(
		page,
		mark,
		requestId,
		"in",
		new RegExp(`^WEBPUSH UNREGISTER ${escape(endpoint)}$`),
		`the server's answer to ${net.name}'s UNREGISTER`
	);
}

export default async function run(page) {
	await page.addInitScript(FAKE_PUSH_API);

	// --- setup: two saved networks, permission never asked -------------------
	await page.goto(url);
	await page.waitFor(`document.readyState === "complete"`, {label: "the page"});
	await page.evaluate(`(() => {
		localStorage.setItem("thelounge.networks", ${JSON.stringify(
			JSON.stringify([saved(NET1), saved(NET2)])
		)});
		localStorage.removeItem("thelounge.push");
		localStorage.removeItem("thelounge.push.neverAsk");
	})()`);
	page.check(
		"setup: notification permission not yet asked",
		(await page.evaluate(`Notification.permission`)) === "default"
	);

	const before = page.wsFrames.length;
	await page.evaluate(`location.reload()`);

	// --- 1. one prompt, for one network --------------------------------------
	await page.waitFor(promptOpened, {label: "the push prompt", timeout: 60000});
	const sock1 = socketOfNick(page, before, NET1.nick);
	const sock2 = socketOfNick(page, before, NET2.nick);
	page.check(
		"1. both networks dialled on their own sockets",
		Boolean(sock1 && sock2 && sock1 !== sock2)
	);

	// The race under test: both registrations have announced push while the
	// first prompt is still open (each says so with its end of MOTD).
	for (const [sock, net] of [
		[sock1, NET1],
		[sock2, NET2],
	]) {
		await waitOn(page, before, sock, "in", / (376|422) /, `${net.name}'s registration`);
	}

	await page.sleep(1500);
	page.check(
		"1. still one prompt once both have registered",
		(await page.evaluate(promptOpened)) === true
	);
	const label = String(
		await page.evaluate(
			`document.querySelector("#push-prompt .push-prompt-target")?.textContent`
		)
	);
	const first = label.includes(NET1.name) ? NET1 : label.includes(NET2.name) ? NET2 : null;
	page.check(`1. the prompt names one network (${label.trim()})`, first !== null);
	await page.screenshot("1-one-prompt");

	// --- 2. accept: that one subscribes, then the other silently -------------
	await page.grantPermissions(["notifications"], ORIGIN);
	const mark = page.wsFrames.length;
	await page.click("#pushPromptYes");
	const ep1 = await waitRegisterOn(page, mark, sock1, "network 1's REGISTER");
	const ep2 = await waitRegisterOn(page, mark, sock2, "network 2's REGISTER");
	page.check("2. each network registered its own endpoint", Boolean(ep1 && ep2) && ep1 !== ep2);
	await page.sleep(1500);
	page.check("2. no second prompt", (await page.evaluate(promptGone)) === true);
	const subs = await storedSubs(page);
	page.check(
		"2. two entries, one per network",
		Object.keys(subs).sort().join() === [NET1.uuid, NET2.uuid].sort().join()
	);
	await page.screenshot("2-both-subscribed");

	// --- 3. cleanup ------------------------------------------------------------
	await pushOff(page, NET1, ep1, sock1);
	await pushOff(page, NET2, ep2, sock2);
	page.check("3. cleanup: nothing stored", Object.keys(await storedSubs(page)).length === 0);

	page.check("no console errors", page.consoleErrors.length === 0);
}
