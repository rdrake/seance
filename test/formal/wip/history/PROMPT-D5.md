# Fifth review (short): D15 and the Delivery properties

Your reports so far are `DECISIONS-REVIEW-1.md` to `-4.md`. v3 is kept as `.DECISIONS-v3.md.ref`
and `.DESIGN-v3.md.ref`; `diff` them against the current files. New since v3:
- D15, the outcome table of the checked client;
- the D1 correction, since a late unlabeled echo can settle a copy through the content
  fallback;
- the content-fallback and other-session rows in the switch table;
- in DESIGN.md: ResolvedByResponse, ConfirmedByOwn, their mutants, and the ghosts and coverage
  paragraph.

D15 describes Seance's actual client code, which you cannot read. Judge it as a stated client
policy. Limits otherwise as in `PROMPT-D.md`.

Please answer briefly and adversarially:
1. Is every outcome in D15's table consistent with the text (LR, EM, BA)? Is any reachable
   response missing from it?
2. Do ResolvedByResponse and ConfirmedByOwn close the vacuity of PendingResolves under a fair
   timeout? Is each mutant really caught by the property named?
3. Is the other-session witness reachable at Delivery's bounds, and is ConfirmedByOwn's
   condition the right one?
4. **Verdict:** can `Delivery.tla` be written now?

Write the report to `DECISIONS-REVIEW-5.md`, verdict first, citing file:line. Edit no other file.
