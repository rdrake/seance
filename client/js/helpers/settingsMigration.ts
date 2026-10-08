// Settings that arrive switched on can override a choice the user already
// made. Each one here is paired with the setting it stands in for:
// matchSystemTextSize replaces the font-size step, matchSystemAppearance the
// picked theme's light/dark half.
const OVERRIDES: Record<string, string> = {
	matchSystemTextSize: "fontSize",
	matchSystemAppearance: "theme",
};

/**
 * Starts a new on-by-default setting switched off for a user whose stored
 * settings predate it and who already chose what it would override.
 *
 * `update()` stores the whole settings object on every change, so a stored
 * object without the new key was saved before the setting existed, and a
 * stored `fontSize` or `theme` that differs from its default is one the user
 * picked. The default theme is the deploy's (config.json `theme`), not the
 * build's: boot.ts stores the branded default before the user picks anything,
 * so the caller (store-settings.ts `migrate`, run by boot.ts once branding
 * has loaded) passes it in `defaults`. A fresh install (nothing stored) and a
 * user who never touched the overridden setting get the new default. Returns
 * the stored object with the keys it turned off added.
 */
export function migrateStoredSettings(
	stored: unknown,
	defaults: Record<string, unknown>
): Record<string, unknown> {
	// A damaged entry (a number, a string, a list) holds no settings.
	if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
		return {};
	}

	const migrated: Record<string, unknown> = {...stored};

	for (const [setting, overridden] of Object.entries(OVERRIDES)) {
		if (setting in stored || defaults[setting] !== true) {
			continue;
		}

		if (overridden in stored && migrated[overridden] !== defaults[overridden]) {
			migrated[setting] = false;
		}
	}

	return migrated;
}
