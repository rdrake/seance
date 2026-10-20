/**
 * Paced per-channel catch-up after our JOIN: the history fetch
 * (`CHATHISTORY`) and the read-marker fetch (`MARKREAD`) for each channel.
 *
 * Why paced: ircu-family servers (nefarious2 included) charge every command
 * from a non-oper about 2 s of "fake lag" and stop reading the socket once
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
 */

import {ChanState} from "../../../shared/types/chan";
import type {Channel, MsgRef} from "./channel";
import type {IrcClient} from "./client";
import {fetchReadMarker} from "./handlers/markread";
import {requestChannelHistory, retryLostHistory} from "./history";
import {formatLine} from "./message";

/** What one channel's step is reckoned to cost: its history fetch (the marker query is a job of its own). */
export const CATCHUP_STEP_COST_MS = 2000;

/** A mode query is one command. */
const MODE_COST_MS = 2000;

/** So is a marker query. */
const MARKER_COST_MS = 2000;

interface PendingCatchup {
	chan: Channel;
	/** The channel's newest known message before this JOIN (reconnect catch-up). */
	before: MsgRef | undefined;
	/** History + marker already went out with the JOIN; only the modes are left. */
	prefetched: boolean;
}

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
	return client.background
		.keys()
		.map((key) => map.get(key)?.chan)
		.filter((chan): chan is Channel => chan !== undefined);
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
export function enqueueCatchup(client: IrcClient, chan: Channel, before: MsgRef | undefined): void {
	const prefetched = chan.catchupPrefetched;
	chan.catchupPrefetched = false;

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

	const key = keyOf(chan);
	const map = pendingMap(client);
	const pending: PendingCatchup = {chan, before, prefetched};
	map.set(key, pending);
	client.background.add({
		key,
		cost: CATCHUP_STEP_COST_MS,
		run() {
			map.delete(key);
			step(client, pending);
		},
	});
}

/** The user opened `chan`: if it is still waiting, serve it immediately. */
export function prioritiseCatchup(client: IrcClient, chan: Channel): void {
	const job = client.background.take(keyOf(chan));

	if (job) {
		job.run();
	}
}

/** Forget a channel we left / removed while it was waiting. */
export function dropFromCatchup(client: IrcClient, chan: Channel): void {
	takePending(client, chan);
	client.background.take(modeKeyOf(chan));
	client.background.take(`marker:${chan.id}`);
	client.background.take(`page:${chan.id}`);
}

/** Transport closed: nothing queued survives (the reconnect re-JOINs). */
export function cancelCatchup(client: IrcClient): void {
	pendingMap(client).clear();
	client.background.drop((key) => /^(catchup|mode|marker|page):/.test(key));
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

function step(client: IrcClient, next: PendingCatchup): void {
	// Left again while waiting (or the socket went): nothing to send.
	if (next.chan.state !== ChanState.JOINED || client.transport.state !== "open") {
		return;
	}

	if (!next.prefetched) {
		fetchFor(client, next.chan, next.before);
	}

	if (next.chan.id === client.activeChannelId) {
		queueModes(client, next.chan);
	}
}

function fetchFor(client: IrcClient, chan: Channel, before: MsgRef | undefined): void {
	requestChannelHistory(client, chan, before);
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
