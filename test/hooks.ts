/**
 * Root hooks for the whole mocha run.
 *
 * `IrcClient.handleMessage` catches whatever a handler throws and only logs
 * it, so the client survives a bad line. In a test that hides a crash: a
 * handler that throws before it does anything looks exactly like one that
 * ignored the line on purpose, and "shows nothing" assertions pass either way.
 * So under test the log is a failure, thrown where the line was fed in.
 */

/* eslint-disable no-console */

const HANDLER_FAILED = "[irc] handler for ";
let original: typeof console.error | undefined;

export const mochaHooks = {
	beforeEach() {
		if (original) {
			return; // loaded twice (as a spec and as a root hook)
		}

		original = console.error;
		const log = original;

		console.error = (...args: unknown[]) => {
			if (typeof args[0] === "string" && args[0].startsWith(HANDLER_FAILED)) {
				throw new Error(args[0], {cause: args[1]});
			}

			log.apply(console, args);
		};
	},

	afterEach() {
		if (original) {
			console.error = original;
			original = undefined;
		}
	},
};
