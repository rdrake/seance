/**
 * Switches that ask the server for something and show the answer, not the
 * tap. The Me tab's user modes use it (`Oper/OperMe.vue`): a tap sends
 * `/umode ±X` and the switch shows the asked-for state until the server's
 * MODE line makes the real mode match it, or until `timeoutMs` passes with
 * no such line — a refusal, which nefarious2 often answers with silence —
 * and then shows the real mode again. Without it a refused mode stayed on:
 * the box is one-way bound, the model never changed, so Vue never wrote
 * `checked` back. Vue-free for test/helpers/pendingSwitches.ts.
 */

export class PendingSwitches {
	private wanted = new Map<string, {on: boolean; timer: ReturnType<typeof setTimeout>}>();

	private readonly timeoutMs: number;
	private readonly changed: () => void;

	/** `changed` is called whenever what a switch shows may have changed. */
	constructor(timeoutMs: number, changed: () => void) {
		this.timeoutMs = timeoutMs;
		this.changed = changed;
	}

	/** The user asked for `key` to be `on`. */
	request(key: string, on: boolean): void {
		const old = this.wanted.get(key);

		if (old) {
			clearTimeout(old.timer);
		}

		const timer = setTimeout(() => {
			this.wanted.delete(key);
			this.changed();
		}, this.timeoutMs);
		this.wanted.set(key, {on, timer});
		this.changed();
	}

	/** The real state moved: drop every request it now satisfies. */
	reconcile(actual: (key: string) => boolean): void {
		let any = false;

		for (const [key, {on, timer}] of this.wanted) {
			if (actual(key) === on) {
				clearTimeout(timer);
				this.wanted.delete(key);
				any = true;
			}
		}

		if (any) {
			this.changed();
		}
	}

	/** What the switch for `key` shows, given its real state. */
	shown(key: string, actual: boolean): boolean {
		return this.wanted.get(key)?.on ?? actual;
	}

	/** Whether `key` is waiting for the server. */
	isPending(key: string): boolean {
		return this.wanted.has(key);
	}

	dispose(): void {
		for (const {timer} of this.wanted.values()) {
			clearTimeout(timer);
		}

		this.wanted.clear();
	}
}
