# Third review: spec model v3

Your earlier reports are `SPEC-REVIEW.md` and `SPEC-REVIEW-2.md`. The model
(`model/SpecHandshake.tla`), configs, `RULES.md`, `DECISIONS.md` (now D1-D17) and
`README.md` have been revised again. Judge them ONLY against the spec text in
`specs-src/` (commit 9ff58d1). Do not read anything outside this directory; do not read
`CODE-FINDINGS.md`, `hpc/`, or the `PROMPT*.md` files other than this one.

Changes claimed against SPEC-REVIEW-2:

- Its #1 (output scheduling): the server writes to an output queue `sout`, and a
  separate `SrvSend` step sends one line at a time; a split ACK is two steps
  (`SrvAnswer`, `SrvAckRest`) with other work allowed between, and caps change only when
  the last part is written; 900 and 903 are separate steps (`SrvDecide`, `Srv903`); REQs
  wait in `srv.inbox` and, with `ReorderReplies`, may be answered in any order. ACK lines
  carry no completion marker; the client attributes ACK and NAK lines to its OLDEST
  outstanding REQ (D17). Still atomic: the lines of one LS reply, and 906+001.
- Its #2: an opener from an authenticated client is always answered (907, or with
  `Reauth` a new exchange or 904); `RuleAuthedOpenerAnswered`.
- Its #3: `LsCapNotify` and `ReqCapNotify` are separate switches; `TwoAttempts.cfg` and
  `Reauth.cfg` give the 907/reauth checks a second opener; `W_RequiredUnauth` needs a
  904 received in an exchange BEFORE END is sent (`gh.failThenEnd`).
- Fairness split into `SrvFair` and `CliFair`; `EnvSpec` uses only `SrvFair`, for when
  the model is the environment for checking a client. `RecommendEnd` was removed (D16).
- New `RuleAckCommitsLast`, `AnswersEventually`; `RuleNoSaslAckIfDown` replaces the old
  NAK rule; witnesses `W_SplitCross` and `W_Between`.

Results reported by the author (TLC, scavenge tier, `Spec`): Small 49.5M distinct
states, Reauth 26.9M, TwoAttempts 24.0M, SplitInOrder 76.1M, CapNotify 5.7M: no errors.
Split.cfg (ReorderReplies = TRUE) violates `CapsAgree`, which D17 records as a spec
gap. Reference.cfg (every server choice on except ReorderReplies) is still running.

Please, briefly and adversarially:

1. For each SPEC-REVIEW-2 finding (#1, #2, #3 and the table), say fixed / partly / not,
   with file:line in model and spec.
2. Check D17: is the Split.cfg counterexample a genuine consequence of the spec text
   (no ACK continuation marker, no reply-order rule), or an artefact of this model's
   client? Is "oldest outstanding REQ" really the only safe attribution, and is it safe
   under in-order replies?
3. Report any NEW error the revision introduced (output-queue semantics, the inbox,
   SrvAckRest commit timing, the EnvChange guard during a split ACK, flushing after
   close, ghost flags, vacuous rules).
4. Is the model now fit to be the reference **server** environment (use `EnvSpec`) for
   checking a client implementation of this subset? If not, what exactly must change?

You may run TLC on scratch copies with SMALL bounds only (the configs above take
30 minutes or more on 32+ cores; do not rerun them). Do not edit existing files. Keep
it short: findings most severe first. Write it to SPEC-REVIEW-3.md in this directory.
