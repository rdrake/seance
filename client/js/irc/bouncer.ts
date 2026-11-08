/**
 * A bouncer's networks (`soju.im/bouncer-networks`,
 * https://codeberg.org/emersion/soju/src/branch/master/doc/ext/bouncer-networks.md).
 *
 * A soju login without a network (`alice`, not `alice/libera`) is the
 * bouncer's control connection: it has no channels (`CHANTYPES=` empty, and a
 * JOIN is answered `400 … bouncer connection`). There Seance asks for the
 * account's networks (`BOUNCER LISTNETWORKS`) and hands them to the manager
 * (`IrcClientOptions.onBouncerNetworks`), which adds each new one as a network
 * of its own: the same server and login, bound to it with `BOUNCER BIND <id>`
 * before `CAP END` (client.ts `finalLines`). That is how gamja and senpai work
 * too: one connection per bound network. With `-notify`, networks added on
 * the bouncer later (from another client) arrive as single `BOUNCER NETWORK`
 * lines and are added the same way.
 *
 * Kept free of store and DOM imports: it runs under mocha.
 */

import {t} from "../i18n/core";
import type {IrcClient} from "./client";
import type {BatchHandler} from "./handlers/batch";
import {parseTags, type IrcMessage} from "./message";

export const BOUNCER_NETWORKS_CAP = "soju.im/bouncer-networks";
export const BOUNCER_NETWORKS_BATCH = "soju.im/bouncer-networks";

/** One of a bouncer's networks, as `BOUNCER NETWORK <id> <attributes>` gives it. */
export interface BouncerNetwork {
	id: string;
	/** The `name` attribute, else the `host`, else the id. */
	name: string;
	host?: string;
	/** `connected`, `connecting` or `disconnected`, when the bouncer says. */
	state?: string;
	/** The attributes were `*`: the network was removed from the bouncer. */
	removed?: boolean;
}

/** The bouncer's control connection: it offers the networks and is bound to none. */
export function isBouncerControl(client: IrcClient): boolean {
	return (
		client.caps.hasCapability(BOUNCER_NETWORKS_CAP) &&
		!client.isupport.tokens.has("BOUNCER_NETID")
	);
}

/** `BOUNCER BIND <id>`, for the registration flush, when this connection is bound to one. */
export function bindLine(client: IrcClient): string | undefined {
	const id = client.options.bouncerNetId;
	return id && client.caps.available.has(BOUNCER_NETWORKS_CAP) ? `BOUNCER BIND ${id}` : undefined;
}

/** Ask the control connection for the account's networks (after 001). */
export function listNetworks(client: IrcClient): void {
	if (!isBouncerControl(client)) {
		return;
	}

	client.background.add({
		key: "bouncer:listnetworks",
		cost: client.fakeLag.cost("BOUNCER LISTNETWORKS"),
		run: () => void client.send("BOUNCER LISTNETWORKS"),
	});
}

/** `BOUNCER NETWORK <id> <attributes>`; undefined for any other `BOUNCER` line. */
export function parseNetwork(msg: IrcMessage): BouncerNetwork | undefined {
	const [sub, id, attrs] = msg.params;

	if (sub?.toUpperCase() !== "NETWORK" || !id || attrs === undefined) {
		return undefined;
	}

	if (attrs === "*") {
		return {id, name: id, removed: true};
	}

	const tags = parseTags(attrs);
	const host = tags.get("host") || undefined;
	return {id, name: tags.get("name") || host || id, host, state: tags.get("state") || undefined};
}

/** Give the manager what the bouncer listed, and say in the lobby what was added. */
function offer(client: IrcClient, networks: BouncerNetwork[]): void {
	const added = client.options.onBouncerNetworks?.(networks) ?? [];

	if (added.length > 0) {
		client.pushMessage(
			client.lobby,
			{text: t("bouncer.networksAdded", {names: added.join(", ")})},
			true
		);
	}
}

/** The answer to `BOUNCER LISTNETWORKS`: every network of the account. */
export const bouncerNetworksBatch: BatchHandler = (client, batch) => {
	// A bound connection hears the list too (`-notify`); only the control one adds.
	if (!isBouncerControl(client)) {
		return;
	}

	const networks: BouncerNetwork[] = [];

	for (const line of batch.messages) {
		const net = line.command === "BOUNCER" ? parseNetwork(line) : undefined;

		if (net) {
			networks.push(net);
		} else {
			client.handleMessage(line);
		}
	}

	offer(client, networks);
};

/** A single `BOUNCER NETWORK` (`-notify`: a network added or changed elsewhere). */
export function bouncerLine(client: IrcClient, msg: IrcMessage): void {
	const net = parseNetwork(msg);

	if (net && isBouncerControl(client)) {
		offer(client, [net]);
	}
}
