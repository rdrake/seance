// The iOS shell's notifications: the LocalNotifications plugin
// (@capacitor/local-notifications), because WKWebView has neither the
// Notification API nor a service worker to show one. iOS then owns the
// alert: the banner, the sound mixed over whatever else is playing (an
// <audio> ping in the page stopped Music and never gave it back), the silent
// switch, Focus, and the app's own switches in Settings → Notifications.
// The plugin presents them while the app is in front too.
//
// Only the bridge is touched (helpers/capacitor.ts imports nothing), so a
// browser or the Android shell gets false and no-ops from everything here.

import {isIOSShell, nativeCall, nativeListen} from "./capacitor";

type Display = "granted" | "denied" | "prompt" | "prompt-with-rationale";

interface Permission {
	display?: Display;
}

/** The ping, from the app bundle's copy of the web build. */
const SOUND = "public/audio/pop.wav";

let granted: boolean | null = null;

export function nativeAlertsAvailable(): boolean {
	return isIOSShell();
}

/**
 * Ask for the notification permission while it is undecided: banners, sound
 * and the badge, in the one prompt iOS ever shows (a later request for more
 * options asks nothing). Granted, denied, or null when the sheet was
 * dismissed unanswered and the next call asks again.
 */
export async function askNativeAlertPermission(): Promise<boolean | null> {
	if (!nativeAlertsAvailable()) {
		return null;
	}

	let display = (await nativeCall<Permission>("LocalNotifications", "checkPermissions"))?.display;

	if (display === "prompt" || display === "prompt-with-rationale") {
		display = (await nativeCall<Permission>("LocalNotifications", "requestPermissions"))
			?.display;
	}

	granted = display === "granted" ? true : display === "denied" ? false : null;
	return granted;
}

export interface NativeAlert {
	/** Replaces the conversation's previous alert, as a web notification's tag does. */
	targetId: number;
	title: string;
	body: string;
	sound: boolean;
}

export function showNativeAlert(alert: NativeAlert): void {
	void (async () => {
		if (granted !== true && (await askNativeAlertPermission()) !== true) {
			return;
		}

		await nativeCall("LocalNotifications", "schedule", {
			notifications: [
				{
					id: alert.targetId,
					title: alert.title,
					body: alert.body,
					...(alert.sound ? {sound: SOUND} : {}),
					extra: {targetId: alert.targetId},
				},
			],
		});
	})();
}

/** A tapped alert: the conversation it was about. */
export function onNativeAlertTap(handler: (targetId: number) => void): void {
	if (!nativeAlertsAvailable()) {
		return;
	}

	nativeListen(
		"LocalNotifications",
		"localNotificationActionPerformed",
		(data: {notification?: {extra?: {targetId?: unknown}}}) => {
			const targetId = data?.notification?.extra?.targetId;

			if (typeof targetId === "number") {
				handler(targetId);
			}
		}
	);
}
