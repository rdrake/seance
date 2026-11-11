# First review of History.tla v0

Read only these, and do not run TLC:
- `model/History.tla`, `model/mkhist.py` (it generates every config, mutant and `list-h0`) and
  `model/results-h0-run1.summary`. The results come from a cluster run you haven't confirmed.
- `DESIGN.md`, `RULES.md` and `DECISIONS.md`, especially D3–D11, D14 and D22.
- `../formal-spec/specs-src/extensions/chathistory.md`, `message-ids.md` and `batch.md`.

Notes on run1:
- **W_BatchOrder passed.** It is now the positive config HNoBatchAgrees. My reading is that with
  msgid anchors, Contiguous and ExactCount, a batch in another order costs pages but loses
  nothing within these bounds. Check whether that is right, or whether the model hides a loss.
- **CoverFloor passed on HTiny.** With one held message, nothing is older than the floor, so it
  now runs with NHeld = 2.
- **HS_Anchor passed.** It mutated Elig, which the PageEligible oracle shares. It now mutates
  SrvAnswer only.

Please be brief and adversarial, and cite file:line for every finding.
1. **Fidelity.** Is each action correct against the spec text and the decisions?
   - the page semantics, including eligibility, Contiguous, ExactCount, BatchAgrees and the
     chathistory-end tag;
   - the connection order (D7) and the live message;
   - the client loop against CH-23's pseudocode and DESIGN's description of Seance;
   - dedupe and the merge.
   Look for over-strong guards, vacuity, and behaviours excluded by accident.
2. **Properties.** Do NoLoss, NoDup, Order, PageEligible, EndTruthful and Terminates state
   DESIGN's claims, and each under the conditions it needs? Are the covers honest?
3. **Witnesses and mutants.** Does each witness show its stated story? Does each mutant make
   one change, and is it caught by the intended property? What important client or server
   bug is caught by none of them?
4. **Bounds.** Are DESIGN's bounds met? Can every witness be reached within them?
5. **Next.** What must change before v1, which adds the first JOIN, `more`, FAIL and
   unknown-selector handling?

Write the report to `HISTORY-REVIEW-1.md`, verdict first. Edit no other file.
