/**
 * Attention: is a person looking at this client?
 *
 * The server pushes a notification only when nobody is attending the
 * account, and it judges that from each connection's away state and how
 * recently it spoke. "Spoke recently" is the wrong proxy for a phone: say
 * something, switch apps, and the reply goes unpushed for the whole idle
 * window while the frozen tab shows nothing either. The client knows
 * better, and `draft/pre-away` gives it the words: `AWAY *` means "not
 * present for an unspecified reason", per connection, and never overrides
 * a human away message set elsewhere. So a hidden page says `AWAY *`, a
 * page that comes back says `AWAY`, and the server's attention rule (and
 * its away aggregation) does the rest.
 *
 * A page hidden while it connects says `AWAY *` before `CAP END`, right
 * behind the `CAP REQ` that asks for `draft/pre-away` (the server reads the
 * REQ first): free there, where after 001 it costs fake lag. nefarious2
 * keeps it as the connection's own state at registration, fresh or reviving
 * a held session, since d9f806d; an older server loses it on a revive and
 * clears it on the fresh path, so there the phone counts as attended.
 *
 * Two things this must not do: clobber an away the user set with `/away`
 * (that is theirs until `/back`), and mark messages read while nobody is
 * there — `IrcClient.pushMessage` only schedules a MARKREAD for the open
 * channel while attended, and the return of attention marks it then.
 *
 * Vue-free and DOM-free: foreground.ts translates visibility and focus
 * into `setAttended`, tests call it directly.
 */

import type {IrcClient} from "./client";
import {formatLine} from "./message";
import {scheduleMarkRead} from "./handlers/markread";
import {PERSISTENCE_CAP} from "./persistence";

export const PRE_AWAY_CAP = "draft/pre-away";

/** `draft/pre-away`: away for an unspecified reason. */
export const AWAY_STAR = "*";

/**
 * How long a visible-but-unfocused page waits before saying `AWAY *`. A
 * hidden page says it at once (that is the phone case); an alt-tab on a
 * desktop should not flap the state.
 */
export const UNFOCUSED_AWAY_MS = 60_000;

export interface PresenceState {
	/** A person is (probably) looking: page visible and focused. */
	attended: boolean;
	/** `/away` is in force; automatic `AWAY *` keeps its hands off. */
	userAway: boolean;
	/** This client sent `AWAY *` and has not cleared it. */
	starSent: boolean;
	/**
	 * Automatic AWAY commands whose replies (RPL_NOWAWAY / RPL_UNAWAY) are
	 * still to come and should not be shown: switching apps is not news.
	 * Replies arrive in send order, so a count is enough; a user's own
	 * `/away` sent after ours is still acknowledged.
	 */
	quietReplies: number;
	/**
	 * This socket said `AWAY *` before `CAP END`. Whether the server took it
	 * is known at 001: the cap must have ended up enabled.
	 */
	preAwaySent: boolean;
	/**
	 * A socket of ours closed with our `AWAY *` standing. A held session
	 * keeps it: a revive copies the new socket's away only when it declared
	 * one (`bounce_revive`), and a pre-registration bare `AWAY` declares
	 * nothing, so only an `AWAY` after 001 clears it.
	 */
	starLeft: boolean;
}

export function initialPresence(): PresenceState {
	return {
		attended: true,
		userAway: false,
		starSent: false,
		quietReplies: 0,
		preAwaySent: false,
		starLeft: false,
	};
}

function canSend(client: IrcClient): boolean {
	return client.transport.state === "open" && client.isConnected;
}

/**
 * The page's attention changed. Tell the server (`AWAY *` / `AWAY`) unless
 * the user set an away of their own, and when attention returns, mark the
 * open channel read as the user would by looking at it.
 */
export function setAttended(client: IrcClient, attended: boolean): void {
	const p = client.presence;

	if (p.attended === attended) {
		return;
	}

	p.attended = attended;

	if (attended) {
		if (p.starSent) {
			p.starSent = false;

			if (canSend(client)) {
				p.quietReplies++;
				client.send(formatLine({command: "AWAY", params: []}));
			}
		}

		const chan = client.activeChannel();

		if (chan) {
			scheduleMarkRead(client, chan);
		}

		return;
	}

	sendStar(client);
}

/** `AWAY *` now, if the state calls for it and nothing else owns away. */
export function sendStar(client: IrcClient): void {
	const p = client.presence;

	if (p.attended || p.userAway || p.starSent || !canSend(client)) {
		return;
	}

	p.starSent = true;
	p.quietReplies++;
	client.send(formatLine({command: "AWAY", params: [AWAY_STAR]}));
}

/**
 * Called for each RPL_NOWAWAY / RPL_UNAWAY: true when it answers one of our
 * automatic AWAY commands and should stay silent.
 */
export function takeQuietAwayReply(client: IrcClient): boolean {
	const p = client.presence;

	if (p.quietReplies > 0) {
		p.quietReplies--;
		return true;
	}

	return false;
}

/** The user ran `/away` (`away` true) or `/back`. */
export function userAwayChanged(client: IrcClient, away: boolean): void {
	const p = client.presence;
	p.userAway = away;
	// Whatever the user said replaces ours; a later `/back` while hidden
	// stays "present" until the next attention change, as they asked.
	p.starSent = false;
}

/**
 * `CapNegotiator.afterRequest`: a `CAP REQ` naming `draft/pre-away` went
 * out. Before `CAP END` a hidden page says `AWAY *` behind it. A REQ after
 * `CAP END` is a retry after the server refused the whole first one (or a
 * `CAP NEW`): an `AWAY *` sent before it was read without the cap and
 * dropped, so 001 has to say it after all.
 */
export function preRegistrationAway(client: IrcClient, names: string[]): string[] {
	const p = client.presence;

	if (!names.includes(PRE_AWAY_CAP)) {
		return [];
	}

	if (client.caps.done || p.attended || p.userAway) {
		p.preAwaySent = false;
		return [];
	}

	// No quiet reply to count: the server answers a pre-registration AWAY
	// with nothing, and applies it at registration in silence.
	p.preAwaySent = true;
	return [formatLine({command: "AWAY", params: [AWAY_STAR]})];
}

/** The socket closed: what it said is the session's now, if one is held. */
export function presenceClosed(client: IrcClient): void {
	const p = client.presence;
	p.starLeft ||= p.starSent;
	p.starSent = false;
	p.preAwaySent = false;
	// Replies to a dead socket never come.
	p.quietReplies = 0;
}

/**
 * Registration done. A page hidden while it connects says so, unless it
 * already did before `CAP END` and the cap took. A page that is attended
 * says `AWAY` if this socket starred the connection before it came back, or
 * a lost socket may have left a held session starred (a server that offers
 * `draft/persistence`; on any other a fresh connection has no away to clear).
 * The user's own `/away` is theirs either way.
 */
export function presenceRegistered(client: IrcClient): void {
	const p = client.presence;
	const held = p.preAwaySent && client.caps.enabled.has(PRE_AWAY_CAP);
	const left = p.starLeft && client.caps.available.has(PERSISTENCE_CAP);
	p.preAwaySent = false;
	p.starLeft = false;
	p.starSent = false;

	if (p.attended && !p.userAway && (held || left)) {
		p.quietReplies++;
		client.send(formatLine({command: "AWAY", params: []}));
		return;
	}

	// Said again after 001 even when the pre-registration one took: a
	// server before nefarious2 d9f806d offers the cap but loses it on a
	// held session's revive, and nothing tells the two apart. Take this
	// out once the networks we serve run d9f806d or later.
	sendStar(client);
}
