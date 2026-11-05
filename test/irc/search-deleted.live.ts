/**
 * Live test: a deleted line, or the old text of an edited one, must not come
 * back from the server's search. Seance cannot hide such a row itself: nothing
 * on a search row says it was deleted, so this checks the server. Skipped unless
 * SEANCE_IRC_URL is set, and on a server without soju.im/search:
 *
 *   NEFARIOUS_IMAGE=nefarious2:search tools/nefarious-dev/run.sh -d
 *   SEANCE_IRC_URL=ws://127.0.0.1:8067/ NODE_ENV=test \
 *     pnpm exec mocha --config=test/.mocharc.yml \
 *     test/irc/search-deleted.live.ts
 *
 * The deleted-text cases fail on nefarious2 for now: its CHATHISTORY replies
 * hide a redacted line, its SEARCH replies do not. Search for a line nobody
 * deleted is the control, so an empty answer cannot pass for hiding.
 */
import {expect} from "chai";
import socket from "../../client/js/socket";
import {IrcClient} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {requestSearch} from "../../client/js/irc/historysearch";
import {ChanState} from "../../shared/types/chan";
import type {SharedMsg} from "../../shared/types/msg";
import type {SearchAttrs, SearchHit} from "../../shared/types/search";

const url = process.env.SEANCE_IRC_URL;
const describeLive = url ? describe : describe.skip;

async function waitFor(what: string, test: () => boolean, timeoutMs = 10_000): Promise<void> {
	const start = Date.now();

	while (!test()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`timed out waiting for ${what}`);
		}

		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describeLive("Deleted lines in search (live)", function () {
	this.timeout(60_000);

	const run = Date.now().toString(36).slice(-5);
	const channel = `#del${run}`;
	const words = {
		kept: `keptword${run}`,
		deleted: `deletedword${run}`,
		before: `beforeedit${run}`,
		after: `afteredit${run}`,
	};
	const ids = new IdAllocator();
	const seen: SharedMsg[] = [];
	const redacted: string[] = [];
	const answers = new Map<number, {status: string; hits: SearchHit[]}>();
	let author: IrcClient;
	let member: IrcClient;
	let requestId = 0;

	function makeClient(nick: string): IrcClient {
		const parsed = new URL(url as string);
		return new IrcClient({
			host: parsed.hostname + (parsed.pathname === "/" ? "" : parsed.pathname),
			port: parseInt(parsed.port, 10) || (parsed.protocol === "wss:" ? 443 : 80),
			tls: parsed.protocol === "wss:",
			nick,
			join: channel,
			sasl: "",
			saslAccount: "",
			saslPassword: "",
			ids,
			reconnect: {enabled: false, initialDelayMs: 1, maxDelayMs: 1, factor: 1, jitter: false},
		});
	}

	/** The msgid of a line the other client has received. */
	async function said(text: string): Promise<string> {
		await waitFor(`"${text}" to arrive`, () =>
			seen.some((msg) => msg.text === text && msg.msgid)
		);
		return seen.find((msg) => msg.text === text)!.msgid!;
	}

	async function search(attrs: SearchAttrs): Promise<SearchHit[]> {
		const id = ++requestId;
		requestSearch(member, id, attrs);
		await waitFor(`search ${JSON.stringify(attrs)}`, () => answers.has(id));
		expect(answers.get(id)!.status).to.equal("ok");
		return answers.get(id)!.hits;
	}

	const texts = (hits: SearchHit[]) => hits.map((hit) => hit.msg.text);

	before(async function () {
		const memberChan = () => member.findChannel(channel);

		socket.on("msg", ({msg, chan}) => {
			if (chan === memberChan()?.id) {
				seen.push(msg);
			}
		});
		socket.on("msg:redact", ({chan, msgid}) => {
			if (chan === memberChan()?.id) {
				redacted.push(msgid);
			}
		});
		socket.on("search:results", ({requestId: id, status, hits}) => {
			answers.set(id, {status, hits});
		});

		author = makeClient(`dela${run}`);
		member = makeClient(`delm${run}`);
		author.connect();
		member.connect();
		await waitFor(
			"both clients in the channel",
			() =>
				author.findChannel(channel)?.state === ChanState.JOINED &&
				member.findChannel(channel)?.state === ChanState.JOINED,
			20_000
		);

		if (!member.caps.hasCapability("soju.im/search")) {
			this.skip();
		}

		const chan = author.findChannel(channel)!;
		author.sendMessage(channel, `line ${words.kept}`);
		author.sendMessage(channel, `line ${words.deleted}`);
		author.sendMessage(channel, `line ${words.before}`);
		const deleted = await said(`line ${words.deleted}`);
		const edited = await said(`line ${words.before}`);
		await said(`line ${words.kept}`);

		// Both through the client's own calls, the same lines a user's delete and edit send.
		author.redact(chan, deleted, "gone");
		author.editMessage(chan, edited, `line ${words.after}`);
		await waitFor("the delete and the edit to arrive", () => redacted.length === 2);
		await said(`line ${words.after}`);
	});

	after(function () {
		socket.removeAllListeners();
		author?.disconnect("search-deleted live test done");
		member?.disconnect("search-deleted live test done");
	});

	for (const [scope, attrs] of [
		["in the channel", {in: channel}],
		["in every channel", {}],
	] as [string, SearchAttrs][]) {
		describe(scope, function () {
			it("finds a line nobody deleted", async function () {
				expect(texts(await search({...attrs, text: words.kept}))).to.deep.equal([
					`line ${words.kept}`,
				]);
			});

			it("does not find a deleted line", async function () {
				expect(texts(await search({...attrs, text: words.deleted}))).to.deep.equal([]);
			});

			it("does not find an edited line's old text", async function () {
				expect(texts(await search({...attrs, text: words.before}))).to.deep.equal([]);
			});

			it("finds an edited line's new text", async function () {
				expect(texts(await search({...attrs, text: words.after}))).to.deep.equal([
					`line ${words.after}`,
				]);
			});
		});
	}
});
