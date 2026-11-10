# First model review: Delivery.tla v0

Read:
- `model/Delivery.tla`, its configs (`model/*.cfg`), `model/README.md` and the mutants
  `model/DM_*.tla` (`diff` each against Delivery.tla);
- `DECISIONS.md` (D1, D2, D12, D13, D15 and the switch table) and `DESIGN.md`;
- the spec text under `../formal-spec/specs-src/`.

Read nothing else. Your earlier reports are `DECISIONS-REVIEW-1.md` to `-5.md`. The TLC results
in `model/README.md` came from a cluster run and are unconfirmed by you. Do not run TLC.

Please, briefly and adversarially, with file:line:
1. **Fidelity.**
   - Does each action implement the decision it cites, no wider or narrower?
   - Do the server's responses match D1 and D15's table (`Full` vs `Lost`)?
   - Does the client's `Handle`/`CRecv` match D15, including inherited batch labels,
     first-settling-line-wins, the fallback's oldest-copy rule and `Deferred` (BA:55)?
2. **Properties.**
   - Is each one stated correctly?
   - Is any vacuous at these bounds? Look at `LabelOnce`, when nothing can send a second
     labeled response, and at `PendingResolves` under `WF` of `CTimeout`.
   - Are `ResolvedByResponse` and `OutcomeMatchesCause` strong enough to catch a client that
     mis-handles a reachable response?
3. **Mutants and witnesses.** Does each mutant make exactly the change the README names? Does
   each witness show the claimed causal story, given what the ghosts `who`, `by` and `cause`
   record?
4. **Bounds and gaps.** What does this version miss that a conforming server or Seance can do?
   Consider:
   - two batches open;
   - a second labeled response, from a server mutant;
   - the self-message (LR-5), which D15 discusses but v0 may not model;
   - connection close;
   - a NOTICE.
   Which of these should v1 add first?

Write the report to `MODEL-REVIEW-1.md`, verdict first. Edit no other file.
