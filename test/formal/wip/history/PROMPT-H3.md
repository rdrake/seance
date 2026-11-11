# Third review of History.tla: v0.2

Read only these, and do not run TLC:
- `HISTORY-REVIEW-2.md`, your review of v0.1.
- `model/History.tla` (v0.2) and `model/.History-v0.1.tla.ref` (v0.1).
- `model/mkhist.py`.
- `DECISIONS.md` D25, including its last bullet.
- The spec text under `../formal-spec/specs-src/extensions/`.

All 37 generated checks came out as expected on the cluster (history-v0.2: the pass and fail
expectations in mkhist.py). You haven't confirmed that run.

Please be brief and adversarial, and cite file:line for every finding.
1. Does v0.2 fix each blocking and open item in HISTORY-REVIEW-2?
2. Check EndOK as D9's wire meaning and its snapshot oracle; selector lookup for unknown and
   minted ids; and the content-versus-msgid split in every oracle and client step.
3. Is v0.2 ready to extend to v1 (first JOIN, `more`, FAIL, unknown selectors)? Separately, is
   it ready to drive a replay of Seance's catch-up code? If either needs more work first, list it.

Write the report to `HISTORY-REVIEW-3.md`, verdict first. Edit no other file.
