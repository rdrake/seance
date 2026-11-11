# History and delivery: scope and design (before any TLA+)

The rules are in `RULES.md`. This file fixes what gets modelled, at what bounds, and how
Seance is checked against it. It is settled before any action is written.

## Two models, not one

The two areas share almost no state, and their product is what blew up v5 of the handshake
model.
- **Delivery** (`Delivery.tla`): labels (LR), echo-message (EM), batch framing (BA) and
  Seance's pending messages.
- **History** (`History.tla`): the server's store, paging (CH-10 to CH-14, CH-19), msgid reuse
  (MI-4, CH-18), the client's dedupe and gap fill (CH-23), and live messages racing a
  catch-up page.

The one joint is a labeled reply of several lines (LR-4, BA-8): a `chathistory` batch carrying
the label, or one inside a `labeled-response` batch. Delivery keeps it abstract, as "a batch
response to a labeled request". History uses the unlabeled matching.

## What Seance sends (the subcommands modelled)

From `client/js/irc/history.ts`, `catchup.ts` and `historysearch.ts` (seance main, 9bd098a22):

| Use | Command | Modelled |
| --- | --- | --- |
| First JOIN | `LATEST <target> * 50` | yes |
| Catch-up after a reconnect | `LATEST`, then `BEFORE <oldest of page>` until overlap (a held msgid, or older than the floor minus 5 s), `draft/chathistory-end`, an empty page, or 5 pages | yes: the core |
| Older messages (`more`) | `BEFORE <oldest held> 100` | yes |
| Past view, paging forward | `AFTER` (`pastView.ts`, `pastRows.ts`) | no: a restriction to the catch-up path (D9) |
| Search context | `AROUND msgid=… 1` | no (search) |
| Channel order | `TARGETS` | no at first (one target) |

The model's server answers LATEST and BEFORE only. The rules for the others stay in RULES.md
for later.

## Bounds (Tiny.cfg is written first)

Review 1 (3.5) showed v1's bounds could not reach every witness: with four stored messages,
pages of two and a cap of two pages cover the whole store. The bounds are now per config, each
named in its header comment.

- One target, one channel, one reconnect.
- Times are integers. Two values, 1 and 3, so ties exist and a floor can fall between them
  (`Fuzz` is 0 or 1).
- Held before the gap: 1 or 2 messages. Gap: 1 to 3 messages. One extra live message during a
  query (D6). That makes at most 6 stored.
- `Limit` is 1 or 2. `Budget` is `pages(1..5)` or `messages(2..4)` (D14). Seance's page cap is 5, and most History configs use it. The budget witnesses use `pages(2)`. (This was `pages(1..2)` before HISTORY-REVIEW-1.)
- The budget-exceeded witness uses `Limit = 1` and `pages(2)` with a gap of 3.
- There is no fuzz witness in the first version (D8). Floor times are chosen so that both
  "stop" and "continue" are reachable, as coverage only.
- **Delivery's bounds:**
  - at most 3 requests, with labels from a pool of 3 that is never recycled (D12);
  - batch nesting depth 2 (a `chathistory` batch inside a `labeled-response` batch);
  - at most 1 delayed or late response in flight (`Lossy`'s late unlabeled reply);
  - one self-message case (LR-5).

## Properties are conditional, each with a failing witness

CH-6 lets a server return fewer messages than asked, so an unconditional "no loss" is false.
Every user-level property is stated under the switches it needs (DECISIONS.md), and each gets a
witness that fails when one of them is off.

Every "after catch-up" property is paired with a reachability check: a run that completes the
catch-up with a nonempty gap must exist. Termination of the catch-up is checked on its own.

**Ghosts and coverage.**
- Both models carry ghost history: per label, a count of labeled sends, and `sent`/`got`
  sequences as in Seance's `Handshake.tla`. Witnesses then show the causal story, and an MBT
  config can dump traces for a `replay.ts`-style harness.
- Each witness config is the positive config with one named switch flipped, and its header
  says why it is reachable.
- Every interesting state gets a cover invariant: a nested batch open, a late unlabeled reply
  in flight, a timeout before the response, a live line inside a page. Then a pass cannot hide
  an unreachable case.
- The label pool is never a SYMMETRY set in a config that checks liveness.

**NoLoss.** Once catch-up completes, every message stored during the gap is in the buffer.

Holds when all of these hold:
- `ExactCount` and `Contiguous` (D3, D10);
- `BatchAgrees` (CH-19). With msgid anchors and contiguous, exact pages, a batch in another order skips nothing but wastes pages, so it causes a loss only through the budget (History v0: `HNoBatchAgrees` passes with `pages(5)`, `W_BatchBudget` fails with `pages(2)`);
- `TimeOrdered`, with times non-decreasing along the store (D7, D8). The spec's timestamp
  stop (`earliest.timestamp < lower_bound`) is safe only if no unseen gap message lies behind a
  page whose oldest message is below the floor;
- msgid anchors (D5, D11);
- chathistory-end, if sent, is truthful (D9);
- no FAIL or timeout cuts the paging short (D5);
- the budget covers everything fetched (D14);
- for a stop-on-held rule, `StableAcrossReconnect` (D7).

Witnesses:
- **An empty page while eligible gap messages remain** (`ExactCount` off). A short but nonempty
  contiguous page loses nothing in the spec's loop, so it is not a witness.
- **`TimeOrdered` off** (review 2, 3.1):
  - A is held at time 1, then H at time 3;
  - G is stored during the gap at time 3;
  - the reconnect orders them G, H, A;
  - `LATEST * 1` returns A, below the floor of 3, so the loop stops and misses G.
- **The D7 reorder**, for the stop-on-held rule.
- **A timestamp anchor across a tie** (D5).
- **The budget exceeded:** `Limit = 1`, `pages(2)`, a gap of 3.

**NoDup.** No msgid twice in the buffer.

Holds when the client dedupes by msgid.

Witnesses:
- a non-deduping client, with a message both relayed live and in the page (D6).

A server that mints new ids on replay breaks CH-18's MUST. It is a *mutant*, caught by a
content-identity check, not by NoDup.

**Order.** When catch-up completes, the buffer is non-decreasing in time.

This is an observable client property, and a client restriction rather than a MUST. Equal-time
messages are not claimed to be in the server's order: the client sees that order only as
positions within a batch, and no oracle for server ranks is modelled.

The checked client inserts each message, page line or live line, by its time. Given a sorted
held buffer, that keeps the buffer sorted **whatever the server's order**, so `TimeOrdered` and
`BatchAgrees` are not conditions of Order. They matter only to NoLoss.

Witness (a client-policy mutant):
- a client that appends in arrival order;
- the schedule processes a page containing a message at time 3, then appends a live message
  stored earlier at time 1, which D6 allows;
- under time insertion the same schedule keeps Order.

It is checked at completion, not continuously.

**PendingResolves.** Every sent message reaches exactly one terminal outcome (D15:
confirmed, accepted, failed or timed out), eventually, and keeps it (D13).

Holds when:
- the client's processing and timeout are weakly fair, per pending request (D13);
- labels are fresh (D12).

Witness:
- `Lossy` on with no client timeout: a request pending forever. The same request resolves
  when the timeout is on.

A weakly fair timeout resolves every request whatever the client does with labels, so
PendingResolves alone is nearly vacuous. Two more checks the timeout cannot satisfy:

**ResolvedByResponse** (liveness). With `Lossy` off and the timeout off, every request ends
confirmed or failed. Fair sending, delivery and processing stay on.

**OutcomeMatchesCause** (safety, review 5). Each outcome matches what settled it:
- confirmed by an echo;
- failed by a fail;
- accepted by an ACK;
- timed out by the timeout.

Without this, a client that fails every request would pass ResolvedByResponse.

**ConfirmedByOwn** (safety). A copy is confirmed only by a line answering its own request. It
holds with the fallback off. With it on, it holds only if no unlabeled same-text line can arrive
(D15).

**DeferredWaits** (safety, review 5). Under `Deferred`, nothing is settled by a line of a batch
that is still open. ConfirmedByOwn cannot catch an early settle, since the echo is the copy's
own. A cover shows an echo can wait in an open batch.

Mutants, all caught in model v0 (gpu05 job 10080):

| Mutant | Change | Caught by |
| --- | --- | --- |
| DM_IgnoreEcho | a labeled echo settles nothing | ResolvedByResponse |
| DM_WrongLabel | a labeled echo settles the oldest same-text copy | ConfirmedByOwn |
| DM_Early | under `Deferred`, inner lines are handled as they arrive | DeferredWaits |
| DM_Flip | a settled copy can be settled again | Absorbing |

**LabelOnce** (D2). Over the whole run, at most one labeled logical response per label,
including after a timeout or a complete response.

## Decisions

D1-D14 and the switch table are in `DECISIONS.md` (v3, after review 2).

## Validation and refinement

- **Live, per server:** first confirm that nefarious2 (nef-formal, HEAD image) and Ergo store and
  replay a plain channel's history with no accounts. Then read `CHATHISTORY=`, `MSGREFTYPES=`
  and the retention.
  - The harness needs a sender and an observer connection, and it knows what it sent, so the
    store is known.
- **Seance:** there is no code model of `catchup.ts` or `history.ts`. Rather than hand-write
  one, drive the real code with model-generated server behaviour, the way
  `test/formal/handshake/replay.ts` does for the handshake.
  - TLC enumerates server answers within the bounds, and a mocha harness feeds each one to
    `IrcClient`.
  - The checks are the model's properties, taken on Seance's buffer.
  - This is cheaper than a second TLA model of the client and closer to the code.
