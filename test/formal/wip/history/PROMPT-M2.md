# Second model review: Delivery.tla v1

Read:
- `model/Delivery.tla`, its configs (`model/*.cfg`), `model/list-d2`, `model/README.md`;
- the mutants `model/DM_*.tla` and `model/DS_*.tla` (`model/mkmut.py` makes each from
  Delivery.tla; `diff` each against it);
- `MODEL-REVIEW-1.md` (your review of v0), `DECISIONS.md` (D1, D2, D12, D13, D15, the switch
  table) and `DESIGN.md`;
- the spec text under `../formal-spec/specs-src/`.

Read nothing else. The TLC results in `model/README.md` came from a cluster run and are
unconfirmed by you. Do not run TLC.

Please, briefly and adversarially, with file:line:
1. **Review 1 follow-up.** For each finding in MODEL-REVIEW-1, is it fixed, partly fixed, or
   still open? Is anything v1 claims to fix not actually fixed?
2. **New code.** Is each of these correct?
   - `HandleAll` and the `note` batches;
   - FAIL inheriting the batch label;
   - the self-message copy;
   - the `crossTimed` ghost and `NoCrossFromTimedOut`;
   - the `early` ghost under `Deferred`.
3. **Mutants and witnesses.** Does each new mutant (`DM_FirstOnly`, `DS_Twice`,
   `DS_InnerLabel`) make only the change the README names? Is each violation the one it is
   meant to show? Do W_SelfCopy and W_LateTimedOut each show their stated causal story, and
   nothing weaker?
4. **Is v1 ready to build on?** Say whether the "Still open" list in the README is complete,
   and what must come before History.tla joins this model.

Write the report to `MODEL-REVIEW-2.md`, verdict first. Edit no other file.
