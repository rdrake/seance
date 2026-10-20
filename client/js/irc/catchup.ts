/**
 * Paced per-channel catch-up after our JOIN: the history fetch
 * (`CHATHISTORY`) and the read-marker fetch (`MARKREAD`) for each channel.
 *
 * Why paced: ircu-family servers (nefarious2 included) charge every command
 * from a non-oper about 2 s of "fake lag" and stop parsing its lines once
 * the client is 10 s ahead (fakelag.ts). Firing MODE + CHATHISTORY +
 * MARKREAD for every autojoined channel the moment its JOIN echoes back put
 * ~65 commands on the wire for 15 channels and the user's first message
 * queued behind all of it (measured 2026-08-27, see
 * docs/projects/connect-burst.md).
 *
 * So: the channel the user is looking at is served at once, everything else
 * goes through the connection's background queue (`IrcClient.background`),
 * one channel per job, sent only while the server's clock as we reckon it
 * leaves room for the user's own lines. Opening a channel that is still
 * waiting serves it right away. Nothing here touches the store; tests drive
 * it with fake timers (`test/irc/catchup.ts`).
 *
 * Which channel goes first is the server's to say: one `CHATHISTORY TARGETS`
 * after the JOIN burst lists every channel we are in with the time of its
 * newest message, newest first. The catch-up is parked until it answers,
 * then queued in that order: channels with something new first, the ones we
 * hold everything for not at all, the ones we hold nothing for last. One
 * command buys the order of N and, on a reconnect, saves the fetch of every
 * quiet channel. A server that cannot answer gets the JOIN order.
 */

import {ChanState, ChanType} from "../../../shared/types/chan";
import type {Channel, MsgRef} from "./channel";
import type {IrcClient} from "./client";
import type {BatchHandler} from "./handlers/batch";
import {fetchReadMarker} from "./handlers/markread";
import {
	historyEnabled,
	historyLimit,
	pageFitsNow,
	requestChannelHistory,
	retryLostHistory,
} from "./history";
import {formatLine, type IrcMessage} from "./message";

/** What one channel's step is reckoned to cost: its history fetch (the marker query is a job of its own). */
export const CATCHUP_STEP_COST_MS = 2000;

/** A mode query is one command. */
const MODE_COST_MS = 2000;

/** So is a marker query. */
const MARKER_COST_MS = 2000;

/** And the `CHATHISTORY TARGETS` that orders the rest. */
export const TARGETS_COST_MS = 2000;

/** How long the parked catch-up waits for the TARGETS answer before going in JOIN order. */
export const TARGETS_TIMEOUT_MS = 5000;

/** Rows asked for (capped by ISUPPORT `CHATHISTORY`; nefarious2 caps at 100). */
const TARGETS_LIMIT = 100;

/**
 * The window's far end, past now: the server drops a target whose newest
 * message is later than it, and a server clock ahead of ours would lose
 * exactly the channel that was just written to.
 */
const TARGETS_AHEAD_MS = 86_400_000;

/** Fewer channels than this behind the active one are not worth a command to order. */
const TARGETS_MIN_CHANNELS = 2;

interface PendingCatchup {
	chan: Channel;
	/** The channel's newest known message before this JOIN (reconnect catch-up). */
	before: MsgRef | undefined;
	/** History + marker already went out with the JOIN; only the modes are left. */
	prefetched: boolean;
	/**
	 * The newest message the server stamped that the channel held before
	 * this JOIN (Channel.newestServerRef): what a TARGETS answer is compared
	 * with to tell that nothing is new.
	 */
	held: MsgRef | undefined;
}

/** The newest message per channel (casefolded name → ms), from a TARGETS answer. */
interface TargetsAnswer {
	rows: Map<string, number>;
	/**
	 * The batch carried `draft/chathistory-end`: the server says nothing was
	 * cut. Only then is a listed row the channel's newest message.
	 */
	complete: boolean;
}

/** One connection's TARGETS exchange. */
interface TargetsState {
	/** queued: the command waits for the clock; asked: sent, waiting for the answer; done: answered, failed or given up. */
	status: "queued" | "asked" | "done";
	/** Catch-up steps held until the answer, in JOIN order. */
	parked: PendingCatchup[];
	/**
	 * Channels (casefolded) whose JOIN went out after the command. The server
	 * reads our lines in order, so every other channel whose JOIN echo comes
	 * before the answer was a member when it answered; these may not have been.
	 */
	late: Set<string>;
	label?: string;
	timer?: ReturnType<typeof setTimeout>;
}

const targetsOf = new WeakMap<IrcClient, TargetsState>();

/** Clients whose server said it cannot answer TARGETS: not asked again for the page. */
const targetsRefused = new WeakSet<IrcClient>();

let targetsLabelCounter = 0;

/** The queued steps by background key, so a key can be told back as its channel. */
const pendingOf = new WeakMap<IrcClient, Map<string, PendingCatchup>>();

function pendingMap(client: IrcClient): Map<string, PendingCatchup> {
	let map = pendingOf.get(client);

	if (!map) {
		map = new Map();
		pendingOf.set(client, map);
	}

	return map;
}

const keyOf = (chan: Channel): string => `catchup:${chan.id}`;
const modeKeyOf = (chan: Channel): string => `mode:${chan.id}`;

/** Channels still waiting for their catch-up, in order (tests / diagnostics). */
export function pendingCatchup(client: IrcClient): readonly Channel[] {
	const map = pendingMap(client);
	const queued = client.background
		.keys()
		.map((key) => map.get(key)?.chan)
		.filter((chan): chan is Channel => chan !== undefined);
	return [...queued, ...(targetsOf.get(client)?.parked ?? []).map((p) => p.chan)];
}

/**
 * Send the history + marker fetch for `chan` right behind its JOIN, before
 * the echo: the server processes lines in order, so membership holds by the
 * time it reads them. Used for the active channel at connect time; the JOIN
 * echo then only has the modes left to ask for.
 */
export function prefetchCatchup(client: IrcClient, chan: Channel): void {
	chan.catchupPrefetched = true;
	fetchFor(client, chan, chan.newestRef);
}

/**
 * Our JOIN to `chan` was confirmed: queue its history + read-marker fetch.
 * The active channel jumps the queue and is served now.
 */
export function enqueueCatchup(
	client: IrcClient,
	chan: Channel,
	before: MsgRef | undefined,
	held: MsgRef | undefined
): void {
	const prefetched = chan.catchupPrefetched;
	chan.catchupPrefetched = false;
	unpark(client, chan); // a stale step from an earlier JOIN of this connection
	// Until this JOIN's catch-up is through, what the channel holds proves
	// nothing about the gap: a live line now is not the end of the missed ones.
	chan.historyFilled = false;

	if (chan.id === client.activeChannelId) {
		const queued = takePending(client, chan);

		if (!prefetched) {
			fetchFor(client, chan, before ?? queued?.before);
		}

		queueModes(client, chan);
		return;
	}

	if (prefetched) {
		return; // nothing left to ask for: the modes wait for the first open
	}

	const pending: PendingCatchup = {chan, before, prefetched, held};

	if (parkForTargets(client, pending)) {
		return;
	}

	queueStep(client, pending);
}

function queueStep(client: IrcClient, pending: PendingCatchup, history = true): void {
	const key = keyOf(pending.chan);
	const map = pendingMap(client);
	map.set(key, pending);
	client.background.add({
		key,
		cost: CATCHUP_STEP_COST_MS,
		run() {
			map.delete(key);
			step(client, pending, history);
		},
	});
}

/** The user opened `chan`: if it is still waiting, serve it immediately. */
export function prioritiseCatchup(client: IrcClient, chan: Channel): void {
	// A reconnect walk waiting for its next page: the user is waiting now,
	// as long as the clock stays clear of the ceiling (else it is at the
	// front already and goes first).
	if (pageFitsNow(client)) {
		client.background.take(`page:${chan.id}`)?.run();
	}

	const parked = unpark(client, chan);

	if (parked) {
		step(client, parked);
		return;
	}

	const job = client.background.take(keyOf(chan));

	if (job) {
		job.run();
	}
}

/** Forget a channel we left / removed while it was waiting. */
export function dropFromCatchup(client: IrcClient, chan: Channel): void {
	unpark(client, chan);
	takePending(client, chan);
	client.background.take(modeKeyOf(chan));
	client.background.take(`marker:${chan.id}`);
	client.background.take(`page:${chan.id}`);
}

/** Transport closed: nothing queued survives (the reconnect re-JOINs). */
export function cancelCatchup(client: IrcClient): void {
	pendingMap(client).clear();
	client.background.drop((key) => /^(catchup|mode|marker|page|targets):/.test(key));
	clearTimeout(targetsOf.get(client)?.timer);
	targetsOf.delete(client);
}

function takePending(client: IrcClient, chan: Channel): PendingCatchup | undefined {
	const key = keyOf(chan);
	const pending = pendingMap(client).get(key);
	pendingMap(client).delete(key);
	client.background.take(key);
	return pending;
}

/**
 * The modes line is cosmetic (it feeds the "Channel modes: +nt" line): the
 * channel being looked at gets it behind the rest of the catch-up, so it
 * never delays another channel's unread count; others on first open
 * (IrcClient.open).
 */
export function queueModes(client: IrcClient, chan: Channel): void {
	if (chan.modesKnown) {
		return;
	}

	client.background.add({
		key: modeKeyOf(chan),
		cost: MODE_COST_MS,
		run() {
			if (chan.modesKnown || chan.state !== ChanState.JOINED) {
				return;
			}

			chan.modesKnown = true;
			client.send(formatLine({command: "MODE", params: [chan.name]}));
		},
	});
}

function step(client: IrcClient, next: PendingCatchup, history = true): void {
	// Left again while waiting (or the socket went): nothing to send.
	if (next.chan.state !== ChanState.JOINED || client.transport.state !== "open") {
		return;
	}

	if (!next.prefetched) {
		fetchFor(client, next.chan, next.before, history);
	}

	if (next.chan.id === client.activeChannelId) {
		queueModes(client, next.chan);
	}
}

function fetchFor(
	client: IrcClient,
	chan: Channel,
	before: MsgRef | undefined,
	history = true
): void {
	if (history) {
		requestChannelHistory(client, chan, before);
	}

	retryLostHistory(client, chan);

	// Some servers volunteer the marker after JOIN (nefarious2 does for a
	// logged-in account, `*` when none is stored). So the query waits in the
	// background queue — by the time the clock has room, a volunteered
	// marker has arrived and the query is dropped; a server that says
	// nothing is asked. Once per channel, `*` counting as an answer.
	if (!chan.readMarker && !chan.markerAnswered) {
		client.background.add(
			{
				key: `marker:${chan.id}`,
				cost: MARKER_COST_MS,
				run() {
					if (
						!chan.readMarker &&
						!chan.markerAnswered &&
						chan.state === ChanState.JOINED
					) {
						fetchReadMarker(client, chan);
					}
				},
			},
			{front: true}
		);
	}
}

// ------------------------------------------------------------ TARGETS

/**
 * Hold `pending` for the TARGETS answer, asking for it first if this is
 * the connection's first channel to wait. False when the order is not
 * worth asking for (or cannot be): the caller queues the step at once.
 */
function parkForTargets(client: IrcClient, pending: PendingCatchup): boolean {
	let state = targetsOf.get(client);

	if (!state) {
		if (!canAskTargets(client)) {
			targetsOf.set(client, {status: "done", parked: [], late: new Set()});
			return false;
		}

		// Parked before the command is queued: with room on the clock it goes
		// out at once, and it covers what is parked when it does.
		state = {status: "queued", parked: [pending], late: new Set()};
		targetsOf.set(client, state);
		queueTargets(client, state);
		return true;
	}

	if (state.status === "done") {
		return false;
	}

	state.parked.push(pending);
	return true;
}

function canAskTargets(client: IrcClient): boolean {
	if (
		targetsRefused.has(client) ||
		!historyEnabled(client) ||
		// Without `batch` the rows arrive bare, with no end to the answer.
		!client.caps.hasCapability("batch") ||
		client.serverReplay
	) {
		return false;
	}

	const waiting = client.channels.filter(
		(chan) =>
			chan.type === ChanType.CHANNEL &&
			chan.id !== client.activeChannelId &&
			(chan.state === ChanState.JOINED || (chan.state === ChanState.PARTED && chan.autoJoin))
	);
	return waiting.length >= TARGETS_MIN_CHANNELS;
}

function queueTargets(client: IrcClient, state: TargetsState): void {
	client.background.add(
		{
			key: "targets:",
			cost: TARGETS_COST_MS,
			run() {
				if (targetsOf.get(client) !== state || client.transport.state !== "open") {
					return;
				}

				sendTargets(client, state);
			},
		},
		{front: true}
	);
}

function sendTargets(client: IrcClient, state: TargetsState): void {
	if (state.parked.length === 0) {
		state.status = "done";
		return;
	}

	// From the start: the server's index moves on messages only (not joins,
	// parts, topics, redactions), so the newest line we hold can be well past
	// a quiet channel's newest message, and a window starting there would
	// leave it out. Newest first, so a long history costs nothing extra.
	const since = new Date(0);
	const until = new Date(Date.now() + TARGETS_AHEAD_MS);
	const tags: Record<string, string> = {};

	if (client.caps.hasCapability("labeled-response")) {
		state.label = `tg${++targetsLabelCounter}`;
		tags.label = state.label;
	}

	const line = formatLine({
		tags,
		command: "CHATHISTORY",
		params: [
			"TARGETS",
			`timestamp=${since.toISOString()}`,
			`timestamp=${until.toISOString()}`,
			String(historyLimit(client, TARGETS_LIMIT)),
		],
	});

	if (!client.send(line)) {
		release(client, state, undefined);
		return;
	}

	state.status = "asked";
	state.timer = setTimeout(() => release(client, state, undefined), TARGETS_TIMEOUT_MS);
}

/** `IrcClient.joinChannels` sent JOINs for `names`: an answer still to come does not speak for them. */
export function noteJoinsSent(client: IrcClient, names: string[]): void {
	const state = targetsOf.get(client);

	if (state?.status === "asked") {
		names.forEach((name) => state.late.add(client.casefold(name)));
	}
}

function unpark(client: IrcClient, chan: Channel): PendingCatchup | undefined {
	const state = targetsOf.get(client);
	const index = state ? state.parked.findIndex((p) => p.chan === chan) : -1;

	if (!state || index < 0) {
		return undefined;
	}

	return state.parked.splice(index, 1)[0];
}

/**
 * Queue the parked steps: by the answer when there is one, else as they
 * came. Per channel, against what that channel already holds:
 *
 * - listed, newest message later than ours (or we hold none): fetched,
 *   the most recently written channel first;
 * - listed, newest message the one we hold: nothing new, no fetch — if
 *   the answer is complete (`draft/chathistory-end`). Without the tag a
 *   row may be short of the channel's newest: nefarious2 leaves it off a
 *   federated answer a storage server cut short, by its own timeout or its
 *   row limit (`CH E … T`, which can come back at once). That
 *   needs a server at or after nefarious2 a333d81; an older one tags every
 *   federated answer under the limit, cut short or not;
 * - not listed, or its JOIN followed the command: fetched last, as before.
 *   Not listed while we hold its history means its newest message is older
 *   than the window or was never stored where the server looked; strict
 *   presence leaves channels out of a complete answer, and an older
 *   server's answer can say complete when it is not: never a skip.
 *
 * A skipped channel still gets its marker query and any page the last
 * connection lost; only the history fetch is left out.
 */
function release(client: IrcClient, state: TargetsState, answer: TargetsAnswer | undefined): void {
	if (state.status === "done") {
		return;
	}

	clearTimeout(state.timer);
	state.status = "done";
	const parked = state.parked;
	state.parked = [];

	if (!answer) {
		parked.forEach((p) => queueStep(client, p));
		return;
	}

	const trusted = answer.complete;
	const busy: {pending: PendingCatchup; newest: number}[] = [];
	const rest: PendingCatchup[] = [];
	const quiet: PendingCatchup[] = [];

	for (const pending of parked) {
		const newest = answer.rows.get(client.casefold(pending.chan.name));
		const held = pending.held?.time.getTime();

		if (state.late.has(client.casefold(pending.chan.name))) {
			rest.push(pending);
		} else if (newest === undefined) {
			rest.push(pending);
		} else if (held !== undefined && newest <= held) {
			(trusted ? quiet : rest).push(pending);
		} else {
			busy.push({pending, newest});
		}
	}

	// Nothing missed up to now: as good as a completed fill.
	quiet.forEach((p) => (p.chan.historyFilled = true));
	busy.sort((a, b) => b.newest - a.newest);
	busy.forEach(({pending}) => queueStep(client, pending));
	rest.forEach((p) => queueStep(client, p));
	quiet.forEach((p) => queueStep(client, p, false));
}

/** A closed `draft/chathistory-targets` batch: the answer, if it is ours. */
export const targetsBatch: BatchHandler = (client, batch) => {
	const state = targetsOf.get(client);
	const label = batch.tags.get("label") ?? batch.parent?.tags.get("label");

	// Ours carries our label when the server labels; a batch without it
	// answers somebody's `/quote CHATHISTORY TARGETS`, and is theirs.
	if (state?.status !== "asked" || label !== state.label) {
		return;
	}

	const rows = new Map<string, number>();

	for (const msg of batch.messages) {
		if (msg.command !== "CHATHISTORY" || msg.params[0]?.toUpperCase() !== "TARGETS") {
			continue;
		}

		const [, target = "", stamp = ""] = msg.params;
		// Rows carry a bare timestamp; older servers put the request's prefix on it.
		const time = Date.parse(stamp.replace(/^timestamp=/, ""));

		if (target && Number.isFinite(time)) {
			const key = client.casefold(target);
			rows.set(key, Math.max(rows.get(key) ?? 0, time));
		}
	}

	// The tag rides the opener (spec; nefarious2 puts it beside our label).
	release(client, state, {rows, complete: batch.tags.has("draft/chathistory-end")});
};

/**
 * `FAIL CHATHISTORY … TARGETS`: the order is lost, the catch-up goes in
 * JOIN order. A server that does not know the subcommand is not asked
 * again for the page. True when it was ours (it is not shown: nobody typed it).
 */
export function targetsFailed(client: IrcClient, msg: IrcMessage): boolean {
	const state = targetsOf.get(client);
	const label = msg.tags.get("label");
	const [, code = "", context = ""] = msg.params;

	if (state?.status !== "asked") {
		return false;
	}

	if (state.label !== undefined ? label !== state.label : !/^TARGETS\b/i.test(context)) {
		return false;
	}

	if (/^(INVALID_PARAMS|UNKNOWN_COMMAND|NEED_MORE_PARAMS|INVALID_TARGET)$/i.test(code)) {
		targetsRefused.add(client);
	}

	release(client, state, undefined);
	return true;
}
