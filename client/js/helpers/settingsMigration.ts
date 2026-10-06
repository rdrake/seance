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
 * picked. A fresh install (nothing stored) and a user who never touched the
 * overridden setting get the new default. Nothing is written here: the key is
 * stored with the next change, and until then every load reaches the same
 * answer from the same stored object.
 */
export function migrateStoredSettings(
	stored: Record<string, unknown>,
	defaults: Record<string, unknown>
): Record<string, unknown> {
	const migrated = {...stored};

	for (const [setting, overridden] of Object.entries(OVERRIDES)) {
		if (setting in stored || defaults[setting] !== true) {
			continue;
		}

		if (overridden in stored && stored[overridden] !== defaults[overridden]) {
			migrated[setting] = false;
		}
	}

	return migrated;
}
