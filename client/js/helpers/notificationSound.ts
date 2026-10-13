// The notification ping, when the page plays it (alertSound below decides).
// On iOS a page's <audio> takes the audio session as
// media playback, which stops whatever else is playing (Music, a podcast) and
// never hands it back. The Audio Session API (Safari/WKWebView 16.4+) lets the
// page say its sound is ambient: it mixes with the other app's audio, which
// keeps playing, and the silent switch mutes it like any other alert sound.
// Only for the ping: the session type is page-wide, and a video preview the
// user starts is playback, so the type goes back once the ping is over.

type AudioSessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient";

type NavigatorWithAudioSession = Navigator & {audioSession?: {type: AudioSessionType}};

let pop: HTMLAudioElement | undefined;
let restoreType: AudioSessionType | undefined;

function restoreSession() {
	const session = (navigator as NavigatorWithAudioSession).audioSession;

	if (session && restoreType !== undefined) {
		session.type = restoreType;
	}

	restoreType = undefined;
}

function audio(): HTMLAudioElement {
	if (!pop) {
		pop = new Audio("audio/pop.wav");
		pop.addEventListener("ended", restoreSession);
		pop.addEventListener("error", restoreSession);
	}

	return pop;
}

export function playNotificationSound(): Promise<void> {
	try {
		const session = (navigator as NavigatorWithAudioSession).audioSession;

		if (session && restoreType === undefined) {
			restoreType = session.type;
			session.type = "ambient";
		}

		const el = audio();
		el.currentTime = 0;
		return Promise.resolve(el.play()).catch((e) => {
			restoreSession();
			throw e;
		});
	} catch (e) {
		restoreSession();
		return Promise.reject(e);
	}
}

export interface AlertSoundCase {
	/** The setting: play a sound with an alert. */
	soundOn: boolean;
	/** A native shell: the OS shows the alert and plays its sound. */
	native: boolean;
	/** The page will show a system notification for this alert. */
	notifying: boolean;
	/** An iPhone or iPad (WebKit with an audio session, touch-first). */
	ios: boolean;
	/** The page is on screen. */
	visible: boolean;
}

/**
 * Who plays an alert's sound. A system notification carries its own: the
 * OS plays it as an alert sound (on a Mac through the "Play sound effects
 * through" device), where a page's <audio> is media playback that takes
 * the output — AirPods hop over to the Mac for every ping — and on iOS
 * stops Music. So the page plays the ping only when there is no
 * notification to carry it, or on iOS while the web app is on screen,
 * whose notifications iOS may not present in front (then it posts the
 * notification silently, so the sound is never doubled).
 */
export function alertSound(c: AlertSoundCase): {inPage: boolean; silentNotification: boolean} {
	if (!c.soundOn) {
		return {inPage: false, silentNotification: true};
	}

	if (c.native) {
		return {inPage: false, silentNotification: false};
	}

	if (!c.notifying) {
		return {inPage: true, silentNotification: true};
	}

	if (c.ios && c.visible) {
		return {inPage: true, silentNotification: true};
	}

	return {inPage: false, silentNotification: false};
}
