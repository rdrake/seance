# Mutation testing the mocha suite

_Started 2026-10-31, paused 2026-11-01 for lack of budget. Handoff for whoever picks it up; the tracking issue links here._

## Why

Many of the suite's tests were written by agents, and a test can pass while checking far less than its name says. Mutation testing (StrykerJS) changes the code one small edit at a time and reruns the tests: an edit no test notices is a **survivor**, and each survivor is one of four things — an equivalent change, behaviour no test pins, a test that claims more than it checks, or a bug. So far it found six real bugs (PR #150) and one blind spot under every handler test (below).

## Where things are

- **Branch `chore/mutation-testing`** (on the fork, `rdrake/seance`): all the new tests, in commits per area. Based on develop as of 2026-10-31 (`e75411ca`); **rebase onto develop before more work** — PRs #150 and #151 touch `test/irc/commands.ts`, `test/irc/multiline.ts`, `client/js/irc/commands/*`, `whois.ts`, `multiline.ts` and `client.ts`, so expect test conflicts and survivors that moved.
- **Not on the branch on purpose** (keep them out of any PR):
  - the Stryker devDependencies — `corepack yarn add -D @stryker-mutator/core@10.1.1 @stryker-mutator/mocha-runner@10.1.1` (check `node_modules` is not a symlink into another worktree first);
  - a skip in `test/helpers/parseMarkdown.ts` "markdown — cost of a hostile 16 KB message": add `before(function () { if (process.env.STRYKER_MUTATOR_WORKER) this.skip(); })` while mutating — instrumentation makes those timing budgets fail;
  - `reports/` (JSON reports, gitignored or untracked).
- **Configs**: `tools/mutation/stryker.config.json` (everything under `client/js` and `shared`, scenes and DOM-only files excluded) and `tools/mutation/stryker.tier23.json` (the 93 files of tiers 2–3). Run from the repo root: `npx stryker run tools/mutation/stryker.tier23.json` (about 12 minutes on 8 cores; the full config took 268 minutes). Keep `incremental: false` when verifying — **incremental mode reports stale survivors after test edits**. For one file, copy the config with `mutate: [that file]`.
- **Triage**: `docs/projects/mutation-testing/full-run-2026-10-31.md` (the full run, files by tier), `docs/projects/mutation-testing/tier23/` (tiers 2–3: `SUMMARY.md`, `BRIEF.md` — the classification brief agents followed — `groupN.md`, the survivors with source snippets, and `groupN-verdict.md`, every survivor classified).

## Where it stands

| Tier                                                                                         | State                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1 wire (`message`, `multiline`, `transport`, `caps`, `sasl`, …)                              | tests written and verified per file (2026-10-31); not re-triaged |
| 2 parsing (handlers, commands, markdown, highlighter, helpers)                               | tests written; survivors classified                              |
| 3 storage (`saved-networks`, `querylog`, `closedQueries`, `noticelog`, scripting storage, …) | tests written; survivors classified                              |
| 4 other, 5 oper                                                                              | not started                                                      |

Tier 2–3 Stryker (before the hook below): 1772 survivors → 523, plus 305 NoCoverage; 90.5 % (93.7 % of covered). The 828 classified: 366 equivalent, 373 untested, 63 weak tests, 16 already fixed, 8 unsure.

**The handler-crash blind spot.** `IrcClient.handleMessage` catches and logs whatever a handler throws, so a mutant that made a handler crash before doing anything passed every "ignores … / shows nothing" test — about 50 survivors. Commit `4c956d06` adds `test/hooks.ts` (required from `test/.mocharc.yml`), which turns that log into a test failure. Nothing in the real suite crashes. **Stryker has not been rerun since**; that rerun is step 1 below, and many group verdicts marked "equivalent (the throw is caught)" should now be killed.

## What is left, in order

1. **Rebase and rerun** tiers 2–3 with the hook; regenerate the survivor lists with `node tools/mutation/survivors.mjs reports/tier23.json <dir> 5` (balanced groups, each mutant with its source snippet; the brief reads that format). Drop from the verdict files whatever the hook killed.
2. **Fix the 63 weak tests** — each verdict file's "Weak tests" section names the test, the file and what its assertion misses. Fix the assertion or the input; do not just add a new test beside a test that lies. The worst one: `test/irc/catchup.ts` "goes in JOIN order when the server refuses, and does not ask that server again" counts calls on the global `socket.dispatch` while the harness gives the client its own bus, so its check can never fail.
3. **Untested behaviour (373)** — write tests where the behaviour matters; the verdict files group them by cause. Some cannot be reached under mocha (the IndexedDB backend of `noticelog.ts`: no IndexedDB; lazily loaded chunks failing to load) — say so in the verdict rather than forcing it. `/lua`'s output paths, `metadata.ts`'s per-key isolation and `markread.ts`'s queue are the most valuable.
4. **Check before calling it equivalent**: when unsure, apply the mutant by hand to a scratch copy, run the one spec, restore. Two known traps: chai `expect(undefined).to.match(/re/)` passes when the regex matches the string "undefined" (assert `.to.be.a("string")` first); `math.ts` 1165/1168 survive only inside Stryker's long-lived worker (killed when the spec runs alone).
5. **Tiers 4 and 5** with the same loop: write tests, run Stryker on the tier, classify every survivor with the brief, fix weak tests, file bugs.

## Rules for whoever continues

- A real bug goes in its own small fix PR (one commit per bug, a test that fails before the fix), not into the test branch. Open PRs on `evilnet/seance` as **drafts**.
- Every survivor gets a verdict; a Stryker run is not done until it is classified.
- Size of the job: tiers 2–3 took five classification agents about 250k tokens each, and the test writing before that several times as much.
- Never `git stash` bare, never `yarn install` in a worktree whose `node_modules` is a symlink.

## Known open items found along the way

- `markread.ts`: `markReadAt` leaves a marker already in the background queue, so the same `MARKREAD` may go out twice (group 4, untested — check whether it is a bug).
- Redundant guards: `aliases.ts:218` (the budget guard L242 always stops first), `token.ts:21/38` (repeats `authtoken.take`'s match).
- `strip.ts`'s "skip an empty node" branch may be unreachable (group 3, unsure).
