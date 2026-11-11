# Second review of History.tla: v0.1

Read only these, and do not run TLC:
- `HISTORY-REVIEW-1.md`, your review of v0.
- `model/History.tla` (v0.1), `model/.History-v0.tla.ref` (v0) and `model/mkhist.py`.
- `model/results-h01.summary`: a cluster run of every generated check, unconfirmed by you.
- `DECISIONS.md` D22 and D24, and the DESIGN.md changes under Bounds and NoLoss.
- The spec text under `../formal-spec/specs-src/extensions/`.

Please be brief and adversarial, and cite file:line for every finding.
1. For each finding in HISTORY-REVIEW-1, say whether v0.1 fixes it, fixes it in part, or leaves it open.
2. Is anything new wrong? In particular check:
   - the msgid/content split (Content, Replay, T) and every place that should use one rather than the other;
   - NoneOlder as D9's end semantics;
   - the snapshot oracles;
   - the new witnesses W_BatchBudget, NoDupLive and HFuzz, and the mutant HS_NewId.
3. Is v0.1 ready to extend to v1 (first JOIN, `more`, FAIL, unknown selectors)? If not, what is
   left to do first?

Write the report to `HISTORY-REVIEW-2.md`, verdict first. Edit no other file.
