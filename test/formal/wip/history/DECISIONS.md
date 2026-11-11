# History and delivery: decisions (v3, after review 2)

Each entry settles a reading the text leaves open, says why from the text, and says how the
model shows it. References are file:line under `../formal-spec/specs-src/`, with the prefixes in
`RULES.md`.

Where the text allows more than one behaviour, the model gets a switch, and the behaviour a
property depends on gets a witness. Reviews 1 and 2 (`DECISIONS-REVIEW-1.md`, `-2.md`) shaped
v2 and v3. The older versions are kept as `.DECISIONS-v1.md.ref` and `.DECISIONS-v2.md.ref`.

**What the model is.** The model is a set of environments for a client algorithm. Every switch
and fixed choice is one of four kinds:
- **guaranteed:** a MUST;
- **allowed:** something the text permits;
- **adversarial:** worse than the text permits, to show the client copes;
- **restriction:** narrower than the text, chosen to keep the model small.

A property holds only under the settings it names. Nothing here claims more.

## Switches and fixed choices

| Name | Off / on | Kind | Text |
| --- | --- | --- | --- |
| `Lossy` | on: a response may be dropped, cut short or sent unlabeled | adversarial | LR:53, LR:76-83 (D1) |
| `Deferred` (client) | process lines as they arrive, or at the batch end | allowed, both checked | BA:55, BA:63 (D2) |
| `ExactCount` | on: a page has exactly `min(limit, eligible)` messages; off: any number from 0 to `min(limit + 1, eligible)` | on: restriction; off: allowed (CH:69 permits more or fewer) | D3 |
| `Contiguous` | on: a page holds the messages nearest the selector; off: any eligible subset | on: restriction; off: adversarial (the text grants no license for holes) | D10 |
| `TimeOrdered` | on: the connection's order agrees with time order | on: restriction; off: allowed (CH:126 is a SHOULD) | D7, D8 |
| `BatchAgrees` | on: the order within a batch is the connection's order | on: restriction; off: allowed (CH:128 is a SHOULD) | D7 |
| `StableAcrossReconnect` | on: the new connection keeps the old order, extended | on: restriction; off: allowed (CH:128 promises one connection only) | D7 |
| `SendsEnd` | per response: tag truthfully, or omit | allowed | CH:136 (D9) |
| `Budget` (client) | `pages(k)` or `messages(m)` | client restriction | D14 |
| Dedupe (client) | the client dedupes by msgid, or not | allowed client policy (on is the checked client; off is a witness) | MI:39 |
| Selector kind (client) | msgid anchors, or timestamp anchors | msgid: restriction (the spec's loop); timestamp: witness client | D5 |
| Stop rule (client) | the spec's timestamp floor, or also stop on a held msgid | both allowed client policies; the second needs `StableAcrossReconnect` | D7 |
| Timeout (client) | on, or off | on: restriction (the checked client); off: witness client only | D13 |
| Content fallback (client) | an unlabeled echo settles the oldest unsettled copy with the exact same text, or nothing | on: allowed client policy (Seance's `settleEcho`); off: a label-only client | D15 |
| Other session (environment) | another session of the account may send the same text to the same target | allowed | D15 |
| Merge (client) | insert each message by time, or append in arrival order | insert: restriction (the checked client); append: witness client | DESIGN.md, Order |
| One total order per connection | fixed | restriction (CH:128 is a SHOULD; D5 and D7 rely on it under every switch) | D5, D7 |
| Store times non-decreasing (no skew) | fixed in the first version | restriction | D8 |
| Unknown msgid selector gets an empty batch or FAIL | fixed | restriction (a chosen subset) | D5 |
| Snapshot at query execution | fixed | restriction | D6 |
| No expiry during a run | fixed | restriction | CH:32 (D10) |
| PRIVMSG only, no event-playback, no context | fixed | restriction | D3 |
| msgid and time on every message, all caps, both reference types | fixed | restriction | D11 |
| Fresh labels, never reused | fixed | client restriction | D12 |
| Weak fairness of delivery, processing and timeout | fixed | restriction | D13 |
| BEFORE and LATEST only (no AFTER, AROUND, BETWEEN, TARGETS) | fixed | restriction | D4, D9 |

## D1. "Where it is feasible" (LR-2)

LR:53 requires the label on any required response "where it is feasible to do so". LR:76-83
(non-normative) illustrates infeasibility with an asynchronous remote command during a
netsplit. There the server may send:
- a labeled ACK instead of the reply;
- nothing;
- a batch that ends early;
- the reply later, without a label.

**Reading.** The text does not let a server drop the label from a response it could label. For
Seance's PRIVMSG to a channel on one server, the response is always feasible.

**Model.** `Lossy` is adversarial. Per request, the server may send:
- the full labeled response, or a labeled ACK;
- a labeled batch with fewer lines than the full response, still closed (BA:54 holds
  regardless);
- nothing;
- the reply later, unlabeled.

It never puts one request's label on another's response. What each response does to a pending
message is D15's outcome table. A late unlabeled reply can settle one through the content
fallback, so D1 no longer says it resolves nothing.

## D2. One logical message (LR-3, LR-4)

LR:53 puts the label in "exactly one logical message". LR:55-58 makes a reply of several lines a
batch, with the label on the batch start. The inner lines carry `batch=`, not the label (BA:51).

**Model.**
- A response is either one labeled line, or a labeled batch whose inner lines are unlabeled.
- **Invariant, over the whole run:** for each label, the server sends at most one labeled line
  or labeled batch start, ever. That includes after the client's timeout and after a complete
  response, since LR:53 allows no second labeled response after either. Labels are fresh
  (D12), so this is per request.
- The invariant counts the server's sends. Whether the client still holds a pending entry is a
  separate matter.
- `Deferred` decides when the pending entry is resolved:
  - processing at once: by the echo line;
  - processing deferred: by the batch end.
  Both are checked.
- Mutant: the server also labels an inner line, or sends a second labeled response late. The
  invariant must catch both.

## D3. What is replayed, and how many (CH-6, CH-9, CH-20)

**Restriction:** only PRIVMSG is stored and replayed, `draft/event-playback` is not negotiated,
and the server sends no context messages. NOTICE, event lines and `draft/chathistory-context`
(CH:73, CH:132) are not exercised.

**Count** is `ExactCount`, and the size of a page is always capped by the number of eligible
messages. **Eligibility** is mandatory under every switch. Every returned message lies on the
right side of the selector, and the anchor itself is excluded (CH:83, CH:95). An ineligible
message in a page is a mutant, not a switch. Which eligible messages a page holds is D10.

## D4. BETWEEN (CH-14)

BETWEEN is out of the model, because Seance does not send it. CH:111 already settles its
direction: counted from, and excluding, the first selector toward, and excluding, the second.

## D5. Selectors and message identity (CH-10 to CH-12, CH-19, MI-5)

A msgid is an **identity**: one per message, opaque and permanent (MI:35, MI:41, CH:126). Its
**position** comes from the current connection's order (D7). A msgid selector is placed by
looking up its message's position in that order.

**Timestamp selectors** exclude by time: `BEFORE timestamp=t` returns only messages with time
< t (CH:83). A msgid selector excludes just that message.

**Witness.** A client that pages BEFORE with timestamp anchors across a tie loses a message. The
spec's full-support loop pages by msgid (CH:208), so this witness is about a timestamp-paging
client.

**An unknown msgid selector.** The text has no rule; the closest is CH:155-157's MESSAGE_ERROR.
The model's server replies with an empty batch or FAIL. That is a chosen subset of what the text
allows. The client stops paging on either, and that is client policy.

## D6. Live messages during a query (CH-23, BA-9)

A live message may be relayed, unbatched, before, between or after a history batch's lines
(BA:93-98, CH:214).

**Snapshot (restriction).** The query sees the store as it is at the step where the server
executes it. A message stored before that step is a candidate, which then still has to be
eligible for the selector (D3) and is chosen by D10. A message stored after it is not a
candidate.

**Witness.** A message stored before the snapshot, relayed live after the batch starts and
included in the page gives a non-deduping client a duplicate.

## D7. Order across connections (CH-19, CH-23)

CH:128 promises a consistent order only "across the lifetime of a single connection".

The full-support loop (CH:192-208) anchors every BEFORE on a msgid from a page of the current
connection, and uses the previous session only through a timestamp `lower_bound` minus
`FUZZ_INTERVAL`. Infinite scroll (CH:218-220) does anchor BETWEEN on a previous-session
msgid, so the text does use earlier identities as anchors. The claim is therefore narrow: the
gap-fill loop never needs the order to persist across a reconnect, while a client that stops
on meeting an earlier connection's msgid does.

**Model.** Three independent switches:
- `TimeOrdered` sets whether the connection's order agrees with time;
- `BatchAgrees` sets whether a batch's order is the connection's order;
- `StableAcrossReconnect` sets whether the order carries over to the next connection, that is,
  whether every pair of existing messages keeps its relative order.

The combinations at reconnect:
- **`StableAcrossReconnect = TRUE`:** no existing pair swaps, whatever `TimeOrdered` says.
- **`StableAcrossReconnect = FALSE, TimeOrdered = TRUE`:** only equal-time messages can swap.
- **`StableAcrossReconnect = FALSE, TimeOrdered = FALSE`:** any total order.

`BatchAgrees` independently constrains how a batch presents its messages, under every
combination.

**Witness (review 1, 2.7).** All four messages have one time. H1 and H2 are held; G and B arrive
during the gap. The order H1, H2, G, B becomes G, H1, H2, B on reconnect. `LATEST * 2` returns
H2, B, and a client that stops on the held H2 misses G.

**Expected.**
- The spec's loop needs `TimeOrdered` for its timestamp stop (DESIGN.md, NoLoss).
- A stop-on-held-msgid rule needs `StableAcrossReconnect` as well.

## D8. Clock skew (CH-24)

The first version is one server with times non-decreasing along the store. `TimeOrdered = TRUE`
is the positive configuration NoLoss is checked in, not a global constraint: the NoLoss witness
turns it off. That is a **chosen environment**, not something one server guarantees: CH:126 and CH:128 are
SHOULDs.

With no skew and a monotone time order, `FUZZ_INTERVAL` has no loss to prevent. So the first
version has **no fuzz witness**, only coverage that both "stop" and "continue" are reachable.

A later revision adds skew as a bound on *total* backward displacement: a message's time may be
up to `Skew` below the latest time stored before it. The conjecture for that revision is that
the spec's loop needs `Skew <= Fuzz`, and that revision gets the fuzz witness.

## D9. chathistory-end (CH-21)

CH:136: the tag means the next page in the same direction "will return an empty batch". Only
BEFORE and LATEST are modelled (backward paging, see the table), so "the same direction" is
older.

- `SendsEnd` is decided per response: the tag is sent truthfully or omitted.
- Sending it while older eligible messages remain is a mutant.
- AFTER is out of the model, and DESIGN.md no longer lists it.

## D10. Page selection, snapshots and retention

- With `Contiguous` on, a page is the eligible messages nearest the selector in the
  connection's order. For BEFORE and LATEST, those are the newest. The count is set by
  `ExactCount`.
- With `Contiguous` off, a page is any eligible subset of the allowed size. That is
  **adversarial**: CH:69 allows count deviations "due to implementation constraints", not
  holes. It exists to show what the client's loop depends on.
- The **snapshot** is the restriction in D6.
- **Retention** is a restriction: no message expires during a run. CH:32's "if they are still
  available" becomes a later switch.

## D11. What identities and types are available

This is a **restriction**:
- every stored PRIVMSG has a msgid and a time;
- the client has batch, server-time, message-tags and echo-message;
- both reference types are supported.

The text is wider: MI:31 makes msgid a MAY, ST:41-42 makes time tags optional, CH:39 has servers
not enforce the caps, and CH:51-56 covers the reference types. D5's timestamp-paging witness
is the one place timestamp anchors are exercised.

## D12. Labels, reuse and late responses

**Client restriction.** Every request gets a fresh label, `s<n>` in Seance, and labels are
never reused. LR:64's SHOULD NOT then holds by construction. The model allocates labels from a
finite pool, one per request, with no recycling (DESIGN.md bounds).

A request that timed out stays timed out. A labeled response that arrives for it later is
ignored. The D2 invariant still counts that late response.

## D13. Processing and termination

- **Partial responses.** Under `Lossy` a batch may be partial, but it is always closed. A
  missing closure breaks BA:54, so it is a mutant.
- **Fairness (restriction):**
  - per pending request, the server's sending of an owed response, the client's processing
    of received lines, and the client's timeout are each weakly fair;
  - under `Lossy`, the drop is chosen in the same step as the send and needs no fairness.
- **Terminal outcomes are absorbing.** A request is confirmed, failed or timed out. Once it has
  one of these, later lines never change it:
  - a deferred batch that finishes after a timeout;
  - a second response;
  - an echo after a FAIL.
- **Witness.** `Lossy` on with the client's timeout off leaves a request pending forever. The
  same request resolves when the timeout is on.

## D14. Budgets: the page cap and the sanity limit

**Client restriction.** The spec's loop bounds *retrieved messages* (`SANITY_LIMIT`,
CH:195-197). Seance bounds *pages* (5). `Budget` has two values:
- `pages(k)`: no query is issued after k pages.
- `messages(m)`: following CH:196-205:
  - the test is made **before** each query (`retrieved < m`);
  - the whole returned page counts toward the total, so it may overshoot m;
  - a page is never truncated, and a query is never refused just because the page could
    exceed what remains.

NoLoss requires the budget to cover everything fetched: the overlap down to the floor, live
messages that land in pages, and short pages.

## D15. What each response does to a pending message (v2, after review 5)

LR:85-92 (non-normative) describes clearing a pending local message on its labeled echo. The
checked client is Seance's: `client/js/irc/pending.ts`, `handlers/privmsg.ts` `settleEcho`,
`history.ts` `ack` and `handlers/numerics.ts`, at upstream develop 6643b13. Its policy is a
client restriction.

A line inside a labeled batch takes that batch's label (BA:51, LR:55-58). The **first**
settling line wins, and the outcome then absorbs (D13).

| What arrives | Outcome |
| --- | --- |
| labeled echo, one line or inside a labeled batch | **confirmed** |
| labeled 4xx numeric or `FAIL`, one line or inside a labeled batch | **failed** |
| labeled `ACK` | **accepted**. With echo-message on, a PRIVMSG requires an echo (EM-1), so an ACK-only answer is a `Lossy` outcome (adversarial), not a conforming success. |
| a labeled batch that closes with no settling line (partial or empty) | nothing; still pending |
| unlabeled echo, exact text, same kind and channel | **confirmed**, by the content fallback: the oldest such copy |
| any unlabeled line matching no copy, including a server-modified echo (EM-2) | nothing; an ordinary incoming line, and the copy stays pending |
| connection closes | **failed** locally. That does not prove "not sent", and close is not in model v0. |
| 60 s timeout | **timed out** |

"Confirmed" means the server echoed the line. It does not mean the target received it: EM-5
allows a faked echo for a blocked message, and EM-2 an altered one.

**Self-messages (LR-5).** A PRIVMSG to one's own nick returns the labeled echo and an unlabeled
delivered copy. The labeled echo settles copy A. The unlabeled copy then follows the fallback
row: if another identical self-message B is pending, it settles B (review 5). Otherwise it is
shown as an incoming line. This is not LR:90's method 2.

**When ConfirmedByOwn holds** (DESIGN.md). With the fallback off, a copy is confirmed only by a
line carrying its label, and that line answers it (D1). With the fallback on, any unlabeled
same-text line can settle the oldest copy, so cross-copy matches are possible from three
sources:
- another session: a shared identity or bouncer relay (EM:44-48);
- a late unlabeled echo for a copy that has already timed out, settling another copy with the
  same text;
- the self-copy above.

The model's ghosts record which request each line answers, so the property separates identical
wire lines and is not weakened to text equality.

Model v0 checks it (`model/Delivery.tla`):
- `Base`, fallback off: holds;
- `BaseFallback`, fallback on with no other session and no `Lossy`: holds, because no unlabeled
  echo exists;
- `W_Other`: fails;
- `W_LateFallback`: fails.

## D16. Concurrent and nested batches (Delivery v2)

> "Start and end messages of one batch MAY refer to another batch. ... This means that one batch
> is nested to another. Client MAY delay processing messages of inner batches to the end of
> outermost batch." (BA:59-63); interleaving example (BA:100-115).

**Allowed.** A server may interleave the lines of different responses (BA:100-115) and may nest
a batch inside a labeled one (BA:59-63, LR:55-58). **Model v2:** each response is queued and
emitted line by line, under weak fairness, so responses interleave freely. Every line carries its
own batch id (start and end only) and its parent membership (`ref`). BA:51-52 forbids a start or
end from belonging to the batch it opens or closes. The client keeps a map from reference to open
batch. A member takes the label of the outermost labeled batch it is inside, which is the only
labeled one at depth 2. Under `Deferred`, every line in a batch, nested ones included, is
processed in wire order when the **outermost** batch ends (BA:63).

Depth is at most 2 (a restriction): a labeled-response batch holding one inner batch. Interleaving
keeps BA's framing: each response's lines stay in order, a member is sent only while its batch is
open, and both delimiters of a nested batch name the same parent. `multiline` and `history` are
abstract names, standing for `draft/multiline` and `chathistory`. The inner batch is a multiline
echo (it settles) or a history replay (D19, it does not). A history batch may also carry a
CHATHISTORY request's label directly (LR:55-58: an existing type applicable to the whole
response). Multiline assembly itself is not modelled: the echo is one line.

## D17. Competing settling lines in one response

A single-target PRIVMSG has one outcome. A response that holds both an echo and a FAIL or 4xx for
the same single-target line answers it twice. Multi-target lines are outside the model (one
target per request). No text read here forbids echo plus error for one target. LR allows several lines in one
logical response, and EM:50-52 allows a fake echo for a blocked message. **Adversarial** is
therefore a conservative modelling choice, not a proved MUST violation. The ordinary environment
gives one settling result; switch `Competing` adds batches echo-then-fail and fail-then-echo.
First-wins is D15's client policy: the first settling line in processing order (wire order;
under `Deferred`, the buffered order, which is the same). The ghost `firstK` records the kind of
the first settling line of the response itself. A response holds no history line, and a close
discards the rest. `FirstWins` checks the outcome's cause against it whenever the copy was
settled by its own response.

## D18. Connection close

The client may lose the connection at any time (environment, **allowed**; no fairness). On close:
- every pending copy becomes **failed**, with cause `close`, which does not prove "not sent";
- queued, in-flight and buffered lines are discarded, with nothing processed;
- nothing more happens. Close is terminal here; reconnecting belongs to the reconnect-policy
  model.

Failing the remaining copies matches Seance's `resetPending`. Discarding lines already
received but buffered, and making close terminal, are model choices. A batch still open at close
is a legal trace: a cut connection cannot deliver its end, so BA:54's closure obligation holds
only on a connection that survives. That is how D13's missing-end mutant differs from close.
`OutcomeMatchesCause` allows `failed` with cause `fail`, `err` or `close`. Timeouts, close and replies
race freely. Outcomes absorb (D13), so a reply after a timeout settles nothing, and lines after
a close never arrive.

## D19. Recognised history lines never settle a pending copy

A chathistory reply replays stored lines. It may include lines we sent, even on this connection
(CH:65, CH:125-128), but a replay is not a new delivery acknowledgment. **Seance's policy** (a
client restriction): `handlers/privmsg.ts` calls `settleEcho` only when `!client.replaying`
(review 6 checked the call site, not the code that sets the flag). Replay that the client does
not recognise is outside this guard. Automatic history batching is only a SHOULD
(batches/chathistory.md:22-27), so an unbatched replay of our own line is an ordinary unlabeled
same-text line. It confuses the fallback exactly as the other-session line does (W_Other), and
the model does not repeat it. **Model v2:** under switch `History`, the server may send a
`history` batch, standalone or nested inside a labeled response, holding an unlabeled same-text
copy of a sent line. No history line settles anything. The batch is standalone and unlabeled, nested in a labeled
response, or labeled itself. Property `HistoryNeverSettles` (recognised history) checks this, and
the mutant `DM_HistorySettles`, which lets those lines reach the fallback, must break it.
Under `Deferred` the inner lines are buffered like any other.

## D20. Self-message order, NOTICE, modified echoes, bounds

- **Self-copy order.** LR:60 requires the label on the echo only. Nothing orders the echo against
  the delivered copy, so once responses interleave (D16) the delivered copy may arrive first.
  **Allowed.** With the fallback on, an early delivered copy settles the oldest same-text copy,
  which may be the copy it answers.
- **NOTICE.** Requests are PRIVMSG or NOTICE (switch `Notice`; EM:21-29 covers both). The fallback
  matches the kind as well as the text and target, as Seance does. Property `SameKind`: a copy
  is settled by an echo only of its own kind. ACK, error and close settlements have no kind.
  Label matching checks only the label, so this holds for the fallback, not as a general
  safeguard. A NOTICE gets no error reply in the model. TAGMSG is out of scope.
- **Modified echoes.** EM:22-24 lets the server alter the echoed text, and the client must cope.
  **Allowed**, switch `Modify`: an echo's text may be any text, including another pending
  copy's, or a value matching no copy. A labeled modified echo still confirms its own copy. An
  unlabeled one matches by its altered text, so it can settle another copy or nothing (D15).
- **Bounds (DESIGN.md).** 3 requests, depth 2, the self-message, and at most 1 late reply over
  the whole run. That last is stricter than DESIGN's "one in flight". They are raised last, in a
  run of their own.
- **Where Seance's code is wider than the model.** A present label that names no copy settles
  nothing (since #277). Without `labeled-response` the oldest copy of the kind settles even on
  different text. That is outside the model's restriction that the cap is negotiated.

## D21. Consumption obligations

The client restriction behind D15, stated as an action property over the wire line, not over
`Handle`:
- **Immediate.** The client reads an echo, ACK, FAIL or 4xx outside any batch, or inside one
  when `Deferred` is off, and not in history. If its own or inherited label names a pending copy,
  that copy gets the line's outcome in that step: echo → confirmed, ACK → accepted, FAIL or 4xx →
  failed.
- **Deferred.** When the outermost batch ends, every pending copy with an eligible buffered line
  gets the outcome of the first such line, in buffered order, across the whole nested tree,
  excluding history.

FAIL and 4xx stay distinct kinds (`fail`, `err`), so dropping either dispatch is caught
(`DM_IgnoreErr`). ACK is reachable only under `Lossy`, standalone (`DM_IgnoreAck` on a Lossy
config). Batched ACK is not generated.

These catch a client that ignores a reachable response even when the timeout would later resolve
the copy, which liveness cannot see.

## D22. History.tla v0: scope and abstractions

This decision states restrictions only. It settles no reading of the text.
- **Scope.** v0 covers only the catch-up after one reconnect (CH-23's loop and Seance's `catchup.ts`). The first JOIN's LATEST, `more`, FAIL and unknown selectors come later. Their rules stay in RULES.md and D5.
- **A page is one wire item.** The client processes a whole batch at once. A live line is a separate item, so it can arrive before or after the page, but never between two of its lines (BA-9 allows that). This is a restriction. With the client's per-message merge and dedupe, a live line inside the batch acts like one just before or just after it, with one exception: a client that defers batch processing (Delivery's D2) handles the live line first. Both of those positions are modelled.
- **The live message joins the order as the newest.** The connection order is chosen at reconnect (Init, D7), and the live message is appended to it when it is stored. Under `TimeOrdered` that is forced, because store times are non-decreasing (D8). With `TimeOrdered` off this is a restriction: a later message could take any position.
- **chathistory-end is only sent when the page holds every eligible message.** With `Contiguous` on, that is exactly D9's "the next page in the same direction is empty". With it off, it is a restriction: a holey page that left only newer messages out could truthfully carry the tag.
- **Init fixes every per-run choice:** times, held and gap messages, and the connection order. The switches are constants. So `split-env.py`'s method (formal-spec D26) applies unchanged.
- **Termination** is the only liveness property (`FairSpec`). NoLoss, NoDup and Order are invariants checked at completion. Each has a cover and a witness.

## D23. Delivery v2.2 (after MODEL-REVIEW-3)

- **History lines are queued** (`hout`) and emitted one at a time (`SEmitHist`), like a response. An own echo, another session's line or another batch can now fall between a history batch's start and end (BA:93-98). `DM_GlobalHist` is a client that treats every line as history while any history batch is open, and it must break ImmediateObligation. `V2CoverEchoInHist` shows that an own echo can come next while a history batch is open.
- **The label ledger counts emitted lines.** `labeledN` grows in SEmit, not SAnswer. So a LabelOnce violation means two labeled lines were actually on the wire.
- **ImmediateObligation reads the wire's provenance.** It uses the line's own `role` and `who` ghosts, not the client's `EffLab` and `HistOf`. A client that misassociates a line can no longer weaken the oracle. DeferredObligation still reads the client's buffer; see the README's "Still open".
- **Modify reaches late echoes.** A late unlabeled echo may carry an altered text (EM-2), which matches no copy (`V2CoverModLate`).
- **Restriction, kept from v2:** a self-message's delivered copy comes before or after the whole response, never between a batch's start and end. LR-5 doesn't restrict where it goes, so this is a restriction.
- **Bound:** V2History now runs with MaxReq = 1. Line-by-line history multiplies the interleavings, and at MaxReq = 2 v2.1 already reached 102M states.
- The mutant DM_LastOpened is renamed DM_HighestRef. It picks the open batch with the highest reference, which is not the one opened last (MODEL-REVIEW-3 §3).

## D24. History.tla v0.1 (after HISTORY-REVIEW-1)

- **Msgid and content are separate.** A message's content is its index. The msgid it carries on the wire is `Replay(c)`, which is `c` itself (CH-18). The mutant `HS_NewId` mints `c + N` instead, and `ContentOnce` catches it: a deduping client then holds the same content twice. `ReplayIdStable` states CH-18 directly.
- **Every page records its snapshot:** the eligible set and the order at answer time. PageEligible and EndTruthful read that snapshot, not the current order, and mutants change only the server's choice, never the oracle.
- **chathistory-end** may be sent when no eligible message left out of the page is older than every message in it. That is D9's "the next page in the same direction is empty". It replaces v0's "the page holds every eligible message" and drops v0's unconditional exemption for the live message.
- **Batch order (a finding).** With msgid anchors and contiguous, exact pages, a batch in another order costs pages but skips no older message. So `BatchAgrees` matters to NoLoss only through the budget. The paired checks are `HNoBatchAgrees` (passes with `pages(5)`) and `W_BatchBudget` (fails with `pages(2)`).
- **Witness stories.** W_NoDedupe now checks `NoDupLive`: the live message is relayed, replayed and held twice. W_Append fails because older history is appended after newer messages. DESIGN's story of a live message stored at time 1 after a time-3 page can't happen, since store times are non-decreasing (D8).
- **Bounds.** Most configs use `pages(5)`, Seance's cap, and DESIGN's bounds now say so. `HFuzz` runs with Fuzz = 1.
- **Liveness.** `StoreLive` has no fairness, so a run may never store the live message. Terminates means the catch-up ends, not that it recovers every gap message: that is NoLoss's job.

## D25. History.tla v0.2 (after HISTORY-REVIEW-2)

- **chathistory-end, on the wire.** CH:136 says the next request in the same direction "will return an empty batch". v0.2 takes the next request to be CH-23's BEFORE on the batch's first message, run against the page's snapshot. So the tag is truthful when that first message is the oldest in the order, or, for an empty page, when the query had nothing eligible. This replaces v0.1's NoneOlder, which ignored batch order (HISTORY-REVIEW-2's counterexample: order and page `<<1,2>>`, batch `<<2,1>>`).
- **Opaque selector lookup (MI-5).** The server looks up a selector's msgid as given. An unknown msgid, such as a minted replay id, selects nothing: D5's empty-batch reply. v0.1 resolved a minted id back to its content, which an opaque server cannot do.
- **Content against msgid.** CoverDone and CoverLiveInPage compare contents, as NoLoss does. Dedupe, the held-overlap stop and NoDupLive compare msgids, as a client must.
- **Coverage.** CoverDone runs on every positive config. The same-budget positive `HBatchAgreesBudget` pairs with `W_BatchBudget`. `HS_NewIdR` checks ReplayIdStable directly, which is an id-range check only.
- **Retired.** DESIGN's per-model sent/got ghost history: History's witness traces are TLC's counterexamples instead. The schedule with a live line inside a batch's lines is out of scope by D22.
- **A second budget finding (v0.2 run).** Even when batches arrive in order, `pages(2)` can lose a gap message. A reconnect without StableAcrossReconnect may order a gap message before the held one when their times tie. So the catch-up walks past the held message and runs out of pages. That is why both halves of the pair pin `StableAcrossReconnect`. Result: all 37 checks as expected (history-v0.2, jobs 10474 and 10477).

## D26. History.tla v1 (after HISTORY-REVIEW-3)

- **Three request kinds, one per config (`Mode`).** Each has its own obligation, and the reconnect-only init, floor and completion properties stay reconnect-only.
  - **`reconnect`:** v0.2's catch-up loop. NoLoss holds when it completes other than by FAIL.
  - **`join`:** the first JOIN, `LATEST * Limit` on an empty buffer, one page. JoinRecovers: the Limit newest messages of that page's snapshot are held.
  - **`more`:** `BEFORE <oldest held> Limit`, one page, on one connection, so StableAcrossReconnect is pinned. Here the held messages are the newest and the "gap" is the older history. MoreRecovers: the Limit newest older messages are held.
  - The obligations are written from the initial store and the snapshot, not from the query the client sent. So a client with the wrong anchor (HC_MoreNewest) fails them.
- **FAIL (CH-7) is a completion, not a recovery.** The server may answer any query with FAIL (`MayFail`), and the client stops with why = "fail". NoLoss excludes that case. NoLossEvenOnFail does not, and W_FailLoss shows it fails, so the exclusion is reachable and matters.
- **Selector forms are explicit:** `star` (LATEST *), `msgid` and `ts`, so form 0 no longer stands for a timestamp. LATEST is not extended past `*`, because no client modelled sends anything else.
- **UnknownEmpty (MI-5):** a BEFORE whose msgid the snapshot does not hold selects nothing.
  - With minted replay ids, that lookup is reachable (CoverUnknownSel on HS_NewIdUnknown), and the minted anchor then ends the loop on an empty page, losing the gap (HS_NewIdAnchor).
  - HS_UnknownLatest answers an unknown msgid as if it were LATEST, and UnknownEmpty catches it.
- **EndNext, a second end oracle written from the next query.** A tagged page means `BEFORE msgid=<its first wire msgid>`, against the same snapshot, selects nothing; a tagged empty page means the query had nothing eligible. Neither side uses EndOK.
  - **Regressions:** HS_EndLast tags a reversed batch by its last element (CoverEndReversed shows such a page is reachable), and HS_EndEmpty tags an empty page while messages remain. EndNext catches both.
  - **Exactness:** EndOK is computed on content ids, and EndTruthful decodes the wire ids. EndNext builds a msgid continuation from the first wire id, even when the client anchors by timestamp, so it does not check timestamp exactness. With a minted first id the next lookup is unknown, so EndNext accepts a tag that EndOK refuses. With timestamp anchors and tied times, the next timestamp query can be empty although the first message is not the oldest. In both cases the server's EndOK is the conservative one: it never tags falsely, though it may leave a truthful case untagged.
- **The reconnect tie loss, named.** W_TieReconnect is HBatchAgreesBudget without StableAcrossReconnect, which fails NoLoss (D25's last bullet). So agreeing batches alone are not enough for pages(2).
- **Not modelled:** AFTER, AROUND, BETWEEN and TARGETS; LATEST with a selector; a live line inside a batch's lines (D22); retrying after FAIL.
- **The `more` configs hold two messages.** With one held message, the oldest and the newest held are the same, so HC_MoreNewest could not differ (job 10500 found this). Result: all 57 checks as expected (history-v1, jobs 10500 and 10504; `model/results-h1.summary`).
- **After HISTORY-REVIEW-4.**
  - **JOIN and `more` guards.** JoinRecovers and MoreRecovers now apply to every completion except FAIL, not only the one-page stop ("one"), so a client that stops early with "budget", "empty" or "floor" does not escape them.
  - **FAIL in the one-page modes.** HMoreFail is added, and JOIN and `more` each get FAIL and completion covers.
  - **The minted-anchor chain.** The `unkEmpty` ghost records an empty page answering a BEFORE whose msgid is unknown. CoverUnknownLoss, on the minting mutant (HS_NewIdChain), reaches that page, the "empty" stop and a missing gap message together in one state.
  - **EndNext's limits.** It is independent of EndOK's position test, but not of Elig. Its empty-page branch trusts the recorded `el`.
  - Result: all 63 checks as expected (history-v1.1, job 10505).

## D27. Replaying Seance's catch-up against History (adapter v0): scope

This decision states scope and restrictions only. It builds nothing yet. Review it first (PROMPT-H5).
- **What is compared.** The adapter feeds Seance's real `IrcClient` a fixture made from one model run, over FakeTransport. It records what the client does:
  - each `CHATHISTORY` request: subcommand, selector form and value, limit;
  - the number of requests;
  - the rows delivered: content, msgid and order;
  - `chan.historyFilled`.

  The model's choices are never fed back as expectations. A checker turns the observation into a TLC trace check against History.tla, as `check_delivery.py` does for Delivery. The stop reason can't be observed, so it is not compared.
- **Fixtures** follow HISTORY-REVIEW-4 §5.
  - Opaque string ids, with minted ids kept distinct.
  - Fixed UTC times, with ties kept.
  - One target, `#seance`, and a fresh batch reference per reply.
  - SrvAnswer is one whole `chathistory` batch. SrvFail is `FAIL CHATHISTORY MESSAGE_ERROR`. RelayLive is an unbatched PRIVMSG. StoreLive emits nothing.
- **Restrictions for v0:**
  - Only Seance, only reconnect mode, one channel.
  - Whole-page schedules only (D22). A live line between a batch's lines is recorded as an observation only and never checked.
  - `labeled-response` on.
  - No `draft/read-marker`, no persistence, no `draft/event-playback`.
  - `NO_FAKE_LAG`, and every answer within 15 s of fake time.

  These pin a path around TARGETS, marker fetches and step costs, none of which the model has.
- **Seance's switch values** (SWITCH-TABLE.md, read from 4f5a4bd12; still to be checked by hand):
  - MsgidAnchor TRUE;
  - pages(5);
  - Limit = `CHATHISTORY=` from ISUPPORT;
  - floor `<` with a 5 s allowance;
  - Dedupe TRUE;
  - StopOnHeld TRUE;
  - InsertMerge FALSE on reconnect, so the gap lands after live lines (W_Append's Order break).

  Three behaviours have no model value:
  - the held set is wider than `Held`;
  - the next anchor after a reversed batch is the oldest line by time, not `ms[1]`;
  - pages are deduped at batch close but delivered once at the end.

  Each gets a switch, or a finding. The model is not tuned to fit.
- **A finding already, from the switch table.** On develop, a line relayed live while LATEST is in flight is also in that page. It ends the walk after one page and sets historyFilled, so the rest of a longer gap is never fetched. A mocha probe confirmed it.
  - That is StopOnHeld with the held set taken at batch close instead of at the JOIN.
  - The fix is on fix/catchup-live-stop (12a66b6): `Channel.heldAtJoin`.
  - The adapter should reproduce the bug on develop and its absence on the fix.
- **Seeds.** Use the witnesses (W_TsTie, W_TieReconnect, W_Budget, W_EmptyPage, W_Append, HS_NewIdChain) and the positives' covers. Their TLC traces (`*_TTrace_*.tla`, history-v1.1) are kept as the fixtures' source.
- **Not in v0:** JOIN and `more` modes; Textual-NG and HexDroid; line-level batch interleaving; the ordering of the gap against live lines in the store (the unread marker assumes ids rise with row order).
- **After HISTORY-REVIEW-5.** The review's verdict: a useful restricted replay, not yet a refinement claim.
  - **First result, cut down.** One live-stop fixture and its control, nothing more.
    - Held h at 12:10; missing a at 12:12 and b at 12:16; live l at 12:31; Limit = 2; event-playback off.
    - The live line l is relayed before LATEST's page [b, l], which has no end tag. The client must ask `BEFORE msgid=b 2`, and [h, a] finishes the walk.
    - The control relays l only after the walk.
    - The fixture runs against develop and fix/catchup-live-stop. The result is the requests and the final content, not a TLC trace check. HTiny and HTiny2 already allow this schedule under initial-Held semantics.
    - Deferred until there is a first result: the generic observation checker, the witness seed catalogue, minted ids, and the three new policies.
  - **The three unmapped behaviours.**
    - The held set taken at batch close is a client finding, not a switch: Held stays the normative policy. A diagnostic mutant may reproduce the loss inside History.
    - The oldest-by-time anchor becomes a model switch, paired with an any-member floor test (Seance tests every timed line on the page, the model only `ms[1]`).
    - Deferred delivery becomes a model policy with pending pages, close-time dedupe and a final flush. Its live-after-gather duplicate is a client finding.
  - **Corrections to SWITCH-TABLE.**
    - Limit is min(100, a positive cap), else 100.
    - MsgidAnchor also depends on MSGREFTYPES.
    - Gathered pages are reversed into oldest-page-first order before delivery, which differs from InsertMerge FALSE even without live lines.
    - A non-empty page with no valid timestamps also stops the walk, and that is not the model's empty page.
    - historyFilled stays false on budget and empty stops, so completion is observed as quiescence.
    - The harness helpers `payloads`, `mores` and `msgs` are file-local to test/irc/history.ts.
    - The default harness advertises event-playback; D27 turns it off.

## D28. Unlabeled errors without labeled-response (Delivery v2.3)

- **Client switch `ErrFallback`.** An unlabeled error fails the only pending non-NOTICE copy for its target (`OnlyFor`), and fails nothing when there are none or several. This is the rule Seance (#278 at 99f1298) and Textual-NG now use without labels. Before, the model's client failed a copy only on a labelled error, so U_err could match no config.
- **Server switch `LateErr`** (adversarial, with Lossy): a lost reply may come back late as an unlabeled error instead of an echo. Without it the model's server never sends an unlabeled error, and the client switch could not be checked on its own.
- **`FailedByOwn`:** a copy failed by a FAIL or error line was failed by its own request's line.
  - The witness W_ErrFallback expects the rule to break it: copy 1 times out, then copy 1's late error fails copy 2, the only copy still pending.
  - The cover V3CoverErrFallback shows the rule failing a copy by its own late error.
  - V3ErrLateOff (LateErr without the rule) and V3ErrOnly (the rule on a server with no unlabeled errors) are positives.
- **Unchanged results.** Every v2.2 config sets both switches FALSE, and both changes are guarded by them, so the v2.2 results stand. The v2.3 run re-checks Base and LossyTimeout for equal distinct-state counts.
- **Conformance.** `check_delivery.py --errfallback` sets the client switch in the trace configs; LateErr stays off there, since the trace supplies the lines.

## D29. First History replay result: the live-stop fixture (2026-11-11)

- **The driver.** `test/formal/history/livestop.py` (wip/formal-models) builds a mocha file from the target checkout's own `test/irc/history.ts` harness, runs the fixture and its control from D27's review-5 bullet, and records:
  - the CHATHISTORY requests sent;
  - the replayed rows;
  - the live rows;
  - historyFilled.

  Results are in `test/formal/history/results/livestop-<sha>.jsonl`.
- **develop 4f5a4bd12, the fixture:** only `LATEST * 2` is sent. The gap delivered is [b] alone, `a` is never fetched, and historyFilled is true. This is the bug, reproduced from the model's schedule.
- **fix/catchup-live-stop 12a66b6fa, the fixture:** `LATEST`, then `BEFORE msgid=b 2`. The gap is [a, b], `l` is shown once (live), and historyFilled is true. The bug is gone on this schedule.
- **The control, on both revisions:** the walk completes and recovers [a, b, l], but `l` is shown twice: once in the gap, once when relayed after the walk. This is the live-after-gather duplicate review 5 predicted, a client finding.
  - #278's repeated-msgid check (handlers/privmsg.ts) should drop the second copy. Not yet run on #278 combined with the fix.
- **Not a refinement claim.** This is two whole-page schedules, compared by requests and content only.

## D30. The catch-up PRs (#279, #280, #281) against History: fixtures with Python property checks (2026-11-11)

- **Method.** `test/formal/history/catchup_fixtures.py` runs four whole-page schedules through each checkout's own harness. The store is simulated with the checkout's own `insertMessage`. History.tla's properties are applied to the observation:
  - Requests: the model client's CQuery sequence for the schedule;
  - NoLoss, NoDup and Order on the store.

  It also checks IdsRise, which comes from the UI, not the model. No TLC: this is option A, which the coordinator accepted.
- **Fixtures:**
  - **liveStop** (#279) and its control (D29).
  - **gapOrder** (#281): a live line is relayed before a single page that reaches h, and the gap must sort above it.
  - **clockFloor** (#280): a local line at 12:40, typed while down, is the newest row. The walk must still page back to h at 12:10.

| Fixture | develop 4f5a4bd | #279 bafdeb7 | #280 411aee9 | #281 ba6c040 | #278+#279 | all four |
|---|---|---|---|---|---|---|
| liveStop | FAIL Requests, NoLoss, Order | Order only | FAIL | Requests, NoLoss | Order only | PASS |
| liveStopControl | NoDup (l twice) | NoDup | NoDup | NoDup | PASS | PASS |
| gapOrder | Order | Order | Order | PASS | Order | PASS |
| clockFloor | Requests, NoLoss | Requests, NoLoss | PASS | Requests, NoLoss | Requests, NoLoss | PASS |

- **Reading.**
  - Each PR fixes its own fixture and leaves the others' failures as they were.
  - #278's repeated-msgid check removes the control's duplicate.
  - The four together pass everything.
  - The all-four mix has one textual conflict in channel.ts: #279's `heldAtJoin` and #281's `gapIds` are added at the same spot. Keeping both resolves it, and typecheck plus the history, pending, messageUpdates and attach-cursor tests pass (135).
- **What the model does not express.**
  - The local clock: History has only server times, so clockFloor checks the walk's requests and losses, not the clock.
  - Display order: Order is the model's property for the client buffer; here it is applied to the store as simulated with the PR's helper.
  - IdsRise is a UI invariant.
  - Whole pages only (D22).
- **Cost:** about 45 minutes, no gpu05 jobs. Results are in `test/formal/history/results/catchup-*.jsonl`.

## D31. History TLC trace harness for the catch-up fixtures (option B)

- **What it does.** `test/formal/history/history_trace.py` turns one catch-up fixture observation into a module `HT_<fixture>` that EXTENDS History.
  - Init is pinned: ids are in time order, times are the ranks of the fixture's minutes, `ord` is the store order, and `Fuzz = 0`.
  - The fixture's wire template and the observed requests give a step sequence W:
    - `Q`: the client's observed request, which must be CQuery's;
    - `A`: SrvAnswer with the fixture's page pinned;
    - `S`: StoreLive;
    - `R`: RelayLive;
    - `C`: CRecv.
  - **NotStuck:** every step is enabled.
  - **SnapOK:** at the end the model's client is done, and its buffer equals Seance's store, in order.
- **Configs.** reconnect mode, pages(5), ExactCount, Contiguous, TimeOrdered, BatchAgrees, StableAcrossReconnect, Dedupe, MsgidAnchor, StopOnHeld and InsertMerge, with the fixture's Limit.
- **gapOrder runs with `Contiguous = FALSE`.** Its page leaves out a live line already stored and relayed, which only a lagging store gives.
- **Not expressible:** clockFloor's local line, since the model has only server times. The trace checks that the walk pages back to the server-stamped floor.
- **Validated on gpu05 (job 10574, history-trace/):**
  - develop 4f5a4bd12 fails all four fixtures on SnapOK;
  - the mix of #278 to #281 (a55da75b4) passes all four.
  - Each passing trace takes every step: Len(W) + 1 states, 7 or 10.
- **The final sweep** (all PRs mixed at their final heads) runs this together with the Python properties and the delivery dcheck, labelled and nolabel with `--errfallback`.
