// In the native shells an on/off setting is a switch, not a checkbox — every
// settings screen on iOS and Android looks that way. Still an
// <input type="checkbox"> to the page — checked, change events, labels and
// forms all as before — so every checkbox is marked, those Vue renders later
// included:
//
// - iOS: WebKit draws a checkbox carrying the `switch` attribute (iOS 17.4+)
//   as the native control and VoiceOver calls it a switch. Older iOS ignores
//   it and keeps the checkbox.
// - Android: Chromium has no such control, so style.css draws a Material
//   switch (html[data-platform="android"]), and `role="switch"` makes
//   TalkBack say "switch, on" rather than "checkbox, checked".

import {isAndroidShell, isIOSShell} from "./capacitor";

const SELECTOR = 'input[type="checkbox"]';

function markOne(box: Element, android: boolean): void {
	if (android) {
		box.setAttribute("role", "switch");
	} else {
		box.setAttribute("switch", "");
	}
}

let watching = false;

export function useNativeSwitches(): void {
	const ios = isIOSShell();
	const android = isAndroidShell();

	if (watching || (!ios && !android)) {
		return;
	}

	watching = true;

	const mark = (root: ParentNode) => {
		for (const box of root.querySelectorAll(SELECTOR)) {
			markOne(box, android);
		}
	};

	mark(document);

	new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (node instanceof HTMLInputElement && node.type === "checkbox") {
					markOne(node, android);
				} else if (node instanceof Element) {
					mark(node);
				}
			}
		}
	}).observe(document.body, {childList: true, subtree: true});
}
