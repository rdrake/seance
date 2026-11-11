**Not yet fit as the reference server environment.** The main scheduling repairs are real, but permitted server traces remain excluded, and separating success output introduced a lost-903 path.

Specification evidence is the local checkout at `9ff58d1342af67aff88753388f568542820c4bfe`. References: **M** = `model/SpecHandshake.tla`; **CN**, **S1**, **S2** = `specs-src/extensions/{capability-negotiation,sasl-3.1,sasl-3.2}.md` respectively.

1. **High — NEW: reauthentication can erase an owed 903.** `SrvDecide` writes 900 and records the pending 903 solely as `srv.sasl = "succ"` (M:234–246). Before 903, an authenticated opener with `Reauth = TRUE` overwrites that state with `"await"` (M:134–142). TLC reached this with one REQ, two attempts and no availability changes: success/900 queued; client aborts, gives up and retries before reading 900; server starts the second exchange. A timeout of that exchange leaves `"idle"`, permanently disabling the first success's 903. S1:79,211–213 requires it; S2:62–65 does not cancel that obligation. Keep pending success output independently of the current exchange. `RuleAuthedOpenerAnswered` passes this bad transition.

2. **High — the environment still omits legal server schedules.** M:283 forbids *every* availability change during a split ACK, including an unrelated `NEW a` while acknowledging `{sasl, cap-notify}`. NEW may occur at any time (CN:416–418), and that example changes no enabled capability. Simply removing the guard is insufficient: M:228 would then blindly re-enable a capability removed during the split; define that interaction. M:204 also prevents another REQ's reply between ACK parts even with reordering enabled. Atomic LS generation and 906+001 still prevent intervening output (M:115,265; CN:282–288,416–418; S1:84–87). These omissions need repair or a justified observation-preserving reduction. `Reference.cfg:8,12` additionally excludes reauthentication and reordering; it does not expose every server choice.

3. **D17 identifies a real ambiguity but does not prove its claimed consequence.** CN:373–382 supplies neither an ACK continuation marker nor a reply-order requirement. With overlapping pipelined REQs, a prefix can genuinely have multiple interpretations. The reported split trace demonstrates unsafe FIFO attribution, not inevitable disagreement. The chosen FIFO client is also independently broken by unambiguous reordering: TLC found `REQ sasl; REQ a`, then `ACK a; ACK sasl; 001`, with **multiline disabled and zero changes**. M:322–327 unions both replies into one buffer, matches neither oldest request and leaves both capabilities disabled. A client matching these disjoint replies by contents succeeds. This is a client artefact, not evidence of unavoidable disagreement between conforming peers.

   “Oldest outstanding” is therefore **not the only safe strategy**: serializing REQs avoids the ambiguity; disjoint requests permit content attribution; NAK membership can identify a request. With complete reply sets returned in order, without interleaving ACK sets, FIFO accumulation is sound for this model's positive set requests. Merely starting replies in order is insufficient if sets may interleave. For overlapping reordered sets, committing at an ambiguous prefix can itself violate CN:380–381; D17 cannot call that client conforming by construction. Revise `DECISIONS.md:115–123` and M:306–311, and retain reordered server behavior when checking a client instead of suppressing it to make this client pass.

4. **NEW checking defects and an unresolved send boundary.**

   - `W_SplitCross` can fire when registration preceded **both** ACK parts: M:229 tests only `srv.reg`. TLC confirmed this with one REQ/no SASL/no changes. Record registration *during* the split (CN:74–75,380–382). `W_Between` misses interpositions already drained from `sout` before 903 (M:247); remember intervening writes independently of queue occupancy (S1:79).
   - `AnswersEventually` observes an empty inbox, not an answer: the first ACK part removes the request (M:216–217,493). With finite input it is useful progress coverage, but together with M:477 it does not independently prove whole-request ACK/NAK or mandatory NAK (CN:349; S2:30–31). A silent inbox discard would pass both. The previous `RuleAckWhole` is gone, though `RULES.md:25` still cites it. The 907 checks remain vacuous in one-attempt configurations; two-attempt runs repair coverage elsewhere.
   - Enqueueing is an acceptable normative **send/write** boundary if irrevocable, with `SrvSend` interpreted as later transport delivery. Then M:228 commits on the last write, and FIFO flushing preserves 904-before-ERROR. But M:77,187 describe queued lines as unsent: under that interpretation commitment precedes the last send (CN:382), and `srv.closed` precedes sending the failure reason (M:273–276; S2:67–69). State the mapping explicitly, or move effects to transmission and distinguish closing from closed/EOF. Flushing buffered bytes during closing is reasonable; transmission after physical closure is not.

Disposition of **SPEC-REVIEW-2's numbered findings**: **#1 partly fixed** (M:112–295; CN:380–382,416–418; S1:79; issues above); **#2 fixed** for the authenticated-opener refusal (M:134–152,482–483; S2:62–65); **#3 fixed** for independent advertisement, second-opener coverage and failure-before-END (M:113,365,411,512; `TwoAttempts.cfg:4`, `Reauth.cfg:4`; CN:481–483; S1:77–87). Fairness separation is also fixed (M:436–445); client progress must remain a proof target under `EnvSpec`.

Disposition of its **table** (original finding numbers):

| # | Status | Current model; specification |
| --- | --- | --- |
| 1 | Fixed by scope reduction | M:29–32,381–385; S2:62–65. |
| 2 | Partly | M:115,204–228,283; CN:380–382,416–418; see above. |
| 3 | Fixed | M:113,200–222,373; CN:481–485. |
| 4 | Partly; exclusions remain explicit | M:25–32,88,372–373; CN:62–67,180,336–356. |
| 5 | Partly; recovery representable, service availability fixed | M:74,85–87,283–294; `Reference.cfg:5`; S1:45–48; S2:53–65. |
| 6 | Partly; fairness repaired, CN-22 coverage still overstated | M:436–445,506; `RULES.md:36`; CN:459–460; S1:39–40. |
| 7 | Fixed | M:200–222; CN:345–349. |
| 8 | Fixed | M:112–116,283; CN:413–414,447–448. |
| 9 | Fixed under D4 | M:304,408,420,491; S2:33–34. |
| 10 | Fixed for the reported refusal | M:134–152,479–483; S1:81–82; S2:62–65. |
| 11 | Fixed in model; documentation stale | M:403–411; `RULES.md:47`, `DECISIONS.md:105`; S1:37–39,84–87. |
| 12 | Partly; declared exclusions still need separate checks | M:29–34; `RULES.md:75–80`; CN:158–160,336–339; S1:55–70; S2:38–49. |
| 13 | Partly; whole-answer monitor regressed | M:469–493; CN:349,380–388; S2:30–31,67–69. |
| 14 | Partly; ordered failure witness fixed, late-reply provenance still absent | M:364–365,411,512,515; S1:77–87; S2:33–34. |

Before reference use: preserve pending 903s; cover or justify the missing schedules; correct D17 and the monitors; settle the send/close mapping; and exercise both reauthentication policies plus reordering. Use a real `EnvSpec` configuration (`Reference.cfg:1` still selects `Spec`). Replace the bundled client actions and fixed opening (M:88,424–427) with the checked client's interface, keeping client obligations as targets rather than assumptions. `RequiredQuits`/`Terminates` are not environment guarantees under server fairness alone. Repair stale D9/D15/D16 text (`DECISIONS.md:65,99,105`) and obsolete rule names (`RULES.md:25,65`).

Validation: scratch-only TLC probes with eight workers; no supplied large configuration rerun. Lost-903 probe: bounds 1/2/0, 122,140 distinct states before failure; unsplit reordered-reply probe: 2/0/0, 25,449; false split-cross witness: 1/0/0, 885. The latter two restrict initial environment/availability; ghost instrumentation does not constrain original transitions. These are counterexample probes, not conformance runs. Existing files were not edited.
