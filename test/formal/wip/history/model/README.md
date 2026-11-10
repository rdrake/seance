# Delivery.tla (model v1) and its checks

`Delivery.tla` models the delivery of the client's own messages: labeled-response, echo-message
and batch, with Seance's pending copies (D15). It is built from `../DECISIONS.md` (D1, D2, D12,
D13, D15) and checks the properties in `../DESIGN.md`. v0 is kept as `.Delivery-v0.tla.ref`.
v1 answers `../MODEL-REVIEW-1.md`.

**Bounds (v1):**
- 2 labels, never recycled;
- 2 texts;
- 2 requests, each a PRIVMSG to the channel or, under `SelfMsg`, to the client's own nick;
- one labeled-response batch level, at most one batch open at a time;
- one other-session line;
- late unlabeled echoes under `Lossy` (both requests may take the late branch).

DESIGN.md promises 3 requests, depth 2 and at most one late reply. Those bounds, two interleaved
open batches, connection close, NOTICE and server-modified echoes are v2.

**What v1 changed (MODEL-REVIEW-1):**
- Deferred handling processes every buffered line, in order, at the batch end (`HandleAll`).
  Two conforming batches put a non-settling line (`note`) ahead of the echo or FAIL, so a client
  that handles only the first buffered line fails (`DM_FirstOnly`).
- A FAIL inside a batch takes the batch's label (`failB`, `noteFB`).
- Self-messages: the labeled echo plus an unlabeled delivered copy (LR-5).
- A ghost, `crossTimed`, records a timed-out request's line settling another copy, so the
  late-after-timeout story has its own witness.
- LabelOnce has negative controls: a server that answers twice (`DS_Twice`) and one that labels
  the batch's inner echo (`DS_InnerLabel`).
- ResolvedByResponse now means confirmed or failed only.
- Mutants are generated from `Delivery.tla` by `mkmut.py`; rerun it after any change.

**Where it runs:** all TLC runs on gpu05, through `../../formal-spec/hpc/tlc-bundle.sbatch`
(`RUN_ROOT` must be set) with list `list-d2`. The run tree is
`/project/def-rdrake/rdrake/formal/delivery-v2/`.

## Results (gpu05 job 10082, 2026-11-10): all 27 as expected

Each expected failure was checked against its log: the violated property is the intended one,
and no log has a parse or semantic error.

| Config | Kind | Result |
| --- | --- | --- |
| Base | positive: label-only client | pass, 6,569 distinct |
| BaseFallback | positive: fallback on, no stray unlabeled echo (only batch members, which inherit their label) | pass, 6,569 |
| BaseDeferred | positive: batch processed at its end; DeferredWaits | pass, 9,053 |
| NoTimeout | positive: only responses resolve (ResolvedByResponse) | pass, 1,861 |
| LossyTimeout | positive: Lossy on, the timeout resolves the rest | pass, 17,165 |
| BaseSelf | positive: self-messages, fallback off | pass, 27,693 |
| BaseDeferredNoTimeout | positive: Deferred, self-messages, no timeout (ResolvedByResponse) | pass, 9,949 |
| W_LossyNoTimeout | witness: Lossy with no timeout | PendingResolves violated |
| W_Other | witness: another session's same-text line | ConfirmedByOwn violated |
| W_LateFallback | witness: a late unlabeled echo settles another copy, timed out or not | ConfirmedByOwn violated |
| W_SelfCopy | witness: a self-message's delivered copy settles another self-message | ConfirmedByOwn violated |
| W_LateTimedOut | witness: a timed-out copy's late echo settles another copy | NoCrossFromTimedOut violated |
| CoverBatchOpen, CoverLateQueued, CoverTimedOut, CoverOtherSaid, CoverEchoInOpenBatch, CoverCrossTimed, CoverSelfSent | covers | each violated (reachable) |
| DM_IgnoreEcho on NoTimeout and on BaseDeferredNoTimeout | mutant | ResolvedByResponse violated |
| DM_WrongLabel on Base | mutant | ConfirmedByOwn violated |
| DM_Early on BaseDeferred | mutant | DeferredWaits violated |
| DM_Flip on LossyTimeout | mutant | Absorbing violated |
| DM_FirstOnly on BaseDeferredNoTimeout | mutant: handles only the first buffered line | ResolvedByResponse violated |
| DS_Twice on Base | server mutant: a second labeled response | LabelOnce violated |
| DS_InnerLabel on BaseDeferred | server mutant: the inner echo labeled | LabelOnce violated |

## What the witnesses say about Seance's stated policy

With the content fallback on, the policy (`settleEcho`) can confirm a pending copy on a line
that answers something else, in three ways:
- a same-text line from another session of the same account (W_Other);
- the late unlabeled echo of another copy, including one that has already timed out
  (W_LateFallback, W_LateTimedOut);
- the unlabeled delivered copy of a message to one's own nick, settling a second identical
  self-message (W_SelfCopy). This one needs neither Lossy nor another session.

With the fallback off, ConfirmedByOwn holds in every positive config. These are properties of
the stated policy, found by the model. None is yet confirmed against Seance's code by a replay
harness. What the user then sees (for example a duplicate line) is outside the model, which
has no display buffer.

## Still open (not in v1)

- Transition obligations for consuming a response: v1 checks outcome against cause, and
  resolution by a response in the timeout-free configs, but has no direct "an eligible line
  settled the copy" property.
- First-settling-line-wins: no generated batch holds two settling lines.
- Echo versus delivered copy is told apart by line position, not by a ghost.
- From MODEL-REVIEW-2:
  - TypeOK is a sanity check only, and nothing checks that the provenance ghosts stay stable
    or that failed and accepted outcomes are the copy's own;
  - a client that ignores ACK is not caught (ACK is reachable only under Lossy, where the
    timeout resolves the copy);
  - FAIL and 4xx share one abstract kind;
  - DS_Twice shows a duplicate labeled send, not specifically one after completion or timeout;
  - W_SelfCopy shows the delivered copy settling another self-message, but not that A's own
    labeled echo settled A first (A may have timed out); that needs a role ghost;
  - PendingResolves is still dominated by the timeout, and sending is optional.
- Before History joins: reference-indexed batch state with parent membership, interleaving
  and depth-two nesting, competing settling lines in both orders, consumption obligations,
  timeout and close races, matching DESIGN's bounds, and a typed History-response interface so
  replayed PRIVMSGs never confirm outgoing copies.
- The review's v2 list: interleaved batches with a reference-indexed map, connection close,
  NOTICE with kind-sensitive fallback, server-modified echoes.
