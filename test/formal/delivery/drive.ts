/**
 * Delivery conformance driver (pilot). Feeds the scenarios of
 * test/formal/wip/history/conformance/scenarios.jsonl to the real
 * `IrcClient` over a FakeTransport and records how each pending copy
 * settles, in the observation format of that directory's SCHEMA.md.
 *
 * Not a test of its own: it asserts only the driver self-check (echo1,
 * fail1, ack1, silence, close) and writes results/seance-<sha>.jsonl.
 *
 * Skipped unless SEANCE_DELIVERY_DRIVE=1, so `pnpm test` never runs it. Run:
 *   pnpm build && SEANCE_DELIVERY_DRIVE=1 NODE_ENV=test pnpm exec mocha \
 *     --config=test/.mocharc.yml test/formal/delivery/drive.ts
 * CONFORMANCE_DIR overrides where scenarios.jsonl is read and results/ written.
 */

import {execSync} from "child_process";
import fs from "fs";
import path from "path";
import sinon from "sinon";
import socket from "../../../client/js/socket";
import {t} from "../../../client/js/i18n/core";
import {PENDING_TIMEOUT_MS} from "../../../client/js/irc/pending";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import {ALL_CAPS, Harness, batch, labelOf, register, setup, stubStorage} from "../../irc/support";

const CONFORMANCE =
	process.env.CONFORMANCE_DIR ?? path.join(__dirname, "../wip/history/conformance");
const CHAN = "#chan";
const ME = "alice"; // the harness's nick (test/irc/support.ts)

type Outcome = "pending" | "confirmed" | "accepted" | "failed" | "timedout";

interface Send {
	i: number;
	tgt: "chan" | "self";
	cmd: "PRIVMSG" | "NOTICE";
	txt: string;
}

type Step = {send: Send} | {line: {raw: string; m: unknown}} | {timeout: number} | {close: true};

interface Scenario {
	name: string;
	tag: string;
	why: string;
	labels: boolean;
	steps: Step[];
}

interface Request {
	i: number;
	send: Send;
	label?: string;
	/** Store id of the pending copy. */
	copyId?: number;
	/** Channel id the copy shows in. */
	chanId?: number;
	outcome: Outcome;
	sentAt: number;
}

interface Observation {
	name: string;
	client: string;
	sha: string;
	labels: Record<string, string | null>;
	snap: {after: number; out: Record<string, Outcome>}[];
	shown: Record<string, number>;
	notes: string;
	skipped: string | null;
}

interface Run {
	client: string;
	caps: string;
	suffix: string;
}

const RUNS: Run[] = [
	{client: "seance", caps: ALL_CAPS, suffix: ""},
	// echo-message and batch still on; Seance then sends no labels.
	{client: "seance-nolabel", caps: ALL_CAPS.replace("labeled-response ", ""), suffix: "-nolabel"},
];

function gitSha(): string {
	return execSync("git rev-parse HEAD", {cwd: path.resolve(__dirname, "../../..")})
		.toString()
		.trim();
}

/** Register as `alice`, join #chan, answer the automatic history request with nothing. */
function joinChan(h: Harness, caps: string): number {
	register(h, caps);
	h.transport.lines(
		`@time=2026-08-25T12:00:00.000Z;msgid=join-1 :${ME}!${ME}@host.example JOIN ${CHAN}`,
		`:irc.test 353 ${ME} = ${CHAN} :@${ME} bob`,
		`:irc.test 366 ${ME} ${CHAN} :End of /NAMES list.`
	);
	const label = labelOf(h.sent());

	if (h.client.caps.hasCapability("draft/chathistory")) {
		batch(h, [], {label, target: CHAN, ref: "join-hist"});
	}

	h.dispatch.resetHistory();
	h.sent();
	return h.client.findChannel(CHAN)!.id;
}

function substitute(raw: string, reqs: Map<number, Request>): string {
	return raw
		.replace(/\{L(\d+)\}/g, (_, i: string) => reqs.get(Number(i))?.label ?? `nolabel${i}`)
		.replace(/\{me\}/g, ME)
		.replace(/\{chan\}/g, CHAN);
}

function runScenario(sc: Scenario, sha: string, run: Run): Observation {
	stubStorage();
	const clock = sinon.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
	const notes: string[] = [];
	const reqs = new Map<number, Request>();
	const snap: Observation["snap"] = [];
	const noAck = t("pending.noAcknowledgement");
	const connLost = t("pending.connectionLost");
	let skipped: string | null = null;

	try {
		const h = setup({nick: ME, join: CHAN});
		const chanId = joinChan(h, run.caps);
		const calls = () => h.dispatch.getCalls();
		const advanceTo = (ms: number) => {
			if (ms > clock.now) {
				clock.tick(ms - clock.now);
			}
		};

		for (const [index, step] of sc.steps.entries()) {
			const start = calls().length;

			if ("send" in step) {
				const s = step.send;
				advanceTo(10000 * s.i);
				h.sent();
				let sendChan = chanId;

				if (s.tgt === "self") {
					// The user path to a message to oneself: `/query me text`
					// typed in the channel opens the query and sends into it.
					h.client.input(chanId, `/query ${ME} ${s.txt}`);
					sendChan = h.client.findChannel(ME)?.id ?? -1;
				} else if (s.cmd === "NOTICE") {
					h.client.input(chanId, `/notice ${CHAN} ${s.txt}`);
				} else {
					h.client.input(chanId, s.txt);
				}

				const lines = h.sent().filter((l) => /(^| )(PRIVMSG|NOTICE) /.test(l));
				const label = lines[0]?.match(/^@(?:[^ ]*;)?label=([^ ;]+)/)?.[1];
				const copies = calls()
					.slice(start)
					.filter((c) => c.args[0] === "msg" && (c.args[1].msg as SharedMsg).pending);

				if (lines.length !== 1) {
					notes.push(`send ${s.i}: ${lines.length} lines on the wire`);
				}

				if (copies.length !== 1) {
					notes.push(`send ${s.i}: ${copies.length} pending copies`);
				}

				reqs.set(s.i, {
					i: s.i,
					send: s,
					label,
					copyId: copies[0]?.args[1].msg.id,
					chanId: copies[0]?.args[1].chan ?? sendChan,
					outcome: "pending",
					sentAt: clock.now,
				});

				if (sc.labels && !label) {
					skipped = "no-label";
					break;
				}
			} else if ("line" in step) {
				h.transport.line(substitute(step.line.raw, reqs));
			} else if ("timeout" in step) {
				const r = reqs.get(step.timeout);

				if (!r) {
					notes.push(`timeout ${step.timeout}: no such request`);
				} else {
					advanceTo(r.sentAt + PENDING_TIMEOUT_MS);
				}
			} else if ("close" in step) {
				h.transport.closed();
			}

			// Attribute every settle of this step, by copy id.
			const stepCalls = calls().slice(start);

			// ERROR lines that no settle explains (a rejection the copy never heard).
			for (const [k, call] of stepCalls.entries()) {
				const m = call.args[0] === "msg" ? (call.args[1].msg as SharedMsg) : undefined;

				if (m?.type === MessageType.ERROR) {
					const prev = stepCalls
						.slice(0, k)
						.reverse()
						.find((c) => c.args[0] === "msg:settled" || c.args[0] === "msg");

					if (prev?.args[0] !== "msg:settled") {
						const where =
							call.args[1].chan === chanId
								? CHAN
								: call.args[1].chan === h.client.lobby.id
								? "lobby"
								: `chan ${call.args[1].chan}`;
						notes.push(
							`step ${index}: unattributed ERROR in ${where}: ${
								m.text ?? `${m.error ?? ""} ${m.reason ?? ""}`.trim()
							}`
						);
					}
				}
			}

			for (const [k, call] of stepCalls.entries()) {
				if (call.args[0] !== "msg:settled") {
					continue;
				}

				const id = call.args[1].id as number;
				const r = [...reqs.values()].find((q) => q.copyId === id);

				if (!r) {
					notes.push(`step ${index}: settled unknown copy ${id}`);
					continue;
				}

				if (r.outcome !== "pending") {
					notes.push(`step ${index}: req ${r.i} settled again`);
					continue;
				}

				// What follows the settle, up to the next one: the echo (settleEcho
				// then pushMessage), the ERROR (failPending), or nothing (ACK).
				let next: SharedMsg | undefined;

				for (const c of stepCalls.slice(k + 1)) {
					if (c.args[0] === "msg:settled") {
						break;
					}

					if (c.args[0] === "msg" && c.args[1].chan === call.args[1].chan) {
						next = c.args[1].msg as SharedMsg;
						break;
					}
				}

				if (!next) {
					r.outcome = "accepted";
				} else if (next.type === MessageType.ERROR) {
					const text = next.text ?? "";

					if (text.includes(noAck)) {
						r.outcome = "timedout";
					} else {
						r.outcome = "failed";
						notes.push(
							`req ${r.i} failed: ${
								text.includes(connLost) ? "on close" : `rejected (${text})`
							}`
						);
					}
				} else if (next.self && !next.pending) {
					r.outcome = "confirmed";

					if (next.text !== r.send.txt) {
						notes.push(`req ${r.i} confirmed by text "${next.text}"`);
					}
				} else {
					r.outcome = "accepted";
					notes.push(`req ${r.i}: settle followed by a non-self msg`);
				}
			}

			snap.push({
				after: index,
				out: Object.fromEntries([...reqs.values()].map((r) => [String(r.i), r.outcome])),
			});
		}

		// Settled own lines, per request text, where the request's copy shows.
		const shown: Record<string, number> = {};

		for (const r of reqs.values()) {
			shown[String(r.i)] = calls().filter((c) => {
				if (c.args[0] !== "msg" || c.args[1].chan !== r.chanId) {
					return false;
				}

				const m = c.args[1].msg as SharedMsg;
				return (
					m.self && !m.pending && m.type !== MessageType.ERROR && m.text === r.send.txt
				);
			}).length;
		}

		// A history replay is delivered as a `more` page ({chan, messages}),
		// not as `msg`: its self lines are shown too, so they count.
		for (const r of reqs.values()) {
			const replayed = calls()
				.filter((c) => c.args[0] === "more" && c.args[1].chan === r.chanId)
				.flatMap((c) => (c.args[1].messages ?? []) as SharedMsg[])
				.filter((m) => m.self && !m.pending && m.text === r.send.txt).length;

			if (replayed > 0) {
				shown[String(r.i)] += replayed;
				notes.push(`shown[${r.i}] includes ${replayed} replayed (more) line(s)`);
			}
		}

		return {
			name: sc.name,
			client: run.client,
			sha,
			labels: Object.fromEntries(
				[...reqs.values()].map((r) => [String(r.i), r.label ?? null])
			),
			snap,
			shown,
			notes: notes.join("; "),
			skipped,
		};
	} finally {
		clock.restore();
		sinon.restore();
		socket.removeAllListeners();
	}
}

const describeDrive = process.env.SEANCE_DELIVERY_DRIVE === "1" ? describe : describe.skip;

describeDrive("Delivery conformance driver (formal/delivery)", function () {
	for (const run of RUNS) {
		it(`runs every scenario and writes the observations (${run.client})`, function () {
			const sha = gitSha();
			const scenarios = fs
				.readFileSync(path.join(CONFORMANCE, "scenarios.jsonl"), "utf8")
				.split("\n")
				.filter((l) => l.trim())
				.map((l) => JSON.parse(l) as Scenario);
			const results = scenarios.map((sc) => runScenario(sc, sha, run));
			const dir = path.join(CONFORMANCE, "results");
			fs.mkdirSync(dir, {recursive: true});
			const out = path.join(dir, `seance-${sha.slice(0, 9)}${run.suffix}.jsonl`);
			fs.writeFileSync(out, results.map((r) => JSON.stringify(r)).join("\n") + "\n");

			// eslint-disable-next-line no-console
			console.log(`\nwrote ${out} (${results.length} scenarios)`);

			for (const r of results) {
				const last = r.snap[r.snap.length - 1]?.out ?? {};
				// eslint-disable-next-line no-console
				console.log(
					`${r.name.padEnd(17)} ${JSON.stringify(last).padEnd(40)} shown=${JSON.stringify(
						r.shown
					)} ${r.skipped ?? ""} ${r.notes}`
				);
			}

			if (run.suffix !== "") {
				return;
			}

			const expectFinal: Record<string, Outcome> = {
				echo1: "confirmed",
				fail1: "failed",
				ack1: "accepted",
				silence: "timedout",
				close: "failed",
			};
			const mismatches = Object.entries(expectFinal)
				.map(([name, want]) => {
					const r = results.find((x) => x.name === name);
					const got = r?.snap[r.snap.length - 1]?.out["1"];
					return got === want ? null : `${name}: want ${want}, got ${got}`;
				})
				.filter(Boolean);

			if (mismatches.length > 0) {
				// eslint-disable-next-line no-console
				console.log(`self-check mismatches: ${mismatches.join("; ")}`);
			}
		});
	}
});
