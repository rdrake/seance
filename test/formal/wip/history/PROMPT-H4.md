# Fourth review of History.tla: v1

Read only these, and do not run TLC:
- `HISTORY-REVIEW-3.md`, your review of v0.2.
- `model/History.tla` (v1) and `model/.History-v0.2.tla.ref` (v0.2).
- `model/mkhist.py` and `model/results-h1.summary`. The summary is the cluster's output; `.mkhist-v0.2.py.ref` is the previous generator.
- `DECISIONS.md` D26.
- The spec text under `../formal-spec/specs-src/extensions/` (chathistory.md, batch.md, message-ids.md).

All 57 generated checks came out as expected on the cluster (history-v1, jobs 10500 and 10504).
Each line of the summary names a module, a config, the expected and actual results, and the
violated property for a failure.

Please be brief and adversarial, and cite file:line for every finding.
1. Does v1 do each "v1: proceed" item and each "Remaining limitations" item from review 3? If
   any is only partly done, say what is missing.
2. Check, for each mode (reconnect, join, more):
   - the obligation is right for that request kind;
   - it cannot be met vacuously, and its cover and its witness or mutant really separate pass
     from fail;
   - the FAIL exclusion doesn't let a non-FAIL loss through.
3. Is EndNext independent of EndOK? Are HS_EndLast and HS_EndEmpty the regressions review 3
   asked for? Is the exactness note in D26 correct?
4. UnknownEmpty, HS_UnknownLatest and the minted-anchor witnesses: do they isolate unknown
   lookup?
5. Is v1 ready to drive a replay of client catch-up code (Seance, then Textual-NG and
   HexDroid)? Name the smallest adapter. For each model action, give the concrete
   request/reply/live-line fixture. Say whether whole-page delivery is a sound abstraction for
   that replay, or whether line-level batch interleaving is needed first.

Write the report to `HISTORY-REVIEW-4.md`, verdict first. Edit no other file.
