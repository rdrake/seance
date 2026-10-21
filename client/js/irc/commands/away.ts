/**
 * `/away [reason]` and `/back`. An `/away` without a reason still sets away
 * (with a single space, as the old server did). The text is remembered per
 * network across reloads (userAwayStore.ts) and declared again at every
 * registration (presence.ts `registrationAwayLine`).
 */

import {sendBack, userAwayChanged} from "../presence";
import {trailingLine} from "../wire";
import type {Command} from "../types";

const away: Command = {
	commands: ["away", "back"],
	input({client, cmd, args}) {
		if (cmd === "away") {
			const text = args.join(" ") || " ";
			userAwayChanged(client, true, text);
			client.send(trailingLine("AWAY", [text]));
			return;
		}

		userAwayChanged(client, false, null);
		sendBack(client);
	},
};

export default away;
