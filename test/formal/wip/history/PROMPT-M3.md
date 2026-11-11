# Third model review: Delivery.tla v2.1

Read only these, and do not run TLC:
- `model/Delivery.tla`, its configs (`model/*.cfg`), `model/list-d3` and `model/README.md`. The
  TLC results in the README came from a cluster run that you haven't confirmed.
- The mutants `model/DM_*.tla` and `model/DS_*.tla`. `model/mkmut.py` makes each one from
  Delivery.tla; diff each against it.
- `MODEL-REVIEW-2.md`, your review of v1, and `DECISIONS.md`, especially D16–D21.
- `DESIGN.md`, and the spec text under `../formal-spec/specs-src/`.

Please be brief and adversarial, and cite file:line for every finding.

1. **Review 2 follow-up.** For each finding in MODEL-REVIEW-2, say whether it is fixed, partly
   fixed, or still open.
2. **New code.** Is each of these correct against D16–D21 and the spec text?
   - the line queue, and how interleaving works;
   - the reference-indexed batch map and depth-two nesting;
   - the Deferred buffer per root;
   - the three History forms, and the rule that a history line never settles a copy;
   - Competing, CloseOn, Notice and Modify;
   - `ImmediateObligation` and `DeferredObligation`.
   Look for vacuity, over-strong guards, and behaviours the switches exclude by accident.
3. **Mutants, witnesses and covers.** Does each mutant make only its one change? Is each
   violation the intended one? Does each witness show its stated causal story, and nothing
   weaker? Is any important client bug left uncaught by every mutant?
4. **Readiness.** Is v2.1 ready to build History.tla on? List what must change first, if
   anything, and say whether the README's "Still open" list is complete.

Write the report to `MODEL-REVIEW-3.md`, verdict first. Edit no other file.
