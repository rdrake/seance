# Seventh review (short): spec model v7

Your earlier reports are `SPEC-REVIEW.md` to `SPEC-REVIEW-6.md`.

- Judge ONLY against the spec text in `specs-src/` (commit 9ff58d1).
- Do not read anything outside this directory.
- Do not read `CODE-FINDINGS.md`, `ERGO.md`, `NEFARIOUS.md`, `hpc/`, or the `PROMPT*.md` files
  other than this one.

v7 changes `model/SpecHandshake.tla` in four places. v6 is `model/.SpecHandshake-v6.tla.ref`;
`diff` them. Each change comes from a run of a real server, or of a client, that v6 rejected
(`DECISIONS.md` D22-D25):

1. **D22.** The first of two LS lines may hold any part of the offered set, including all of it or
   none (`LsSplits`). The model's caps are an abstraction, and a real line can list only other caps.
2. **D23.** The opener moves the server to a new state, `open`. `SrvChallenge` (weakly fair) sends
   `AUTHENTICATE +` later. Timeout, abort, registration and a DEL of sasl act on `open` as on
   `await` (`Active`). With the backend down, the opener still gets 904 in the same step. The
   reauth branch is unchanged.
3. **D24.** A response that finds no exchange (`SrvData` while idle, and not `Late907`) is ignored,
   or is handled as an opener (`SrvMech`).
4. **D25.** A client that does not want SASL may send END before LS is complete (`CEnd`).

Four new witnesses (`W_LsAllFirst`, `W_FailBeforeChal`, `W_StrayOpen`, `W_EarlyEnd`) each fail on
Tiny's bounds as intended. The local regression (probes, Tiny, TinyEnv, mutants) is running and
its numbers are not in yet. Treat them as unconfirmed.

Please, briefly and adversarially:

1. Is each change supported by the text it cites, and is it no wider than that text allows? In
   particular:
   - D24: can a stray response now produce something the spec forbids, for example an
     `AUTHENTICATE +` that a conforming client would mistake for its own exchange's challenge?
   - D25: does END before LS now let a client that requires SASL (S2-3) slip through?
2. Does `open` break any existing property, or make one vacuous? Look at `RuleAuthedOpenerAnswered`,
   `Rule907` with `Late907`, `AnswersEventually`, `OwedSent` and the D12 correlation note, and at
   the liveness of an exchange that stays `open` while the backend is up.
3. Is `SafetyView` still sound with `open`? Is the 12-way environment split still a partition of
   Init? Do the seven mutants (`model/mutants/make-mutants.py`) still mutate what they claim to?
4. Any new error. Mark each finding blocking or minor. Say whether v7 can replace v6 for the HPC
   safety slices, `RefLiveness` and the six mid-size configs.

You may run TLC on scratch copies with SMALL bounds only (under ten minutes each). Do not edit
existing files. Keep it short. Write it to `SPEC-REVIEW-7.md` in this directory.
