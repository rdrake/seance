// The native shells' message alerts. Neither WebView has the Notification
// API, so the page's alert (socket-events/msg.ts) is handed to the OS, which
// then owns it: the banner, the sound mixed over whatever else is playing
// (an <audio> ping in the page took the audio and stopped Music), the
// silent switch or Do Not Disturb, Focus, and the app's own notification
// switches in the system settings.
//
// - iOS: the LocalNotifications plugin (@capacitor/local-notifications),
//   which presents them while the app is in front too.
// - Android: the shell's push service (NativePush `show`), so the page's
//   alert is the very notification a push for that message would be — the
//   Messages channel, merged per conversation, cleared on read (webpush.ts
//   readOnWorker), its tap handled by helpers/nativePush.ts — as the web's
//   goes through the network's push worker.
//
// Only the bridge and the line formatter are touched (no store, no Vue), so
// a browser gets false and no-ops from everything here.

import {formatLine} from "../irc/message";
import {isAndroidShell, isIOSShell, nativeCall, nativeListen} from "./capacitor";

type Display = "granted" | "denied" | "prompt" | "prompt-with-rationale";

/** The ping, from the app bundle's copy of the web build. */
const IOS_SOUND = "public/audio/pop.wav";

let granted: boolean | null = null;

export function nativeAlertsAvailable(): boolean {
	return isIOSShell() || isAndroidShell();
}

/**
 * Ask for the notification permission while it is undecided. On iOS that
 * is banners, sound and the badge in the one prompt iOS ever shows (a
 * later request for more options asks nothing). Granted, denied, or null
 * when nothing was decided and the next call asks again.
 */
export async function askNativeAlertPermission(): Promise<boolean | null> {
	let answer: string | undefined;

	if (isIOSShell()) {
		answer = (await nativeCall<{display?: Display}>("LocalNotifications", "checkPermissions"))
			?.display;

		if (answer === "prompt" || answer === "prompt-with-rationale") {
			answer = (
				await nativeCall<{display?: Display}>("LocalNotifications", "requestPermissions")
			)?.display;
		}
	} else if (isAndroidShell()) {
		answer = (await nativeCall<{permission?: string}>("NativePush", "askPermission"))
			?.permission;
	} else {
		return null;
	}

	granted = answer === "granted" ? true : answer === "denied" ? false : null;
	return granted;
}

export interface NativeAlert {
	/** The network's uuid. */
	network: string;
	/** The conversation: a channel's name, or the other side of a query. */
	target: string;
	title: string;
	body: string;
	sound: boolean;
	/** The message in a push's terms, for Android's push service. */
	message: {
		from: string;
		/** Wire text: IRC formatting kept, an action as CTCP ACTION. */
		text: string;
		/** Where the message was sent: the channel, or our own nick. */
		to: string;
		msgid?: string;
		/** ISO 8601. */
		time?: string;
		notice: boolean;
	};
}

/** The id iOS keeps an alert under: one per conversation, the same across
 * reloads (the page's channel ids are not), so a new alert replaces the
 * conversation's last and reading it clears it. */
function iosId(network: string, target: string): number {
	const key = `${network}\n${target.toLowerCase()}`;
	let hash = 0x811c9dc5;

	for (let i = 0; i < key.length; i++) {
		hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
	}

	// A positive 32-bit int: Android's plugin would refuse anything wider.
	return hash >>> 1 || 1;
}

export function showNativeAlert(alert: NativeAlert): void {
	void (async () => {
		if (granted !== true && (await askNativeAlertPermission()) !== true) {
			return;
		}

		if (isAndroidShell()) {
			const m = alert.message;
			const tags: Record<string, string> = {};

			if (m.msgid) {
				tags.msgid = m.msgid;
			}

			if (m.time) {
				tags.time = m.time;
			}

			await nativeCall("NativePush", "show", {
				network: alert.network,
				line: formatLine({
					tags,
					source: {name: m.from},
					command: m.notice ? "NOTICE" : "PRIVMSG",
					params: [m.to, m.text],
				}),
				silent: !alert.sound,
			});
			return;
		}

		await nativeCall("LocalNotifications", "schedule", {
			notifications: [
				{
					id: iosId(alert.network, alert.target),
					title: alert.title,
					body: alert.body,
					...(alert.sound ? {sound: IOS_SOUND} : {}),
					extra: {network: alert.network, target: alert.target},
				},
			],
		});
	})().catch(() => undefined);
}

/** The conversation was read: its iOS alert goes. (Android's are the push
 * service's, cleared by webpush.ts with its pushes.) */
export function clearNativeAlert(network: string, target: string): void {
	if (!isIOSShell()) {
		return;
	}

	void nativeCall("LocalNotifications", "removeDeliveredNotifications", {
		notifications: [{id: iosId(network, target)}],
	});
}

/** A tapped iOS alert: the conversation it was about. (Android's taps come
 * through helpers/nativePush.ts with its pushes'.) */
export function onNativeAlertTap(handler: (network: string, target: string) => void): void {
	if (!isIOSShell()) {
		return;
	}

	nativeListen(
		"LocalNotifications",
		"localNotificationActionPerformed",
		(data: {notification?: {extra?: {network?: unknown; target?: unknown}}}) => {
			const extra = data?.notification?.extra;

			if (typeof extra?.network === "string" && typeof extra.target === "string") {
				handler(extra.network, extra.target);
			}
		}
	);
}
