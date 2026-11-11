# Review of D27: replaying Seance's catch-up against History.tla

Read only these, and do not run TLC or tests:
- `DECISIONS.md` D22 to D27, and `HISTORY-REVIEW-4.md`.
- `model/History.tla` (v1.1) and `model/mkhist.py`.
- `SWITCH-TABLE.md`, a draft mapping of Seance's code to the model's switches. Its file:line claims are unchecked.
- Seance at `/Users/rdrake/workspace/afternet/seance-delivery-fix`: `client/js/irc/history.ts`, `catchup.ts`, `client.ts` (the self-JOIN path around line 3090), `channel.ts`, and `test/irc/history.ts`.

Please be brief and adversarial, and cite file:line for every finding.
1. Check every row of SWITCH-TABLE.md against the code. Which claims are wrong or imprecise?
2. Is D27's v0 scope enough to check refinement for reconnect mode? What does it miss? Can the restrictions hide a bug the full client would show?
3. For the three behaviours with no model value, should each get a model switch, or be reported as a client finding? Say which, and why.
4. Name the smallest set of fixtures (model run → wire) that would have caught the live-line stop bug D27 records. Would any existing config produce it, or does it need a new switch?
5. Name anything in D27 that is unnecessary for a first refinement result.

Write the report to `HISTORY-REVIEW-5.md`, verdict first. Edit no other file.
