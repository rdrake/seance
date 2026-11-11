**Not yet ready as the reference server.** The v3 scheduling repairs largely work, but local closure can still suppress a required 903, and one success ordering remains excluded.

Reviewed against `specs-src/` at verified commit `9ff58d1342af67aff88753388f568542820c4bfe`. References below: **M** = `model/SpecHandshake.tla`; **CN**, **S1**, **S2** = `specs-src/extensions/{capability-negotiation,sasl-3.1,sasl-3.2}.md`. No prohibited review inputs were read.

1. **High — 903 survives exchange changes, but not server-initiated closure.** TLC found: first success sends 900, still unread; a second opener starts an exchange; its timeout sends 904; `SrvFailClose` sends ERROR with `owe903 = 1`. `Srv903` is then permanently disabled (M:278–281,285–288,316–319). This loses the success's 903 required by S1:79,211–213; S2:67–69 permits failure-related disconnection but supplies no waiver of that earlier success output. `RuleOwed903` passes because the counter remains unchanged; `OwedSent` explicitly accepts closure (M:580–582,597–599). **Drain owed success output before local ERROR**, and distinguish peer QUIT from local closure in the obligation checks. The original probe's green result does not establish delivery of every owed 903.

2. **High — a permitted success ordering is still missing.** `SrvDecide` always writes 900 before enabling any 903 send (M:268–281). S1:79,199–213 requires the two numerics but does not require that order. Thus `903; 900`, including intervening output, remains untestable. This was already noted in the first review's scheduling finding. **Expose both orders, or justify an observation-preserving reduction for the actual client properties.** D20's `900; 001; 903` repair does not settle this.

3. **Medium — the restored monitors overclaim their strength.** `RuleOwed903` checks only implications from counter changes, not that each 900 increments it or each 903 decrements it exactly once (M:580–582). A scratch mutant replacing the increment with no change passed **all** ProbeLost903 invariants/properties under a restricted initial state: 168,068 distinct states. Require the exact accounting equation against sent 900/903 events. Similarly, `RuleAckWhole` only requires a nonempty ACK when a split disappears; it never checks that this line is that split's remaining requested caps (M:544–555). Tie opening/completion to the actual request and partition. `AnswersEventually` now covers open splits, but cannot supply missing content checks (CN:349,380–388).

4. **Medium — interleaved splits remain unexercised by the supplied client.** There are three cap names (M:63–65); disjoint outstanding REQs (M:429–433) and nonempty proper partitions (M:71,240–246) require four distinct names to open two simultaneous splits. Consequently `Len(srv.acking) <= 1` holds regardless of larger request bounds. `W_Interleave` proves another REQ was answered during a split, not that two splits overlapped (M:234,627; CN:373–382). Add a fourth cap and a two-open-splits witness if claiming that coverage. This is a coverage limitation, not a counterexample to D17.

**D17/D18:** Content attribution is sound for the model's nonempty, partitioned ACKs and pairwise disjoint outstanding REQs (M:355–396,427–433; CN:349,373–382). DEL does not shrink the identifying request; NEW does not clear its cancellation history. For each split, the server commits `R` minus caps DELed between its parts; FIFO receipt makes the client accumulate exactly the same exclusions. Other REQs' parts cannot contaminate that request. This argument also works for genuinely interleaved disjoint splits, although the current cap universe cannot exercise them.

D18 is a reasonable **chosen interpretation**, not a rule explicitly supplied by the spec (CN:380–382,450–457). Its last-part exemption is honest: the decision to accept was made while SASL was available; completion reports the remaining names without enabling the cancelled cap. The comments explicitly narrow the checks (M:561–572). Do not describe `RuleNoSaslAckIfDown` as prohibiting every ACK line naming unavailable SASL. Also qualify D18's “DEL before any part ... makes the REQ un-ACKable”: DEL followed by NEW before the first part makes it ACKable again (M:225,328–342; CN:416–418).

**Disposition of SPEC-REVIEW-3:**

| Finding | Judgment; current model and spec evidence |
| --- | --- |
| #1, lost 903 | **Partly.** Independent counter repairs reauthentication overwrite; closure still strands it. M:149–157,268–281,316–319; S1:79,211–213. |
| #2, schedules | **Partly.** NEW/DEL, other replies, LS rest and 906/001 intervals are present; success order remains restricted, overlapping splits lack coverage. M:211–264,294–343; CN:282–288,380–382,416–418; S1:79,84–87. |
| #3, D17/client attribution | **Fixed** for disjoint REQs. M:355–396,427–433; CN:349,373–388; `DECISIONS.md:107–120`. |
| #4, checking/boundary | **Partly.** Witness bookkeeping and send mapping repaired; answer monitor restored but incomplete. M:118,246,263,490–510,544–599; CN:349,380–388; S1:79; S2:30–31,67–69. |

The previous closing list, item by item:

| Before reference use | Judgment |
| --- | --- |
| Preserve pending 903s | **Partly**, finding 1. M:278–281,316–319; S1:79. |
| Cover/justify missing schedules | **Partly**, findings 2/4. M:211–343; CN:380–382,416–418; S1:79. |
| Correct D17 and monitors | **Partly**: D17 fixed; monitors need finding 3. M:355–396,544–582; CN:349,380–388; S1:79. |
| Settle send/close mapping | **Fixed** as a mapping: appending is sending, later FIFO delivery can flush ERROR. M:13–18,203–207; CN:382; S2:67–69. Finding 1 is a separate obligation defect. |
| Exercise both reauthentication policies and reordering | **Fixed in configuration coverage**, not an exhaustive validation claim. `model/TwoAttempts.cfg:4,8,12`, `model/Reference.cfg:4,8,12`; M:149–157; S1:81–82; S2:62–65. A small probe reached 907. |
| Use an actual EnvSpec configuration | **Fixed.** `model/Reference.cfg:1`, `model/RefSafety.cfg:1`; M:507–516; no client fairness assumed. |
| Replace bundled client/fixed opening with checked interface; make client obligations targets | **Partly**: documented, not integrated. M:89,427–498; `README.md:56–58`; CN:62–67; S2:33–34. |
| Do not assume RequiredQuits/Terminates as environment guarantees | **Fixed.** M:590,611–613; `model/Reference.cfg:15–19`, `README.md:39–42`; S2:33–34. |
| Repair stale D9/D15/D16 and rule references | **Fixed** for the reported stale text. `DECISIONS.md:65,99,105`, `RULES.md:25,47,65`; CN:373–382; S1:37–39,84–87. |

**Other new machinery:** No fairness defect found in `G`: every Next branch and fairness action uses the same total ghost update (M:490–513). The LS rest filters current availability correctly (M:213; CN:202–204,282–288); DEL→NEW may restore a remainder cap, despite the stronger “never lists a cap DELed after the first line” comment. `reg` may linearize registration after writing 906 while 001 remains pending (M:301–312; S1:84–87); a REQ processed subsequently need not reopen a completed registration. This is not independently a hold violation. `W_SplitCross` now measures 001 between the parts correctly. `W_Between` can also fire on ERROR while a 903 remains owed forever: its failure alone does not prove a completed 900/interposition/903 trace (M:490–491,625). `Rule907` remains intentionally vacuous with Reauth TRUE.

**Reference readiness:** Repair findings 1/2 before treating this server as the reference for the declared subset. Strengthen finding 3 before relying on the monitors for implementation checks; address finding 4 for any overlapping-splits claim. Then substitute the implementation's client actions/opening without importing CliFair or assuming disjoint requests of a client that does not enforce them. Nothing prevents running large configs diagnostically now, but they cannot fix these defects; repair 1–3 first to avoid expensive misleading green results.

Validation: scratch-only TLC, four workers, all runs under 30 seconds. Bounds 1/2/0: stranded-903 invariant failed after 12,840 distinct states; the unmodified model's supplied properties passed at 360,920; no-increment mutant passed at 168,068; 907 witness reached at 6,712. Bounds 2/0/0: at-most-one-open-split invariant passed at 316,888. Initial predicates were restricted to the relevant environment/availability; transition relations were unchanged except for the named mutant. No supplied large config was run; existing files were not edited.
