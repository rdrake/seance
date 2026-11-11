# Fourth review: spec model v4

Your earlier reports are `SPEC-REVIEW.md`, `SPEC-REVIEW-2.md` and `SPEC-REVIEW-3.md`. The
model (`model/SpecHandshake.tla`), configs, `RULES.md`, `DECISIONS.md` (now D1-D20) and
`README.md` have been revised again. Judge them ONLY against the spec text in `specs-src/`
(commit 9ff58d1). Do not read anything outside this directory; do not read
`CODE-FINDINGS.md`, `hpc/`, or the `PROMPT*.md` files other than this one.

Changes claimed against SPEC-REVIEW-3, by its finding number:

- #1 (lost 903): `SrvDecide` sends 900 and adds one to a counter `srv.owe903`; only
  `Srv903` lowers it, sending 903. No exchange state touches it. New `RuleOwed903` (action)
  and `OwedSent` (liveness). 001 may be sent while a 903 is owed (D20, `W_Welcome903`).
- #3 (D17): rewritten as an ambiguity rather than a gap (no marker, no order rule), with
  the safe client strategies listed. The model client now keeps its outstanding REQs
  pairwise disjoint (`CReq`) and attributes ACK and NAK lines by content (`Owner`), per
  REQ. Every config but SplitInOrder keeps `ReorderReplies = TRUE`.
- #4: `W_SplitCross` records per split whether 001 had been sent at its first part
  (`reg0`). `W_Between` is a ghost `gb` set by any non-903 line sent while a 903 is owed
  (every step is wrapped in `G`). `RuleAckWhole` restored as an action property on inbox
  and split removal, and `RuleSaslNakIfDown` re-added. The send boundary is stated (D19):
  appending to `sout` is sending; `SrvSend` is delivery, which may flush after ERROR.
  `Reference.cfg` and `RefSafety.cfg` use `EnvSpec`. Stale D9/D15/D16 and RULES rows fixed.
- #2 (schedules): `EnvChange` is no longer blocked during a split ACK; a DEL inside an open
  split drops that cap from what the split enables, on both sides (D18). With
  `ReorderReplies`, other REQs may be answered and other splits opened between the parts of
  a split. LS is two steps (`SrvLsRest`, whose final line omits caps DELed since the first
  line), and 906 and 001 are two steps (`Srv001`). Reference has `Reauth = TRUE` and
  `ReorderReplies = TRUE`.

Results reported by the author (TLC, 8 workers, Mac). SPEC-REVIEW-3's probes:
ProbeLost903 3.25M distinct states, ProbeReorder 75.9K, ProbeSplitCross 26.7K,
ProbeDelSplit 7.37M: no errors (v3 failed the first two). Tiny (1/1/1, every switch on, Spec) and TinyEnv (same, EnvSpec, safety and server liveness): 8.26M distinct states each, no error. Witnesses
W_SplitCross, W_Interleave, W_LsEnv, W_Between, W_Welcome903 and W_DelInSplit each fail as
expected. Mutants (`model/mutants/make-mutants.py`, configs beside it) are each caught:
silent REQ drop by `RuleAckWhole`, cleared 903 by `RuleOwed903`, overlapping pipelined REQs
and client-ignores-DEL by `CapsAgree`, server-ignores-DEL by `TypeOK`. The larger configs
(Small, Split, Reference, ...) have not been run on v4.

Please, briefly and adversarially:

1. For each SPEC-REVIEW-3 finding (#1-#4) and its closing list ("Before reference
   use"), say fixed / partly / not, with file:line in model and spec.
2. Check D17 and D18 against the spec text. Is content attribution with disjoint REQs
   sound under every schedule the server now has, including DEL and NEW between ACK parts
   and interleaved splits? Is D18 a reasonable reading, and does it make the two ends agree
   on one ordered stream? Is the rule exemption for the last part of a split (D18) honest?
3. Report any NEW error the revision introduced (the `G` wrapper and fairness, the LS rest
   line, `Srv001` and `reg`, `owe903` with `SrvFailClose`, the restored rules, vacuous
   properties, witnesses that pass for the wrong reason).
4. Is the model now fit to be the reference **server** environment (`EnvSpec`,
   `Reference.cfg`) for checking a client implementation of this subset? If not, what
   exactly must change? Say which findings, if any, block running the large configs.

You may run TLC on scratch copies with SMALL bounds only (aim for under ten minutes each;
do not run Small, Split, SplitInOrder or Reference*). Do not edit existing files. Keep it
short: findings most severe first. Write it to SPEC-REVIEW-4.md in this directory.
