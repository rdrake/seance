/**
 * The server's fake-lag clock, kept on our side of the socket.
 *
 * ircu-family servers (nefarious2 included) charge every command after
 * registration `lagmin + bytes / lagfactor` seconds (`parse.c`, 2 + len/120
 * unless the connection class sets `fakelagminimum`/`fakelagfactor`) onto a
 * per-client clock, `cli_since`, which never runs behind wall time
 * (`s_bsd.c` pulls it up to now on every read). Once the clock is
 * {@link FakeLagModel.ceiling} seconds ahead the server stops reading the
 * socket: whatever we send next waits, and a line the user typed waits
 * with it.
 *
 * Fixed pacing does not see that. Two catch-up commands every 4 s cost
 * exactly what drains in 4 s, so after the JOIN burst the clock sat at the
 * ceiling for the whole catch-up, and each line the user typed meanwhile
 * added 2 s to a backlog that did not drain until the catch-up ended: on
 * 12 channels, lines typed every 4 s waited 0, 6, 14, 18 and 22 s and six
 * of eleven were still unread after 45 s (measured 2026-10-19 against
 * stock fake lag, docs/projects/connect-burst.md). So the client counts what it sent, and
 * background work — catch-up, read markers, mode queries — goes out only
 * while the clock is under {@link BACKGROUND_BUDGET_MS}, which leaves room
 * for a few of the user's lines to go straight through.
 *
 * The model is deliberately the conservative one: it charges opers too
 * (most commands are `MFLG_SLOW`, charged whoever sends them) and counts
 * the whole line, tags included. A server with a gentler flood rule just
 * gets its catch-up a little later than it could have. One undercount: the
 * transport's own PONGs and probe PINGs (transport.ts) bypass
 * `IrcClient.send`, so the server charges them and we do not — about 2 s
 * each, inside the headroom the budget leaves. Vue-free; tests run it on
 * fake timers.
 */

export interface FakeLagModel {
	/** Seconds charged for any command (`lagmin`). */
	min: number;
	/**
	 * Bytes per extra second (`lagfactor`); integer division, as the server
	 * does. 0 turns fake lag off, as `fakelagfactor = 0` does in a Class block.
	 */
	factor: number;
	/** Seconds ahead at which the server stops reading the socket. */
	ceiling: number;
}

/** ircu / nefarious2 defaults (`parse.c`, `s_bsd.c`). */
export const IRCU_FAKE_LAG: FakeLagModel = {min: 2, factor: 120, ceiling: 10};

/** A class without fake lag (`fakelagfactor = 0`): nothing is charged. */
export const NO_FAKE_LAG: FakeLagModel = {min: 0, factor: 0, ceiling: 10};

/**
 * How far ahead background senders may push the clock. With the ceiling at
 * 10 s this keeps three of the user's own lines (2 s each) out of the wait.
 */
export const BACKGROUND_BUDGET_MS = 4000;

export class FakeLagClock {
	/** The server's `cli_since`, in ms since the epoch; 0 before registration. */
	readonly model: FakeLagModel;
	private readonly now: () => number;
	private since = 0;
	private charging = false;

	constructor(model: FakeLagModel = IRCU_FAKE_LAG, now: () => number = () => Date.now()) {
		this.model = model;
		this.now = now;
	}

	/** Registration completed (001): the server starts its clock at now. */
	start(): void {
		this.since = this.now();
		this.charging = true;
	}

	/** The socket closed: nothing is charged until the next registration. */
	stop(): void {
		this.since = 0;
		this.charging = false;
	}

	/** Account for one line we sent. Free before registration. */
	charge(line: string): void {
		if (!this.charging) {
			return;
		}

		this.since = Math.max(this.since, this.now()) + this.cost(line);
	}

	/** What `line` would cost, in ms. */
	cost(line: string): number {
		if (this.model.factor <= 0) {
			return 0;
		}

		const bytes = new TextEncoder().encode(line).length + 2; // CRLF
		return (this.model.min + Math.floor(bytes / this.model.factor)) * 1000;
	}

	/** How far the server's clock is ahead of wall time, in ms (never negative). */
	ahead(): number {
		return this.charging ? Math.max(0, this.since - this.now()) : 0;
	}

	/**
	 * How long to wait before spending `costMs` more without the clock going
	 * past `budgetMs` ahead; 0 when it fits now. A cost larger than the
	 * budget fits once the clock has fully drained.
	 */
	waitFor(costMs: number, budgetMs: number = BACKGROUND_BUDGET_MS): number {
		const room = Math.max(0, budgetMs - costMs);
		return Math.max(0, this.ahead() - room);
	}
}

/** One piece of background work: what it costs and what it sends. */
export interface BackgroundJob {
	/** Same key = same work: adding it again replaces the job in place. */
	key: string;
	/** Estimated lag it adds, in ms (two commands = `2 * min` seconds). */
	cost: number;
	/** Send it. Builds its lines now, so they carry the state of the moment. */
	run: () => void;
}

/**
 * The work nobody is waiting for, sent in order as the clock allows: the
 * catch-up of channels the user is not looking at, read markers, mode
 * queries, push renewals. One queue per connection, so two kinds of
 * background work never both decide the clock has room at the same moment.
 * Something the user asked for — opening a channel, typing a line — never
 * waits here: it goes out at once and the queue makes room after it.
 */
export class BackgroundQueue {
	private jobs: BackgroundJob[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** A job's `run` may queue more; the loop already running sends it. */
	private pumping = false;

	private readonly clock: FakeLagClock;
	/** False while the socket cannot take commands (before 001, closed). */
	private readonly ready: () => boolean;
	private readonly budgetMs: number;

	constructor(
		clock: FakeLagClock,
		ready: () => boolean,
		budgetMs: number = BACKGROUND_BUDGET_MS
	) {
		this.clock = clock;
		this.ready = ready;
		this.budgetMs = budgetMs;
	}

	/** Queue `job` (at the back, or in its old place when the key is queued). */
	add(job: BackgroundJob, {front = false}: {front?: boolean} = {}): void {
		const index = this.jobs.findIndex((j) => j.key === job.key);

		if (index !== -1) {
			this.jobs[index] = job;
		} else if (front) {
			this.jobs.unshift(job);
		} else {
			this.jobs.push(job);
		}

		this.pump();
	}

	has(key: string): boolean {
		return this.jobs.some((j) => j.key === key);
	}

	/** Remove a queued job and hand it back (to run it now, or to forget it). */
	take(key: string): BackgroundJob | undefined {
		const index = this.jobs.findIndex((j) => j.key === key);

		if (index === -1) {
			return undefined;
		}

		const [job] = this.jobs.splice(index, 1);

		if (this.jobs.length === 0) {
			this.stopTimer();
		}

		return job;
	}

	/** Forget every job whose key passes `test`. */
	drop(test: (key: string) => boolean): void {
		this.jobs = this.jobs.filter((j) => !test(j.key));

		if (this.jobs.length === 0) {
			this.stopTimer();
		}
	}

	/** A job of `cost` would go out now: nothing queued ahead of it and room on the clock. */
	fits(cost: number): boolean {
		return (
			this.jobs.length === 0 && this.ready() && this.clock.waitFor(cost, this.budgetMs) === 0
		);
	}

	keys(): string[] {
		return this.jobs.map((j) => j.key);
	}

	clear(): void {
		this.jobs = [];
		this.stopTimer();
	}

	/** Send what fits now and schedule the rest. Safe to call any time. */
	pump(): void {
		if (this.timer !== null || this.pumping) {
			return;
		}

		this.pumping = true;

		try {
			while (this.jobs.length > 0 && this.ready()) {
				const wait = this.clock.waitFor(this.jobs[0].cost, this.budgetMs);

				if (wait > 0) {
					this.timer = setTimeout(() => {
						this.timer = null;
						this.pump();
					}, wait);
					return;
				}

				this.jobs.shift()!.run();

				if (this.timer !== null) {
					return; // the job yielded its turn (yieldTurn)
				}
			}
		} finally {
			this.pumping = false;
		}
	}

	/**
	 * Called from a job's `run` whose line goes out a little later (a promise
	 * hands the turn to an awaiting caller): the queue sends nothing more until
	 * that line has been charged to the clock, after the current microtasks.
	 */
	yieldTurn(): void {
		this.stopTimer();
		this.timer = setTimeout(() => {
			this.timer = null;
			this.pump();
		}, 0);
	}

	private stopTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
