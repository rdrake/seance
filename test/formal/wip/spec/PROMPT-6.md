# Sixth review (short): spec model v6

Your earlier reports are `SPEC-REVIEW.md` to `SPEC-REVIEW-5.md`. Judge ONLY against the spec text
in `specs-src/` (commit 9ff58d1). Do not read anything outside this directory; do not read
`CODE-FINDINGS.md`, `hpc/` other than `hpc/split-env.py`, or the `PROMPT*.md` files other than this one.

v6 changes `model/SpecHandshake.tla` in two places only (v5 is `model/.SpecHandshake-v5.tla.ref`;
`diff` them):

1. **D21** (`DECISIONS.md`): with `Reauth = FALSE`, any AUTHENTICATE line (response or `*`) that
   reaches the server after a successful login, with no exchange running, gets 907 (`Late907`,
   `SrvData`, `SrvAbort`); `Rule907` now covers all three line kinds. Found by trace validation
   against Ergo (`conformance/`): a client that sent its response and `*` together got 900, 903,
   907, which v5 rejected (it allowed only 906 or nothing for that `*`).
2. **SafetyView**, a VIEW for safety runs only, dropping `gh`, `gc.between` and the `reg0` field
   of open splits. Safety runs are also split by environment into 12 slices
   (`hpc/split-env.py`: Init pinned per slice, fairness dropped, VIEW added).

Reported by the author (TLC, Mac): every Ergo trace (105 client schedules) is a v6 behaviour;
three tampered traces are rejected; all 7 mutants are still caught under VIEW plus split, by the
same property as before; the local regression passes: probes (Lost903 9.86M distinct states, Reorder 75.9K, SplitCross 26.7K, TwoSplits 23.4M, DelSplit 7.37M), Tiny and TinyEnv (10.8M each), the four v5 witnesses fail as expected, and the 7 mutants are caught unsplit too.

Please, briefly and adversarially:
1. Is D21 the right reading of S1:81-82? Is it over-strict anywhere (for example a 907 for a
   line from an exchange the server already ended by timeout, abort or DEL, or with `Reauth`)?
2. Is SafetyView sound for every invariant and Rule* property in `RefSafety.cfg` (no checked
   property reads a dropped component, directly or through an operator)? Is the environment split
   a partition of Init, and is dropping fairness sound for those properties?
3. Is SYMMETRY over `OtherCaps` sound (no action, invariant or property depends on a particular
   non-sasl cap name)? It is used only with two other caps and only for safety.
4. Any new error. Does anything block running RefSafety (MaxEnv = 1, split, VIEW), Small,
   TwoAttempts, Reauth, CapNotify, Split and SplitInOrder on v6? Mark each finding blocking or minor.

You may run TLC on scratch copies with SMALL bounds only (under ten minutes each). Do not edit
existing files. Keep it short. Write it to SPEC-REVIEW-6.md in this directory.
