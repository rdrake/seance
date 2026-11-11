# Fifth review: spec model v5

Your earlier reports are `SPEC-REVIEW.md` to `SPEC-REVIEW-4.md`. The model
(`model/SpecHandshake.tla`), configs, `RULES.md`, `DECISIONS.md` and `README.md` have been
revised against SPEC-REVIEW-4. Judge them ONLY against the spec text in `specs-src/`
(commit 9ff58d1). Do not read anything outside this directory; do not read
`CODE-FINDINGS.md`, `hpc/`, or the `PROMPT*.md` files other than this one.

Changes claimed against SPEC-REVIEW-4, by its finding number:

- #1 (903 stranded by ERROR): `SrvFailClose` is enabled only when nothing is owed
  (900/903, the 001 after 906, the LS rest, an open split's last part); queued REQs may go
  unanswered. The client's QUIT sets `srv.peerQuit`, and `OwedSent` is now excused only by
  it (D19).
- #2 (903 before 900): a success sends nothing itself; it adds one to `owe900` and
  `owe903`, and `Srv900`/`Srv903` send them in either order with other output between
  (D20, `W_903First`, `W_Between`).
- #3 (monitors): `RuleOwed903` replaced by the invariant `SuccAccounting` (900 and 903
  lines sent plus owed equal the number of successes, counted by the `G` wrapper).
  `RuleAckWhole` now requires an opened split's record to be exactly the request minus the
  first part, and a closing split's line to be exactly that record's remaining caps.
- #4 (two open splits): the other caps are a constant `OtherCaps` (`{"a"}` in every config
  but `ProbeTwoSplits.cfg`, `{"a", "b"}`); new witness `W_TwoSplits`.
- Wording: D18's DEL-then-NEW case, the rule exemption, the LS-rest comment, W_Between.

Results reported by the author (TLC, 8 workers, Mac), no errors: ProbeLost903 9.86M distinct
states, ProbeReorder 75.9K, ProbeSplitCross 26.7K, ProbeTwoSplits 23.4M, ProbeDelSplit 7.37M,
Tiny and TinyEnv 10.8M each. Witnesses W_TwoSplits, W_903First, W_Between and W_Welcome903
each fail as expected. Mutants
(`model/mutants/make-mutants.py`) are each caught, including two new ones: a success that
owes no 903 (`SuccAccounting`, the mutant you ran) and a split's last part listing the
wrong caps (caught first by `CapsAgree`). The larger configs (Small, Split, Reference, ...) have not
been run on v5.

Please, briefly and adversarially:

1. For each SPEC-REVIEW-4 finding (#1-#4) and its "Reference readiness" paragraph, say
   fixed / partly / not, with file:line in model and spec.
2. Report any NEW error the revision introduced: the drain guard on `SrvFailClose`
   (can a failing server now be blocked from closing for ever, or close with something
   owed?), `peerQuit`, success sending nothing in its own step, the counters under Reauth,
   the strengthened `RuleAckWhole`, vacuous properties, witnesses that pass for the wrong
   reason.
3. Is the model now fit to be the reference **server** environment (`EnvSpec`,
   `Reference.cfg`) for checking a client implementation of this subset? Answer plainly:
   do any findings remain that block running the large configs (Small, TwoAttempts,
   Reauth, CapNotify, Split, SplitInOrder, RefSafety, RefLiveness) on the HPC? Mark each
   finding blocking or minor.

You may run TLC on scratch copies with SMALL bounds only (aim for under ten minutes each;
do not run the large configs named above). Do not edit existing files. Keep it short:
findings most severe first. Write it to SPEC-REVIEW-5.md in this directory.
