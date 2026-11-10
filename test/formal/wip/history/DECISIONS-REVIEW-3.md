# Decisions review 3

**Verdict: Delivery.tla can be written; History.tla still needs two clarifications:** settle the timestamp insertion rule and its Order witnesses, and resolve the reconnect-switch wording/configuration conflict (findings 2–3 below). The page switches compose correctly. No further protocol reading blocks Delivery: label accounting now spans the whole run, terminal outcomes are absorbing, and finite bounds are supplied (DECISIONS.md:71–84, 207–228; DESIGN.md:51–55).

Reviewed the three current files, all three v2 diffs, both earlier reports and the eight permitted spec files as supplied. Spec prefixes below use RULES.md:13–22; no other implementation or spec files were consulted, and the claimed source commit was not independently verified.

## 1. Review-2 findings

Still inadequately answered: **1.3, 2.6, 3.2 and the History portion of 4**, limited to the order issues below. **2.1 is answered operationally**, but the table's classification vocabulary still needs the editorial cleanup in finding 2. Review-2 **1.1, 1.2, 1.4, 1.5, 2.2–2.5, 3.1, 3.3 and 3.4** have adequate answers within the selected restrictions:

- Inventory corrections: RULES.md:66, 163, 170.
- Whole-run label accounting: DECISIONS.md:73–78; DESIGN.md:135–136.
- Backward-only scope, snapshot/retention, identity/label restrictions and whole-page budget guard: DECISIONS.md:124–127, 174–203, 207–212, 232–239; DESIGN.md:29–34.
- Per-request fairness, absorbing outcomes and Delivery bounds: DECISIONS.md:218–228; DESIGN.md:51–55.
- Safe timestamp-stop assumptions and the concrete disorder witness: DESIGN.md:69–87. Empty-page and budget witnesses are explicit, and fuzz is correctly deferred rather than claimed as a failing witness (DESIGN.md:48–50, 80–90; DECISIONS.md:161–170).

## 2. Switch table: sound decomposition, incomplete inventory

**Page switches compose without contradiction.** First choose count `n`, capped by eligible-set size; then choose the newest `n` eligible messages when `Contiguous` is on, or any eligible subset of size `n` when off. This covers all four combinations, including zero and over-limit counts (DECISIONS.md:26–27, 92–95, 184–189). Exact cardinality does not imply contiguous membership. The adversarial classification of holes is appropriately cautious; count deviations are expressly permitted by CH:69, rather than merely by its lowercase “should attempt.”

**Order switches also admit a coherent product**, if stability means preserving pairwise order of existing identities, time-order means non-decreasing timestamps, and batch agreement independently constrains presentation (DECISIONS.md:28–30, 143–146). Stable plus time-ordered permits no old pair to swap; unstable plus time-ordered permits equal-time swaps; either can independently allow batch permutations. But D7 says “With both on, only equal-time messages can move” immediately after discussing stability off (DECISIONS.md:148–149). Name the switches explicitly: `TimeOrdered=TRUE, StableAcrossReconnect=FALSE` permits tie reordering; stability on forbids it. Also D8 fixes `TimeOrdered` in the “first version,” while DESIGN explicitly requires an off-setting witness: identify D8 as the positive configuration, not a global constraint (DECISIONS.md:161–163; DESIGN.md:83–87).

**The table is not complete under its own four-kind convention.** “Selected policy,” “selected” and “client choice” are not its defined kinds; mark the selected on-settings and dedupe as restrictions/allowed client policies explicitly (DECISIONS.md:11–16, 26–33). Add the fixed per-connection total-order restriction: CH:128 says SHOULD, but D5/D7 always rely on one, even with all three order switches off (DECISIONS.md:104–106, 148–149). Also inventory monotonic store times, the unknown-ID empty/FAIL restriction, and the client variants needed for witnesses: selector kind, stop-on-held versus timestamp stop, timeout disabled, and append-live versus timestamp insertion (DECISIONS.md:111–117, 157, 161, 227–228; DESIGN.md:74, 78, 118). These are bookkeeping omissions; they need no new protocol interpretation.

## 3. Order: appropriate property, incompatible witness

Non-decreasing timestamps is a defensible observable client property. It avoids claiming an unobservable total ordering of held/live equal-time messages; the spec itself distinguishes batch order, connection order and delivery order (DESIGN.md:102–107; CH:126–128). It is a selected client policy, not a MUST supplied by those SHOULDs.

**Its conditions and witnesses do not match its stated implementation.** If the client really “inserts each message by time,” processing an unsorted batch still produces a sorted buffer. Neither `TimeOrdered` nor `BatchAgrees` is necessary for that invariant, assuming the initial held buffer is sorted. The proposed unsorted-batch witness therefore cannot fail it (DESIGN.md:109–117). If the intended implementation instead preserves an entire page's internal order during a bulk merge, say so and define that merge; then these switches can matter.

The revised witness also retains the old logical mistake: `TimeOrdered` off alone can produce timestamp disorder even with `BatchAgrees` on. For example, connection order A(time 3), B(time 1), and a matching batch A,B violates timestamp order while agreeing perfectly with connection order. Conversely, `TimeOrdered` on with `BatchAgrees` off can return B(time 3), A(time 1) from a time-ordered connection A,B (DECISIONS.md:28–29; DESIGN.md:115–117). Off-settings permit these examples; they do not force disorder. Both examples fit the time and page bounds (DESIGN.md:43–47).

Appending a delayed live message can remain a valid **client-policy mutant**, but specify a lower timestamp arriving after a higher one; interleaving alone is insufficient. For example, process a page containing time 3 before appending an already-stored live message at time 1, a relay schedule allowed by D6 (DESIGN.md:118; DECISIONS.md:121–127). Under timestamp insertion that same schedule preserves Order.

Choose per-message timestamp insertion and remove the server-order failure claim, or choose a precisely defined page-preserving merge and supply the corresponding witnesses. Together with the explicit reconnect/configuration clarification in finding 2, that is exactly what still blocks writing History's transitions and checks without inventing a decision.
