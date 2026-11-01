# Tier 2–3 survivor triage (2026-11-01)

828 mutants alive after the tier 2–3 tests: 523 survived, 305 NoCoverage. Five agents classified every one; per-file tables in `group1-verdict.md` … `group5-verdict.md`.

| Group | equivalent | untested | weak-test | known | unsure | possible bug |
| ----- | ---------: | -------: | --------: | ----: | -----: | -----------: |
| 1     |         45 |      100 |        20 |     – |      – |            1 |
| 2     |         85 |       68 |        10 |     3 |      – |            – |
| 3     |         86 |       69 |         7 |     – |      4 |            – |
| 4     |         64 |       86 |        11 |     – |      3 |            1 |
| 5     |         86 |       50 |        15 |    13 |      1 |            – |
| Total |        366 |      373 |        63 |    16 |      8 |            2 |

## The blind spot under all the handler tests

`IrcClient.handleMessage` catches and logs whatever a handler throws. A mutant that removes a guard makes the handler throw before it does anything, and every "ignores / shows nothing" test passes. About 37 "equivalent" verdicts (groups 2, 3, 5) and ~15 weak tests (group 1) are this one thing. Fixed by `test/hooks.ts`: under test that log is a thrown error, at the line that was fed in. With the real code nothing in the suite crashes; with the KICK guard removed, "a KICK naming nobody is ignored" now fails.

## Bugs

- **whois.ts:233** — a 4-parameter 338 (`:irc 338 alice bob 10.0.0.9 :actually using host`, the Hybrid/ratbox form) sets the card's real host to the nick. Group 1, probed.
- **Empty words from a double space** — `/join #foo` rejoins the current channel and never joins `#foo`; `/ignore bob`, `/ban bob` print usage; `/kick bob`, `/kill bob` send nothing and say nothing. `/check`, `/react`, `/connect`, `/investigate` already drop empty words. Groups 2, 1, 4, 5.
- Known and fixed in #150: the Map tags (13 mutants), FAIL REDACT's empty description, the shebang (3).

## Weak tests (tests whose names claim more than they check)

Worst: `test/irc/catchup.ts` "goes in JOIN order when the server refuses…" counts calls on the global bus while the harness gives the client its own, so its "FAIL is not shown" check can never fail.

The rest are listed per group in the verdict files' "Weak tests" sections: inputs already in the order a sort would produce, a range wide enough for the wrong rule, a timer waited out past what it tests, a boundary never tried exactly, a field never asserted.

## Not bugs, worth a look

- markread.ts: `markReadAt` leaves a marker already queued in the background queue, so the same MARKREAD may go out twice (group 4, untested behaviour).
- math.ts 1165/1168 survive only inside Stryker's long-lived process; killed when the spec runs alone (state carried between mutant runs).
- aliases.ts:218 and token.ts:21/38 are redundant guards.
