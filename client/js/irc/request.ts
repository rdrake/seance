/**
 * Ask the server something and get the whole answer back as one unit, by
 * `labeled-response` label: `client.request("STATS g")` resolves with every
 * line of the reply, in order, once it is complete. This is the exact
 * correlation docs/projects/reply-routing.md parked under _Future_; the oper
 * tools (docs/projects/oper-tools.md) are its first users.
 *
 * nefarious2 answers a labeled request in one of three shapes:
 *
 * - **a batch**: STATS, CHECK, TRACE, MAP, LINKS, WHO, WHOIS, INFO, … open
 *   `BATCH +x labeled-response` (the label on the opener) around the reply,
 *   also for a command it forwards to another server. Delivered when the
 *   batch closes.
 * - **labeled lines**: a single numeric (008, 284, an error), or a list the
 *   server does not batch (GLINE's 280… 281). With `end` numerics given,
 *   lines collect until one of them; without, the first line answers.
 * - **`ACK`**: the command produced nothing it would label (KILL, a GLINE
 *   that worked). Also how a reply sent *without* the label ends — see below.
 *
 * A command the server forwards without the label (a remote CHECK) is
 * answered locally by a bare `ACK` and later by unlabeled lines; a request
 * that names their numerics in `unlabeled` waits past the ACK for them.
 *
 * Two server bugs are tolerated here, because the client has to work with the
 * server as it is (evilnet/nefarious2#119, #120):
 *
 * - NOTICEs sent inside a labeled batch carry no `@batch` tag (the STATS help
 *   list, `STATS w`, VERSION's library lines). A server NOTICE addressed to us
 *   while one of our labeled batches is open is taken into it.
 * - USERHOST 302, USERIP 340, ISON 303 and PRIVS 270 go out with no tags at
 *   all, followed by the `ACK` that says "nothing". A request that names them
 *   in `untagged` collects such a line while it waits, and the ACK resolves
 *   with it.
 *
 * Kept free of store and DOM imports (mocha). A server without
 * `labeled-response` cannot be asked this way: {@link canRequest} says so and
 * callers send the command plainly instead.
 */

import type {IrcClient} from "./client";
import {isErrorNumeric} from "./errors";
import {openBatchesOf, type BatchHandler, type OpenBatch} from "./handlers/batch";
import {MAX_LINE_BYTES, utf8ByteLength, type IrcMessage} from "./message";
import {takeQuietLabel} from "./quiet";
import {NOTICE_PREFIX} from "./snotice";
import {tagPrefix} from "./wire";

export const LABELED_RESPONSE_CAP = "labeled-response";

/** How long a request waits for the end of its answer. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How an answer ended. `toolong`: the line, with its label, is over
 * `MAX_LINE_BYTES` and was never sent — the connection is fine, the line is
 * not (a long reason in a non-Latin script, a pasted mask).
 */
export type ReplyOutcome = "batch" | "lines" | "ack" | "timeout" | "closed" | "toolong";

/** The outcomes that mean no answer came: nothing sent, the socket gone, or silence. */
export type FailedOutcome = "timeout" | "closed" | "toolong";

export function isFailedOutcome(outcome: ReplyOutcome): outcome is FailedOutcome {
	return outcome === "timeout" || outcome === "closed" || outcome === "toolong";
}

export interface ReplyUnit {
	/** Every line of the answer, in arrival order (a batch's contents, unwrapped). */
	lines: IrcMessage[];
	outcome: ReplyOutcome;
}

export interface RequestOptions {
	/** Numerics that end an unbatched multi-line answer (GLINE's 281, 521). */
	end?: string[];
	/** Numerics the server sends without the label (#120): 270, 302, 303, 340. */
	untagged?: string[];
	/**
	 * A command the server forwards without keeping the label (a remote
	 * CHECK: not in `forwarded_label.c`'s table). The local `ACK` then says
	 * nothing about the answer: the request keeps waiting, collects untagged
	 * server lines with these numerics, and ends on one of `end`.
	 */
	unlabeled?: string[];
	timeoutMs?: number;
}

interface PendingRequest {
	label: string;
	line: string;
	opts: RequestOptions;
	lines: IrcMessage[];
	resolve: (unit: ReplyUnit) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface Registry {
	next: number;
	pending: PendingRequest[];
	/**
	 * The last unlabeled request's answer: an unlabeled answer carries
	 * nothing to tell two apart, so they go out one at a time.
	 */
	unlabeledTail: Promise<unknown>;
	/** Unlabeled requests sent or waiting to be. */
	unlabeledOpen: number;
}

const registries = new WeakMap<IrcClient, Registry>();

function registryOf(client: IrcClient): Registry {
	let registry = registries.get(client);

	if (!registry) {
		registry = {next: 0, pending: [], unlabeledTail: Promise.resolve(), unlabeledOpen: 0};
		registries.set(client, registry);
	}

	return registry;
}

/** Whether `client` can be asked with {@link request} right now. */
export function canRequest(client: IrcClient): boolean {
	return client.caps.hasCapability(LABELED_RESPONSE_CAP) && client.isWelcomed;
}

/**
 * Send `line` labeled and resolve with its whole answer. Never rejects: a
 * line over `MAX_LINE_BYTES` with its label resolves at once with outcome
 * `toolong` (nothing sent, nothing in the lobby), one that cannot be sent
 * for any other reason with `closed`, a socket
 * that dies first with what had arrived, a server that never finishes with
 * `timeout`.
 */
export function request(
	client: IrcClient,
	line: string,
	opts: RequestOptions = {}
): Promise<ReplyUnit> {
	if (!opts.unlabeled) {
		return send(client, line, opts);
	}

	const registry = registryOf(client);
	const answer =
		registry.unlabeledOpen > 0
			? registry.unlabeledTail.then(() => send(client, line, opts))
			: send(client, line, opts);
	registry.unlabeledOpen++;
	registry.unlabeledTail = answer.finally(() => registry.unlabeledOpen--);
	return answer;
}

function send(client: IrcClient, line: string, opts: RequestOptions): Promise<ReplyUnit> {
	const registry = registryOf(client);
	const label = `r${++registry.next}`;

	return new Promise((resolve) => {
		if (!canRequest(client)) {
			resolve({lines: [], outcome: "closed"});
			return;
		}

		if (utf8ByteLength(`${tagPrefix({label})}${line}`) > MAX_LINE_BYTES) {
			resolve({lines: [], outcome: "toolong"});
			return;
		}

		const entry: PendingRequest = {
			label,
			line,
			opts,
			lines: [],
			resolve,
			timer: setTimeout(
				() => finish(client, entry, "timeout"),
				opts.timeoutMs ?? REQUEST_TIMEOUT_MS
			),
		};

		registry.pending.push(entry);

		if (!client.send(`${tagPrefix({label})}${line}`)) {
			finish(client, entry, "closed");
		}
	});
}

function finish(client: IrcClient, entry: PendingRequest, outcome: ReplyOutcome): void {
	const registry = registryOf(client);
	const index = registry.pending.indexOf(entry);

	if (index === -1) {
		return; // already answered
	}

	registry.pending.splice(index, 1);
	clearTimeout(entry.timer);
	entry.resolve({lines: entry.lines, outcome});
}

function byLabel(client: IrcClient, label: string | undefined): PendingRequest | undefined {
	return label ? registryOf(client).pending.find((e) => e.label === label) : undefined;
}

/** An error numeric or a standard-reply FAIL: always the end of an answer. */
function isError(msg: IrcMessage): boolean {
	return isErrorNumeric(msg.command) || msg.command === "FAIL";
}

/**
 * An unlabeled error naming a forwarded request's command: the far server
 * refused it (517 disabled, 461, no privilege there), and nothing else
 * would end the wait.
 */
function refusesCommand(entry: PendingRequest, msg: IrcMessage): boolean {
	if (!entry.opts.unlabeled || !isError(msg)) {
		return false;
	}

	const command = entry.line.split(" ")[0].toUpperCase();
	return msg.params.some((param) => param.toUpperCase() === command);
}

/** Our open labeled batch, if one is open (the newest). */
function openLabeledBatch(client: IrcClient): OpenBatch | undefined {
	let found: OpenBatch | undefined;

	for (const batch of openBatchesOf(client).values()) {
		if (
			batch.type.toLowerCase() === "labeled-response" &&
			byLabel(client, batch.tags.get("label"))
		) {
			found = batch;
		}
	}

	return found;
}

/**
 * Called by `IrcClient.handleMessage` for every line after batch buffering:
 * takes the lines that answer one of our requests. Returns whether the line
 * was taken (the normal handlers then never see it).
 */
export function interceptRequestLine(client: IrcClient, msg: IrcMessage): boolean {
	const registry = registries.get(client);

	if (!registry || registry.pending.length === 0 || msg.command === "BATCH") {
		return false;
	}

	const entry = byLabel(client, msg.tags.get("label"));

	if (entry) {
		if (msg.command === "ACK") {
			// A forwarded command's answer is still on its way, unlabeled.
			if (!entry.opts.unlabeled) {
				finish(client, entry, "ack");
			}

			return true;
		}

		entry.lines.push(msg);
		const end = entry.opts.end;

		if (!end || end.includes(msg.command) || isError(msg)) {
			finish(client, entry, "lines");
		}

		return true;
	}

	if (msg.tags.has("label") || msg.tags.has("batch")) {
		return false;
	}

	const fromServer = msg.source !== undefined && msg.source.user === undefined;

	// #119: a server NOTICE to us inside our open labeled batch belongs to it.
	// A real server notice (`*** Notice -- `, the +W "did a /whois on you")
	// is never part of a reply: it goes on to be routed.
	if (
		msg.command === "NOTICE" &&
		fromServer &&
		client.isSelf(msg.params[0] ?? "") &&
		!(msg.params[msg.params.length - 1] ?? "").startsWith(NOTICE_PREFIX)
	) {
		const batch = openLabeledBatch(client);

		if (batch) {
			batch.messages.push(msg);
			return true;
		}
	}

	// A forwarded command's answer, unlabeled, up to its end numeric.
	if (fromServer) {
		const forwarded = registry.pending.find(
			(e) => e.opts.unlabeled?.includes(msg.command) || refusesCommand(e, msg)
		);

		if (forwarded) {
			forwarded.lines.push(msg);

			if (forwarded.opts.end?.includes(msg.command) || isError(msg)) {
				finish(client, forwarded, "lines");
			}

			return true;
		}
	}

	// #120: the untagged reply a waiting request named; its ACK follows.
	if (fromServer) {
		const waiting = registry.pending.find((e) => e.opts.untagged?.includes(msg.command));

		if (waiting) {
			waiting.lines.push(msg);
			return true;
		}
	}

	return false;
}

/**
 * A closed `labeled-response` batch: ours resolves its request, anyone
 * else's (a labeled history request, a labeled message's echo) is unwrapped
 * into the normal handlers, as an unregistered batch type would be.
 */
export const labeledBatch: BatchHandler = (client, batch) => {
	const entry = byLabel(client, batch.tags.get("label"));

	if (entry) {
		entry.lines.push(...batch.messages);
		finish(client, entry, "batch");
		return;
	}

	// The echo of a quiet line (quiet.ts) wrapped in a batch: dropped whole.
	if (takeQuietLabel(client, batch.tags.get("label"))) {
		return;
	}

	for (const msg of batch.messages) {
		client.handleMessage(msg);
	}
};

/** The socket closed: every waiting request resolves with what it has. */
export function resetRequests(client: IrcClient): void {
	const registry = registries.get(client);

	if (!registry) {
		return;
	}

	for (const entry of [...registry.pending]) {
		finish(client, entry, "closed");
	}
}
