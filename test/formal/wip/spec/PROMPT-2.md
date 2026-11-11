# Second review: the revised spec model

You reviewed `model/SpecHandshake.tla` against the IRCv3 spec text; your report is
`SPEC-REVIEW.md`. The model, `RULES.md`, `DECISIONS.md` (now D1-D16) and
`README.md` have been revised in response. Judge them ONLY against the spec text in
`specs-src/` (commit 9ff58d1). Do not read anything outside this directory, and do not
read `CODE-FINDINGS.md` (it is about implementations, not the spec).

Changes claimed, by your finding number:

- #1: SASL after 001 (S2 reauthentication, NEW sasl after registration, 901) is now
  explicitly out of scope (header, D2); `Reauth` is server-only (D3).
- #3: `cap-notify` added (D14): implicitly enabled, may be listed in LS, never DELed,
  a REQ of it MUST be ACKed; the client may REQ it unadvertised when `ReqCapNotify`.
  New `CapNotify.cfg`.
- #5, #9: "unable to obtain" is now event-based and sticky (D4): sasl absent from the
  final LS, sasl DELed before it was ACKed, or a REQ for sasl alone NAKed. `MaxReq` no
  longer changes it. New liveness property `RequiredQuits`.
- #6: `Terminates` and the fairness conjuncts are labelled as assumptions/design
  properties, not spec theorems.
- #7: a REQ made only of already enabled caps (or cap-notify) must be ACKed
  (`RuleRedundantAck`).
- #8: NEW/DEL only after the server has handled `CAP LS 302` (`srv.lsSeen`).
- #10: 907 takes precedence over every other opener handling; `Rule907` requires it.
- #11: `RecommendEnd` admits END while aborting (D16).
- #13: `RuleAckWhole` requires exactly one of ACK/NAK; `RuleSaslNakIfDown` requires the
  NAK; `W_RequiredUnauth` now needs a 904 first.
- #2, #4, #12: kept, but documented: atomic multi-line sends, adjacent 900/903, fixed
  client opening; README says which checking direction each config supports, and the
  header no longer claims "anything the spec permits". ACK continuation (D15).

The author reports: `Small.cfg` 7,070,803 distinct states, no error, about 3 minutes
with 8 workers; each `W_*` witness fails as expected; and each rule property fails
when the guard it mirrors is removed.

Please, briefly and adversarially:

1. For each finding above (and #14), say whether the revision fixes it, partly fixes it,
   or not, with file:line in the model and the spec.
2. Report any NEW error the revision introduced (mis-encoded rule, over- or
   under-restriction, vacuous property, broken witness).
3. Say whether the model is now fit to be the reference **server** environment for
   checking a client implementation of this subset (pre-registration, one client-first
   mechanism), and what, if anything, must change first. Its use as a reference client
   for checking servers is known to be weaker; do not repeat that.

You may run TLC on scratch copies (`java -cp ~/tools/formal/tla2tools.jar tlc2.TLC
-workers 8`); do not edit the existing files. Keep the report short: findings most
severe first. Write it to SPEC-REVIEW-2.md in this directory.
