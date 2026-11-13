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

## D32 Combined sweep before sign-off (2026-11-11)

One mix (tools/mix.mjs sweep1 → e91eb65e8) of #278 5ef148143, #279 f13bd682a,
#280 1ed36f61c, #281 e0d7917eb. Conflicts were doc-only between #279 and #280
in history.ts; between #279 and #281, catchup.ts/history.ts carry both
`held`/`heldIds` and `ids`. Typecheck clean, mocha 5346 passing.
gpu05 job 10594:
- History fixtures (Python properties and TLC trace HT_*): liveStop,
  liveStopControl, gapOrder, clockFloor all PASS (develop fails all four on
  SnapOK).
- Delivery v2.3 dcheck, labelled: every scenario matches the model. Prop
  notes only on the by-design rows: W_Other, W_LateTimedOut, U_other, and
  U_err/U_errTwo, which need ErrFallback or a timeout.
- Delivery v2.3 dcheck, no label with --errfallback: all match, U_err ok. The
  only notes are U_other and U_errTwo (two waiting: neither failed, left to
  the timeout).
- Delivery v2.3 model (job 10512): Base, LossyTimeout, V3ErrLateOff and
  V3ErrOnly pass; W_ErrFallback and V3CoverErrFallback fail as expected.

## D33 Final sweep after merging #278-#281 (2026-11-11)

Merged into evilnet develop by squash, in this order:
- #280 3fe9ddf3d
- #278 ad25a114a
- #279 fee545d16
- #281 d0322ffa7

#279 and #281 were brought up to date by merging develop into them rather
than rebasing (force-push was not available). Their trees equal the
rebased ones.

Sweep on develop fee545d16 + #281 54c6514c2 (whose tree equals d0322ffa7's),
gpu05 job 10654:
- History fixtures (Python properties and TLC trace): 4/4 pass.
- Delivery dcheck, labelled and no-label with --errfallback: byte-identical
  to the D32 summaries.

## D34 Cold start with a held session: the belowHeld fixture and what History.tla lacks (2026-11-12)

Phone trace, 00:15:41 UTC. The server's draft/persistence batch for 10 channels
took 0.76 s, longer than the client's 0.75 s autojoin quiet period, so the
client JOINed and walked itself. The walk's LATEST page reached below the
oldest held line, and 52 older lines were appended above the rejoin. Fixed in
#282 (03a2f172a).

- New fixture `belowHeld`: a page with a line older than everything held.
  Python properties fail on develop d0322ffa7 (Order: h,o,a) and pass on
  03a2f172a. The four earlier fixtures pass on both.
- TLC trace (gpu05 job 10670): the four earlier fixtures pass on both shas.
  belowHeld is SKIP because it is not expressible.

Missing from History.tla:
1. In reconnect mode the store is held ++ gap (`Held == 1..NHeld`). It needs
   an NOld prefix: stored lines older than the held ones that are not in buf,
   plus a decision on what the spec says a client does with page lines below
   lower_bound - FUZZ (drop or merge). Seance now drops those below everything
   held and keeps those inside it.
2. The restore race has no counterpart: no session restore, ATTACH cursor
   replay, or autojoin wait. It is a timing property (no client JOIN or walk
   while the restore batch is open) and belongs in a session model, not
   History. Covered for now only by test/irc/persistence.ts "holds the
   autojoin while a restoration batch is still arriving".

## D35 History v1.2: NOld, and lines below the held range (2026-11-12)

Answers D34 item 1. Item 2 (the restore race) stays out of History.

- **What changed in History.tla.**
  - New constant `NOld`: stored lines older than every held line. They are in
    the server's store but not in the client's buffer. In reconnect mode the
    store is `Old ++ Held ++ Gap` (ids `1..NOld`, then the held ones, then the
    gap). The other modes assume `NOld = 0`.
  - `Floor` reads the newest held line, `time[NOld + NHeld]`. The new
    `HoldsFrom` is the oldest held line's time (Seance: `chan.oldestTimeOf`).
  - `Cutoff == min(Floor, HoldsFrom)`.
  - CRecv merges `Kept(it)`, not `it.ms`. In reconnect mode, with something
    held, a page line with `T < Cutoff` is not placed. The stop decision, the
    anchor, the budget and `pgSeen` still read the whole page, as Seance's
    `reached` and `oldest` do.
  - New invariant **HeldOrder** (in SAFE): in a reconnect, no line older than
    every held line comes after a held line in the buffer. New cover
    **CoverOldDropped**: a page reached below everything held and a line was
    dropped.
- **Decision: lines below the held range are dropped (Seance's rule since #282).**
  - A line below `min(floor, oldest held)` is older than the gap and was never
    loaded. Placed, an appending client puts it after the held lines, above the
    rejoin. Scrolling up brings it as history.
  - A line at or above the cutoff is merged as before: by msgid (Dedupe), then
    by time or appended (InsertMerge).
  - With nothing held, nothing is dropped. Seance needs a held msgid; the model
    needs `NHeld > 0`.
  - With `NOld = 0` no page line is ever below the cutoff (store times are
    non-decreasing), so v1.1's behaviour is unchanged.
- **Mutants (mkhist.py, Placed(m) == TRUE: pre-#282, append them):**
  - HC_KeepOld violates HeldOrder.
  - HC_KeepOldOrder violates Order. This is the fixture's Python property
    (d0322ffa7: Order h,o,a).
  - Both run on HBelowHeld, the belowHeld shape: one old line, one held, one
    gap line, no live line, Limit 3 (one LATEST page holds all of it), and
    InsertMerge off (Seance appends on a reconnect).
  - With InsertMerge on, an old line would be inserted before the held ones,
    and neither property breaks. Only an appending client shows the bug.
- **Two findings, kept as W_ configs:**
  - **W_FuzzBelow.** The cutoff is min(floor, oldest held). With one held line
    the FUZZ window lies below the oldest held line, so an old line inside it
    is kept. An appending client then puts it after the held line, which
    violates HeldOrder. Run: Fuzz 1, Times {1, 2}.
    - Seance's 5 s window has this hole for lines up to 5 s older than its
      oldest held line.
    - The model has no clock skew, so it calls such a line old. Under skew it
      could be a gap line, which is why Seance keeps it.
  - **W_OldTieBudget** (HOldFuzz's first run, at Limit 1). Every time is tied,
    so Fuzz puts the floor at 0 and no page stops the walk. Without Stable, a
    gap line is ordered before the old one, and six lines at one per page
    outrun pages(5). This is D25's tie-and-budget story (W_TieReconnect),
    with the old line as the extra. HOldFuzz now runs at Limit 2 with Times
    {1, 2, 3}: with {1, 3}, a Fuzz of 1 changes no stop or drop, and its count
    equalled HOld2's.
- **TLC runs, local** (`tla2tools.jar`, -workers 1 so that the counts at a
  violation repeat). Every summary line is in `model/results-h12-local.summary`
  (77 checks, all as expected).
  - **NOld = 0 regression.** The 63 v1.1 checks were run before the change
    (mkhist.py regenerates the committed files byte for byte) and after it.
    All 63 give the same result and the same distinct-state count. The passing
    counts also equal gpu05's results-h1.summary (for example HTiny 3140,
    HTiny2 10278, HNoBatchAgrees 58722). The counts at a violation differ
    from gpu05's, which used more workers.
  - New checks:

| Check | Expect | Result |
|---|---|---|
| HOld (HTiny + NOld 1) | pass | pass, 14,206 distinct |
| HOld2 (NHeld 2, Limit 2) | pass | pass, 58,496 |
| HOldFuzz (NHeld 2, Limit 2, Fuzz 1, Times {1,2,3}) | pass | pass, 139,472 |
| HOldHeldStop (StopOnHeld, Stable) | pass | pass, 594 |
| HBelowHeld (the fixture's shape, appending) | pass | pass, 152 |
| CoverOldDropped | fail | CoverOldDropped violated, 7,420 |
| CoverOldDropped_HBelowHeld | fail | CoverOldDropped violated, 81 |
| CoverDone_HOld / _HOld2 / _HBelowHeld | fail | CoverDone violated, 6,744 / 12,693 / 66 |
| W_FuzzBelow | fail | HeldOrder violated, 81 |
| W_OldTieBudget | fail | NoLoss violated, 57,115 |
| HC_KeepOld on HBelowHeld | fail | HeldOrder violated, 81 |
| HC_KeepOldOrder on HBelowHeld | fail | Order violated, 81 |

- **Trace harness.** history_trace.py maps a page line that is neither held,
  gap nor live into Old (NOld). Fixture times are now compared as minutes, so
  "11:55" sorts below "10" (12:10); as strings it sorted above. belowHeld no longer carries `tlc` (SKIP).
  Each harness run replays a stored observation file. Every pass takes every
  step (Len(W) + 1 states: 4 for belowHeld, 7 or 10 for the others).

| Fixture | d0322ffa7 | 03a2f172a |
|---|---|---|
| liveStop | PASS | PASS |
| liveStopControl | PASS | PASS |
| gapOrder | PASS | PASS |
| clockFloor | PASS | PASS |
| belowHeld | FAIL SnapOK (buf h,a; Seance h,o,a) | PASS |

  As a check on the harness change, `final.jsonl` passes 4/4 and
  `catchup-develop.jsonl` fails 4/4 on SnapOK, as in D31 and D33.
- **For the cluster (not run here):**
  - NOld = 2;
  - NOld 1 on HNoBatchAgrees (58,722 states at NOld 0), on W_Holes/Contiguous
    off, and on HMsgs/HFail;
  - HOldFuzz at Limit 1 with Stable on;
  - a Seance-shaped reconnect: StopOnHeld on, InsertMerge off, LiveOn, NOld 1.
    This needs a property weaker than Order, because W_Append's live-line
    reorder breaks Order there.
- **Still left.**
  - D34 item 2, the session or restore-race model, is out of scope here.
  - Missed lines inside the held range (a hole between two held lines) are not
    expressible: Held is a contiguous id range. So the "merge, don't drop"
    half of the rule, and a cutoff of floor alone versus min(floor, oldest
    held), cannot be told apart in this model.
  - The model drops by `T < Cutoff` on server times only. clockFloor's local
    clock is still outside it (D31).

## D36 History v1.3: holes in the held range, Skew, and msgid settling (2026-11-12)

Answers D35's "still left": a missed line inside the held range, and floor
alone against min(floor, oldest held). The W_FuzzBelow follow-up is filed as
evilnet/seance#290.

- **The cutoff, as the code has it.** Seance's resolve() (history.ts, #282):
  `floorMs = floor.time - CATCHUP_FUZZ_MS`, then
  `cutoff = Math.min(floorMs, holdsFrom)`. That is min(newest held - FUZZ,
  oldest held), not min(floor, oldest held) - FUZZ. History.tla already
  encoded this (`Floor == newest held - Fuzz`, `Cutoff == min(Floor,
  HoldsFrom)`), and every mutant below replaces that one line. So
  W_FuzzBelow's window exists only when the oldest held line is less than
  FUZZ older than the newest: one held line, or a few a moment apart.
  W_FuzzBelow2 shows the second case.
- **What changed in History.tla.**
  - New constant `Holes`: offsets inside the held span (strictly between its
    first and last line) that are stored but not held. In reconnect mode the
    store is `Old ++ Span ++ Gap`, where the span holds `NHeld` held lines and
    the holes among them. `Held` is the span minus `HoleIds`. buf starts as
    the held lines in store order (`HeldSeq`).
  - New constant `Skew`: a line stored later may carry a time up to Skew
    earlier (`TimeFns`). Skew = 0 is v1.2's non-decreasing store.
  - `Floor` and `HoldsFrom` read the newest and oldest time among the held
    lines (`MaxT`, `MinT`). That is what Seance reads (`catchupRef`,
    `oldestTimeOf`). With Skew = 0 they equal v1.2's `time[NOld + NHeld]` and
    `time[NOld + 1]`.
  - New invariants (in SAFE):
    - **HoleKept**: once a page carried a hole, it is in the buffer exactly
      once (no loss, no duplicate);
    - **HoleOrder**: no hole stands on the wrong side of a held line or another
      hole with a different time. This is server order up to ties, since a
      time-merging client cannot see the order inside a tie (D7). It is only
      meaningful at Skew = 0;
    - **OldByTime**: a stored line older than every held line is in Old. This
      is the lemma msgid settling rests on. It holds by construction at
      Skew = 0.
  - New covers: CoverHoleKept, and CoverHoleBelowFloor (a kept hole below
    newest held - FUZZ, where a cutoff of the floor alone would drop it).
- **Where holes come from in Seance.** A walk that hits the page cap delivers
  its newest pages and leaves the older part of the gap unloaded. At the next
  reconnect, what is held has a hole: lines from before the first disconnect,
  then the missing middle, then the delivered pages. The task brief's other
  examples (a trimmed buffer, a dropped live line) give the same shape.
- **Decision: what the client does with a hole (checked in the code).**
  Seance keeps it and appends it; it does not place it by time.
  - catchup.ts reserves the gap's ids (`IdAllocator.reserve`) when the
    catch-up starts. That block is above every held row's id.
  - deliverAppend pushes each kept line with an id from the block.
  - The store's `insertMessage` (messageUpdates.ts) places a row by id
    (`placeId`). So a hole lands below the newest held line, above the live
    lines relayed during the walk, and never between its held neighbours.
  - In the model that is `InsertMerge = FALSE`. HoleKept holds there
    (HHoleSeance, HHoleSeanceFuzz), but HoleOrder does not:
    **W_HoleAppend** (held 1@t1, hole 2@t1, held 3@t2, gap 4@t2 gives buf
    <<1, 3, 2>>, with the hole shown below the newer held line).
  - So #282's "a line below the floor but within what we hold is one we
    missed, and still goes in" holds for loss and duplicates but not for
    order. This is not filed yet. The fix is to place a kept hole by time,
    which needs an id between its neighbours.
  - With `InsertMerge = TRUE` both properties hold (HHole, HHoleFuzz,
    HHoleFuzzHi, HHolePages, HHoleOld).
- **Mutants (mkhist.py; each replaces the Cutoff line):**
  - **HC_NewestCut**, `Cutoff == MaxT(Held)`: unknown lines inside the held
    range are dropped, as if the cutoff were the newest held line.
  - **HC_FloorCut**, `Cutoff == Floor`: the floor alone (newest held - FUZZ).

| Config | correct rule | HC_NewestCut | HC_FloorCut |
|---|---|---|---|
| HHole (Fuzz 0, Times {1,2,3}) | pass, 1,116 | HoleKept violated, 577 | HoleKept violated, 577 |
| HHoleSeance (the same, appending) | pass (SEANCE), 1,116 | HoleKept violated, 577 | HoleKept violated, 577 |
| HHoleFuzz (Fuzz 1) | pass, 1,212 | HoleKept violated, 577 | HoleKept violated, 589 |
| HHoleFuzzHi (Fuzz 1, Times {2,3}) | pass, 640 | HoleKept violated, 317 | pass (HoleKept), 640 |
| HOld2 / HOldFuzz / HBelowHeld (no holes) | pass | not run | pass (SAFE), 58,496 / 139,472 / 152 |

  - Any hole config separates both mutants from the correct rule.
  - HHoleFuzzHi also separates the two mutants from each other. There the
    floor (newest - 1) is never above the oldest time, so the floor alone drops
    nothing, while the newest-held cutoff drops a hole at time 2 under a held
    line at time 3.
  - Without holes, HC_FloorCut passes SAFE with the same counts as the correct
    rule. A floor-alone cutoff differs only on lines in [oldest held, floor),
    and with a contiguous held range only ties of the oldest held line are
    there. That is D35's "cannot be told apart", now confirmed.
- **W_FuzzBelow (evilnet/seance#290), kept as a known weakness.**
  - W_FuzzBelow: one old line, one held line, Fuzz 1, Times {1, 2}. HeldOrder
    is violated (81 states, unchanged).
  - New W_FuzzBelow2: two held lines with Times {1, 2, 3}. When they are tied,
    or less than FUZZ apart, the old line inside the window is kept and
    appended. HeldOrder violated, 955 states.
- **Msgid settling (#290's proposal), HV_MsgidSettle.** Placed drops a page
  line that is older than the oldest held line and is not itself held (by
  msgid), whatever FUZZ says:
  `~(reconnect /\ NHeld > 0 /\ (T(m) < Cutoff \/ (T(m) < HoldsFrom /\ m \notin Held)))`.
  - **Skew = 0: sound in the model.** It passes HeldOrder on W_FuzzBelow (160)
    and W_FuzzBelow2 (1,570), the two configs where the current rule fails.
    It passes SAFE on HBelowHeld, HOld, HOld2, HOldFuzz, HHoleFuzz and
    HHoleOld, and SEANCE on HHoleSeanceFuzz. NoLoss, HoleKept, NoDup and
    Order all hold there.
  - **What it needs.** OldByTime: a stored line's server time never falls
    below that of a line stored before it (one monotone clock for the
    channel's store, no skew between the servers that stamp it). It also
    needs the held lines' times to be server stamps. Seance's `oldestTimeOf`
    reads only msgid-bearing refs, so that part already holds. With Skew = 0,
    T < oldest held implies Old, so the rule drops nothing that is a hole, a
    gap line or a live line.
  - **Skew 1: it loses.** HSkew: one held line @2, a gap line stamped @1 (one
    behind), Fuzz 1. The current rule keeps the gap line, since its cutoff is
    at most newest held - FUZZ and FUZZ ≥ skew (HSkew passes NoLoss, 40
    states). HV_MsgidSettle drops it: NoLoss violated, 22 states.
    CoverSkew shows that OldByTime fails at Init under Skew 1.
  - So #290 is a trade:
    - the current rule pays W_FuzzBelow (order) to tolerate skew up to FUZZ;
    - msgid settling fixes the order, but loses a gap line stamped earlier
      than the oldest held one.
    It is sound only if the network's servers stamp history with clocks that
    agree to better than the gap between the oldest held line and anything
    stored after it.
  - The current rule does not fully tolerate skew either. **W_SkewHole**
    (HHoleFuzz with Skew 1): a hole stamped one below the oldest held line
    falls under the cutoff and is dropped (HoleKept violated, 245 states).
  - Not modelled: a rule that settles by position (a page line before the
    oldest held msgid in the page's server order is old). It needs no clock
    agreement, but only works when the page carries a held line.
- **Trace harness.** history_trace.py passes `Holes = {}` and `Skew = 0`. A
  page line that is neither held, gap nor live is a hole when its time is at
  or above the oldest held line, and goes in among the held lines by time;
  below that it is Old, as before. No fixture has a hole yet: one needs a
  Seance checkout at #282 or later (sformal's client predates it). The stored
  observations replay as in D35:
  - 03a2f172a passes 5/5;
  - d0322ffa7 passes 4 and fails belowHeld on SnapOK;
  - final.jsonl passes 4/4;
  - catchup-develop.jsonl fails 4/4 on SnapOK.
  - Passing traces take 4, 7, 7, 10 and 10 states, as before.
- **TLC runs, local** (-workers 1, three single-worker TLC processes side by
  side). Every line is in `model/results-h13-local.summary`: 114 checks, all
  as expected. The longest took 48 s.
  - **No-holes regression.** All 77 v1.2 checks give the same result and the
    same distinct-state count as `results-h12-local.summary`. This is the
    count at a violation as well as for a pass, and there are no
    differences. The configs gained `Holes = {}` and `Skew = 0`, and SAFE
    gained HoleKept, HoleOrder and OldByTime, which are vacuous or true there.
  - New positives: HHole 1,116; HHoleFuzz 1,212; HHoleFuzzHi 640; HHolePages
    (Limit 2, live line) 23,006; HHoleOld 5,364; HHoleSeance 1,116;
    HHoleSeanceFuzz 1,212; HSkew 40.
  - New failures, as expected:
    - CoverHoleKept 506;
    - CoverHoleBelowFloor 589;
    - CoverDone_HHole 506;
    - CoverDone_HHoleSeance 506;
    - CoverSkew (at Init);
    - W_HoleAppend 577;
    - W_FuzzBelow2 955;
    - W_SkewHole 245.
- **For the cluster (not run here):**
  - two holes (NHeld 2, Holes {2, 3}), and NHeld 3 with one hole, at Limit 1
    or 2 with LiveOn;
  - HHolePages with Fuzz 1 and NOld 1;
  - HV_MsgidSettle on HNoBatchAgrees-sized configs with a hole;
  - Skew with `TimeOrdered = TRUE`: a server that keys its store by time
    would put the skewed line among the held ones, which is a hole.
- **Still left.**
  - Seance's hole placement (W_HoleAppend) is not filed.
  - No catch-up fixture has a hole.
  - D34 item 2 (the restore race) is still out of History.

## D37 Edit.tla v0: the message-edit author rule (#288, #289) (2026-11-12)

Seance PRs #288 and #289 (read at pr289 head e07e163) let a line be replaced
only by its author's edit. This section models that rule.

- **The rule, as the code has it.**
  - An edit is a resent PRIVMSG tagged `+evilnet.github.io/edit` (and
    `+seance/edit`) = the original's msgid (wire.ts:21-41).
  - `isEditAuthor` (channel.ts:61-77) decides who may replace a line:
    - when either line carries an account, the accounts must match, and one
      account against none is refused;
    - otherwise, if both lines are ours (`self`), the edit is taken;
    - otherwise the nicks must match, under the server's casemapping.
  - privmsg.ts:268-284 judges the edit when its original is known (shown,
    or earlier in the same history page). Someone else's edit then loses its
    edit tag and becomes an ordinary line, counted unread (privmsg.ts:337).
  - An edit of an original that is not loaded keeps its tag. It waits for
    the original (privmsg.ts:357, `Channel.awaitOriginal`).
  - When the original arrives (`takeLateEdit`, client.ts:2809-2818), it goes
    behind the waiting edit, if that edit's sender is its author. It then
    counts nothing and gets no inbox entry. This happens both in pushMessage
    (live or catch-up, client.ts:3755-3768) and in an older page
    (`settleLateOriginal`, history.ts:537-549).
- **Model: `model/Edit.tla`, standalone.**
  - It does not EXTEND Delivery. Delivery models our own outgoing copies
    (labels, echoes, batches). The edit rule reads lines that people send,
    and the two share no variable. Composing them would multiply Delivery's
    0.3M-20M-state configs (README) for no interaction.
  - Our own edit's local echo (pending.ts:137) is not modelled.
  - **Server.** A log of lines in server order. Each line is
    `[p, nick, acc, eo, hl]`: the sender, the nick and account at send time,
    the msgid it edits (0 for an original), and whether it highlights us.
  - **People** `{a, m}`, with nicks `{n1, n2, n3}`. They start at n1 and n2:
    the start is fixed, since the nicks are symmetric.
    - `Rename` takes a free nick, and `m` taking a nick `a` left is a
      takeover. MaxRen = 2.
    - `Account` logs a person into their own account or out (MaxAcc = 1).
      The starting accounts are chosen freely.
    - `Me` names the person whose client this is, or "none".
  - **Arrival.** Each line is either read live, right after it is sent
    (before any later line or NICK), or missed.
    - A missed line arrives later in a history page of one or two missed
      lines, in server order.
    - The page is either `append` (a catch-up: deliverAppend, pushMessage
      with replay) or `more` (an older page: deliverPrepend, then
      settleLateOriginal, then countPageUnread without the replaced lines).
    - Each line is judged during the collect pass, against the shown lines
      and the page so far. The queued work runs after delivery: the inbox
      drop, then the placement or the wait.
    - So the model covers both orders (edit before and after the original),
      live and through both replay paths.
  - **Client state.**
    - `shown`, plus the author record per line (`MsgRef.from`) and
      `selfAt`: `isSelf` against our nick at reading time, privmsg.ts:85.
    - `ed` (editOf kept), `sup` (supersededBy), `aw` (editsBeforeOriginal,
      one entry per original, as the Map has it), and `inbox`.
    - `TrimOn`: the UI may drop one loaded line (`chan.forget`). Its inbox
      entry stays, as it would across a reload.
  - **Ghosts.** `cnt` and `hlc` count the unread and highlight increments
    per line; `late` holds the originals hidden as they arrived; `lost`
    holds pairs `<<o, e>>` where e hid o's text, by replacing it in the
    timeline or by dropping its inbox entry.
  - **Abstracted:**
    - the read marker and `isReading` (nothing is read);
    - edits of edits;
    - casefolding (nicks are pre-folded);
    - a trimmed line is never fetched again;
    - pages are any one or two missed lines, not contiguous ranges (an
      over-approximation).
- **Properties.** `Intended(o, e)` is the stated rule on what the lines
  carried when sent:
  - with an account on either line, the accounts are equal;
  - with none, the nicks are equal, or both lines are truly Me's.

  | Property | What it checks |
  |---|---|
  | (a) AuthorOnly | `sup[o] # 0 => Intended(o, sup[o])` |
  | (b) ImpostorIsLine | An edit that is not Intended, of a shown original, not read as ours, is shown unmarked (`ed = 0`) and counted once. |
  | (c) CountOnce | An original plus the edit that replaced it count at most 1. Only without mentions, since a highlight in an edit counts by design (edit.ts:425). |
  | (c) LateSilent | A late-hidden original counts no unread and no highlight. |
  | (d) OriginalKept | Every `lost` pair is Intended: the original's text leaves the timeline or the inbox only for its author's edit. |
  | NoSideBySide | Finding check. |
  | InboxFollowsEdit | Finding check. |
  | AtLeastOnce | Finding check. |
  | SamePerson | By-design check. |
- **Mutants (mkedit.py; one textual edit each):**
  - `EM_NickOnly`: `IsAuthor == nicks equal`;
  - `EM_NoCheck`: `IsAuthor == TRUE`;
  - `EM_OneAccount`: one account against none is not refused (the rule
    before 6c0f3c1);
  - `EM_LateCounts`: `HiddenCounts == TRUE`, so a late-hidden original
    still counts, on both paths.
- **TLC runs, local** (-workers 1, one or three processes at a time). Every
  line is in `model/results-e0-local.summary`. Base constants: MaxMsgs 3,
  MaxRen 2, MaxAcc 1, AccountsOn, PageOn, Mentions off, TrimOn off, Me "none".

| Config | Module | Expect | Result, distinct states |
|---|---|---|---|
| E_Base (SAFE = TypeOK, a, c, c, d) | Edit | pass | pass, 689,952 (1 min 04 s) |
| E_NoLogin (MaxAcc 0) | Edit | pass | pass, 144,552 |
| E_NoAcc (AccountsOn off) | Edit | pass | pass, 36,082 |
| E_LiveOnly (PageOn off; SAFE + b + NoSideBySide) | Edit | pass | pass, 183,024 |
| E_MeLive (Me a, PageOn off; SAFE + b) | Edit | pass | pass, 183,024 |
| E_Mentions (Mentions; TypeOK, a, LateSilent, d) | Edit | pass | pass, 5,426,064 (8 min 28 s) |
| E_LateSilent (Mentions; LateSilent) | Edit | pass | pass, 5,426,064 (7 min 54 s) |
| E_CountOnce (CountOnce) | Edit | pass | pass, 689,952 |
| E_Me (Me a, no accounts) | Edit | pass | **AuthorOnly violated, 9,558** (finding 3) |
| E_MeAcc (Me a, accounts) | Edit | pass | **AuthorOnly violated, 162,149** (finding 3; the trace starts without accounts) |
| W_ImpostorFirst (b) | Edit | fail, known | ImpostorIsLine violated, 1,826 |
| W_SideBySide | Edit | fail, finding | NoSideBySide violated, 10,311 (finding 2) |
| W_Silent | Edit | fail, finding | AtLeastOnce violated, 1,726 (finding 4) |
| W_SamePerson (no accounts) | Edit | fail, by design | SamePerson violated, 2,938 (m takes n1 and edits a's line) |
| W_InboxNick (Mentions) | Edit | fail, finding | InboxFollowsEdit violated, 12,948 (finding 1b) |
| W_InboxTrim (Mentions, TrimOn) | Edit | fail, finding | OriginalKept violated, 507,534 (finding 1a, a logs out) |
| W_InboxTakeover (Mentions, TrimOn, MaxAcc 0) | Edit | fail, finding | OriginalKept violated, 902,841 (finding 1a, takeover) |
| E_Base | EM_NickOnly | fail | AuthorOnly violated, 2,051 (a's line with an account, a's edit after logging out) |
| E_NoLogin | EM_NickOnly | fail | AuthorOnly violated, 7,660 (a → n3, m → n1, m edits a's line; both have accounts) |
| E_NoAcc | EM_NickOnly | pass (same as the code without accounts and without Me) | pass, 36,082 |
| E_Base | EM_NoCheck | fail | AuthorOnly violated, 264 |
| E_NoAcc | EM_NoCheck | fail | AuthorOnly violated, 100 |
| E_Base | EM_OneAccount | fail | AuthorOnly violated, 2,051 |
| E_Base | EM_LateCounts | fail | LateSilent violated, 1,726 |
| E_LateSilent | EM_LateCounts | fail | LateSilent violated, 6,610 |
| E_CountOnce | EM_LateCounts | (probe) | **pass, 689,952**: CountOnce does not catch it (see below) |
| CoverNickChangeAccount | Edit | fail | violated, 1,924 |
| CoverTakeoverRefused | Edit | fail | violated, 11,576 |
| CoverLateHidden | Edit | fail | violated, 1,726 |
| CoverInboxDrop (Mentions, TrimOn) | Edit | fail | violated, 6,661 |
| CoverPageJudged (an impostor's edit refused against an original in the same page) | Edit | fail | violated, 264 |
| CoverImpostorWaits (an impostor's edit waits for an original) | Edit | fail | violated, 263 |

  - Every mutant is caught by the property it targets.
  - EM_LateCounts is caught by LateSilent but not by CountOnce. The reason
    is finding 4: the author's edit, read first, counted nothing, so the late
    original counting once still totals one. CountOnce is kept, because it
    would catch a double count. LateSilent is the property that pins the rule.
- **Findings: code against intent** (file:line at pr289 e07e163):
  1. **The inbox drop matches nicks, not accounts.**
     - privmsg.ts:322-331 dispatches `inbox:drop` with `by: nick` whenever
       the edit tag survived.
     - helpers/inbox.ts:262-276 (the test is at :274) drops the entry when
       `casefold(e.from.nick) === casefold(by)`.
     - InboxEntry (shared/types/mention.ts:7-24) carries no account.
     - (a) **W_InboxTrim / W_InboxTakeover.** The original is not loaded
       (trimmed by the UI, or after a reload), but its mention is in the
       inbox. Then an edit tag survives unjudged (privmsg.ts:273-284), and
       anyone now under the original's nick drops the entry. In the takeover
       trace, a (account a) moves n1 → n3 and m (account m) takes n1 and
       edits a's line. The timeline would refuse this edit, but the inbox
       loses a's mention. This breaks (d).
     - (b) **W_InboxNick.** The reverse case. a's own edit across a nick
       change (same account) replaces the line, but the drop names the new
       nick, so the original's inbox entry, with its old text, stays.
     - Fix direction: give InboxEntry the sender's account and use
       `isEditAuthor` in `dropMessage`.
  2. **One waiting edit per original.**
     - channel.ts:163 `editsBeforeOriginal` is a Map, and `awaitOriginal`
       (:311-313) overwrites its entry.
     - W_SideBySide: a's edit and m's edit of a's line both arrive (here in
       one page) before the original. m's entry replaces a's. When the
       original comes, it is refused, so it stands beside a's edit (still
       marked edited and uncounted). channel.ts:157-162 says this never
       happens.
     - Fix direction: keep the author's entry. Either do not overwrite an
       entry whose sender would be the author of a later original, or keep
       a list and take the first one whose sender `isAuthor`.
  3. **`self` is judged at read time** (privmsg.ts:85; channel.ts:69-71).
     - E_Me: a (us) says a line as n1, which we miss. m edits it as n2. m
       moves to n3. A page brings our line (self). We move to n2. A page
       brings m's edit, and its n2 is now our nick, so it reads as self.
       `self && self` takes it, and m's edit replaces our line on our screen.
     - This needs no accounts and both lines in history. The nicks differ
       (n1 vs n2), so the stated "otherwise the nicks must match" would
       refuse it. The doc comment at channel.ts:56-57 says `self` follows the
       current nick, so this is a consequence the code knows about, but it is
       wider than the nick rule.
     - Live lines are safe: E_MeLive passes. Low severity.
  4. **An author's edit that arrives before its original leaves the
     message uncounted** (W_Silent).
     - The live edit is pushed with `increasesUnread = !self && !editOf`,
       which is false (privmsg.ts:337). A page edit fails `countsAsUnread`
       (channel.ts:30-35).
     - The late original is then hidden, so it counts nothing either.
     - test/irc/edit.ts:503-547 asserts exactly this, so it may be intended.
       But the comment at client.ts:3753-3754 ("the edit counted in its
       place") is wrong. Either the edit should count when it waits for an
       original, or the comment should say that nothing counts.
  5. **Known weakness, unchanged: someone else's edit before the original**
     (W_ImpostorFirst).
     - The edit tag survives when the original is unknown
       (privmsg.ts:273-284).
     - When the original comes, `takeLateEdit` (client.ts:2809-2818)
       refuses it, so the original shows and counts.
     - But the impostor's line stays marked as an edit, is never counted,
       and may already have dropped an inbox entry (finding 1a). This
       breaks (b).
- **Not done:**
  - Our own edit's local echo, and the REDACT-first send path.
  - Edits of edits (the `applyEdit` chain, messageUpdates.ts:117-133).
  - Read markers.
  - Casemapping differences between `fold` and inbox.ts's generic `casefold`.
  - Re-fetching a trimmed line. Without it, a trimmed original that comes
    back beside its edit is not explored.
  - No trace harness against the TypeScript.
- **For the cluster (not run here):**
  - MaxMsgs 4: two edits of one original plus an unrelated line, or an edit
    whose page also brings the original;
  - E_Mentions with TrimOn (507k-903k states before the first violation;
    a full pass after a fix of finding 1 would be several million);
  - MaxRen 3, and MaxAcc 2.

## D38 A hole fixture, and placing page lines by server time (#290, #292) (2026-11-12)

Answers D36's "no catch-up fixture has a hole" and evaluates the candidate
fix for evilnet/seance#290 and #292: keep the drop (a page line below
min(newest held - FUZZ, oldest held) is not placed), but place every kept
page line by server time among the rows, instead of appending it with an
id from the reserved block.

- **Fixture `hole` (catchup_fixtures.py).** Held h@12:10 and i@12:14; x@12:12
  was stored between them and never reached the client; gap a@12:16;
  Limit 4, one LATEST page `h, x, i, a` that holds a held msgid, so the
  walk stops on it. Run against /home/claude/sfix, develop 9a831568f (with
  #282), stored as `results/9a831568f.jsonl`:
  - the five earlier fixtures PASS;
  - `hole` FAILS: `Order: h,i,x,a`. Store rows (id, msgid): 6 h, 7 i, 13 x,
    14 a. x is kept (no loss, no duplicate) but takes id 13 from the
    reserved block, and insertMessage places it below i. This is #292 on
    this sha. IdsRise passes, since the ids rise in that wrong order.
- **TLC trace (history_trace.py, local, -workers 1).**
  - 9a831568f.jsonl: liveStop, liveStopControl, gapOrder, clockFloor and
    belowHeld PASS; `hole` FAILS SnapOK at the last step (4 distinct
    states). The harness maps x to a hole (`Holes = {2}`) and runs
    `InsertMerge = TRUE`, so the model's buffer is `<<1, 2, 3, 4>>`
    (h, x, i, a) and Seance's is `<<1, 3, 2, 4>>`.
  - One-off, not in the harness: the same HT_hole module with
    `InsertMerge = FALSE` (an appending client) passes NotStuck and SnapOK
    (4 states), and with HoleOrder added it violates HoleOrder (4 states).
    So Seance at 9a831568f behaves as History's appending client,
    and that client is W_HoleAppend.
  - Replays after the model change below: 03a2f172a 5/5 PASS; d0322ffa7
    fails belowHeld on SnapOK, as in D35.
- **What changed in History.tla (v1.4).** Only a new invariant,
  **PlacedOrder** (not in SAFE): around every line a page placed (neither
  held nor the live line), the row just before it is no newer, and no
  later row other than the live line is older. Placer and PlacedOrder are
  additive; the 114 v1.3 checks give the same results and distinct-state
  counts as `results-h13-local.summary`.
- **The variant, HV_PlaceByTime (mkhist.py).** `Placed` and the cutoff are
  unchanged. A page's kept lines go through `Merge1P`: dedupe by msgid,
  else insert after the last row whose time is at most the line's
  (`PlaceAt`). Live lines are still merged by `InsertMerge` (Seance appends
  them). In Seance this means giving a kept page line an id between the
  ids of its time neighbours, not the next id of the reserved block.
- **New configs (mkhist.py):**
  - `HHoleSeancePages`: a hole, Limit 2, a live line, appending;
  - `W_FuzzBelowPages`: #290 over two pages (NOld 1, NHeld 2, Limit 2,
    Fuzz 1, appending);
  - `HSkew2` (Skew 1, two held lines, Times {1, 2, 3}), `HSkewLive` (HSkew
    plus a live line), `HSkewHole` (a hole, Fuzz 1, Skew 1, Times {2, 3}:
    the cutoff cannot reach the hole);
  - `W_SkewLive`: under Skew a live line can be stamped below the oldest
    held one; it is appended, so HeldOrder fails whatever the page rule.
  - `HR_Current` is History unchanged under another module name, to run
    the current rule against the same invariant sets.
  - Invariant sets: SKEWINV = TypeOK NoLoss NoDup ContentOnce HoleKept
    PlacedOrder HeldOrder; SKEWINVL drops HeldOrder (live-line configs, see
    W_SkewLive); LOSS = NoLoss NoDup ContentOnce HoleKept.
- **TLC runs, local** (-workers 1, three TLC processes side by side;
  `model/results-h14-local.summary`, 154 checks, all as expected; the
  whole list took about 5.5 minutes, the largest 139,472 states).

| Config | HV_PlaceByTime | current rule (History / HR_Current) | HV_MsgidSettle |
|---|---|---|---|
| W_FuzzBelow (#290, one held) | SAFE+PlacedOrder pass, 160 | HeldOrder violated, 81; PlacedOrder violated, 81 | HeldOrder pass, 160 (D36) |
| W_FuzzBelow2 (#290, two held) | SAFE+PlacedOrder pass, 1,570 | HeldOrder violated, 955 | HeldOrder pass, 1,570 (D36) |
| W_FuzzBelowPages (#290, Limit 2) | SAFE+PlacedOrder pass, 1,590 | HeldOrder violated, 975 | HeldOrder pass, 1,590 |
| W_HoleAppend (#292) | SAFE+PlacedOrder pass, 1,116 | HoleOrder violated, 577; PlacedOrder violated, 577 | PlacedOrder violated, 577 |
| HHoleSeancePages (hole, live, Limit 2) | SAFE+PlacedOrder pass, 23,006 | SEANCE pass, 24,102; PlacedOrder violated, 5,627 | PlacedOrder violated, 5,627 |
| HHole / HHoleSeance / HHoleSeanceFuzz | SAFE+PlacedOrder pass, 1,116 / 1,116 / 1,212 | pass (HHole SAFE; Seance ones SEANCE only) | HHoleSeanceFuzz SEANCE pass (D36) |
| HHoleFuzz / HHoleFuzzHi / HHoleOld / HHolePages | SAFE+PlacedOrder pass, 1,212 / 640 / 5,364 / 23,006 | SAFE pass (D36) | HHoleFuzz, HHoleOld SAFE pass (D36) |
| HOld / HOld2 / HOldFuzz / HBelowHeld | SAFE+PlacedOrder pass, 14,206 / 58,496 / 139,472 / 152 | SAFE pass (D35) | SAFE pass (D36) |
| HSkew (Skew 1; msgid settling's loss) | SKEWINV pass, 40 | LOSS pass, 40; PlacedOrder violated, 21 | NoLoss violated, 22 |
| HSkew2 | SKEWINV pass, 192 | LOSS pass, 192; PlacedOrder violated, 87 | NoLoss violated, 104 |
| HSkewLive | SKEWINVL pass, 706 | LOSS pass, 736; PlacedOrder violated, 89 | NoLoss violated, 91 |
| HSkewHole | SKEWINV pass, 160 | LOSS pass, 160; PlacedOrder violated, 69 | HoleKept violated, 85 |
| W_SkewHole (hole below the cutoff) | HoleKept violated, 245 | HoleKept violated, 245 (D36) | not run |
| W_SkewLive (live line under Skew) | not run as such (SKEWINVL leaves HeldOrder out) | HeldOrder violated, 86 | not run |

  - The current rule's "LOSS pass" entries are the History configs
    (invariants NoLoss NoDup HoleKept, with Terminates), not HR_Current.
  - **Expectation corrected after the first run.** The first run expected
    HR_Current to pass SKEWINV on HSkew, HSkew2 and HSkewLive. It fails
    PlacedOrder (21, 87 states): the current rule appends a gap line stamped
    one below the held line after it. The first run also used SKEWINV
    (with HeldOrder) on HSkewLive, and all three rules violated HeldOrder
    at 86 states. The trace is the live line stamped @1 under a held line
    @2, relayed and appended: not a page placement. That case is now
    W_SkewLive, and HSkewLive runs SKEWINVL. A second bug in the first
    list gave two HV_MsgidSettle runs the same config file name; mkhist.py
    now asserts names are unique, and HV_MsgidSettle's skew rows above are
    the LOSS runs. The table is the final list's run, except where it
    names the first run.
  - **One-off runs** (not in list-h1, configs deleted after): on
    HV_PlaceByTime, HSkew2 with `INVARIANT Order HoleOrder` violates Order
    (98 states: held @2 then @1, already out of time order, gap @1 placed
    after them); HSkewHole with `INVARIANT HoleOrder` violates HoleOrder
    (81 states: held 1@3, hole 2@2, held 3@2, gap 4@2 gives
    `<<1, 3, 2, 4>>`: by time the hole goes after the held line stamped
    like it, against store order).
- **Answers.**
  - **#290 and #292 together: yes, at Skew = 0.** HV_PlaceByTime passes
    the whole SAFE set (Order, HeldOrder, HoleOrder, NoLoss, NoDup,
    HoleKept) and PlacedOrder on every Skew 0 config above, including the
    appending ones (W_FuzzBelow, W_FuzzBelow2, W_FuzzBelowPages,
    W_HoleAppend, HHoleSeance*, HHoleSeancePages, HBelowHeld). The #290 line
    is kept, as now, and goes above the held lines; the #292 hole goes
    between its held neighbours. Distinct-state counts equal the
    time-merging client's (for example HHolePages and HHoleSeancePages both
    23,006).
  - **Skew 1: nothing lost or duplicated that the current rule keeps.**
    NoLoss, NoDup, ContentOnce and HoleKept pass on HSkew, HSkew2, HSkewLive
    and HSkewHole. The drop is unchanged, so the drop's own weakness
    stays: W_SkewHole (a hole stamped below the oldest held line, under
    the cutoff) loses the hole under both place-by-time and the current
    rule. Msgid settling loses a gap line on HSkew, HSkew2 and HSkewLive and
    a hole on HSkewHole.
  - **Ordering under Skew.** Neither store order (HoleOrder) nor a sorted
    buffer (Order) can be promised. A client sees times and not the store;
    held rows arrived in store order and may already be out of time order,
    and the one-off runs show both properties failing. The right property
    is PlacedOrder: every line the catch-up placed sits after a row no newer
    than it and before rows no older (live lines aside). It is local time
    order around what the client inserted, and it says nothing about held
    rows it never moved. It holds for place-by-time on every config here,
    with or without Skew. It fails for the current rule (appending), and for
    msgid settling, which also appends, wherever a kept line is older than
    a row already shown. With Skew = 0, PlacedOrder plus the held rows'
    own order gives Order.
  - Live lines are outside every rule here: under Skew a live line stamped
    below a held one is appended (W_SkewLive), as relayed lines always
    are in Seance.

| | current rule (#282) | msgid settling (#290 proposal) | place by time (D38) |
|---|---|---|---|
| #290 order (W_FuzzBelow, W_FuzzBelow2, W_FuzzBelowPages) | fails HeldOrder | passes | passes |
| #292 hole order (W_HoleAppend, HHoleSeancePages) | fails HoleOrder / PlacedOrder | fails PlacedOrder (still appends) | passes |
| Skew 0, loss and duplicates | none | none | none |
| Skew 1, loss (HSkew, HSkew2, HSkewLive, HSkewHole) | none | loses a gap line or a hole | none |
| Skew 1, hole stamped below the cutoff (W_SkewHole) | lost | not run | lost (same drop) |
| Skew 1, PlacedOrder | fails | fails (first run, SKEWINV: HSkew2 87, HSkewHole 69 states) | passes |
| Needs | nothing | one monotone clock for the channel's store | an id between two existing rows' ids |

- **Verdict.** Place-by-time is the fix to prefer. It fixes #290's order and
  #292 together. It keeps the current rule's tolerance of skew up to FUZZ
  (no new loss), and it gives the one order guarantee that holds under
  skew. Msgid settling fixes only #290, and buys that with a loss under
  skew. Place-by-time leaves W_SkewHole (a hole skewed below the cutoff) as
  it is, as does the current rule. In Seance the change is in how a kept page
  line gets its id (catch-up's reserved block, `IdAllocator.reserve`, and
  `insertMessage`'s `placeId`). It needs an id between the neighbours' ids,
  or a placement by time that does not read ids.
- **Not done.**
  - No Seance code changed, so no fixture runs place-by-time. The fixture
    passing on a fix would be the check: `hole` with Order and SnapOK.
  - Not modelled: a #290 line kept above the held rows under Skew can leave
    a stored-later line below the cutoff dropped. A later "more" then asks
    BEFORE that kept line's msgid, which skips the dropped line, because it
    was stored after the kept one. That is a loss in the Old range, which
    NoLoss does not cover.
  - No place-by-time-plus-msgid-settling variant was run.
- **For the cluster (not run here):** HV_PlaceByTime on two holes (NHeld 2,
  Holes {2, 3}) and NHeld 3 with one hole, at Limit 1-2 with LiveOn; on
  HNoBatchAgrees-sized configs with a hole; and with Skew 1 plus NOld 1
  and MayFail.

## D39. What check_lr.py accepts besides a lone echo, ACK or error (2026-11-13)

The widened trace scenarios (record_lr.py, about 60 commands, nefarious2 253218e0 and Ergo, echo-message on and off) showed shapes the first checker misjudged: a labeled batch, a lone labeled 301 without echo-message, and a NOTICE answered by ACK. Ergo produces all three. The first relaxations were wider than their reasons, and five review rounds found thirty false results between them, both ways. Every one is now a case in `delivery/test_check_lr.py`, so the checker reads a response as the specs define it rather than by its first settling line:

- **Batches** (batch spec). Every batch in the row is tracked in order. A reference is letters, digits and hyphens, and a line may name only an open batch (`BatchRef`). Every batch the row opens must end, the response's and any other, and a reference may not start again while open (`BatchClosed`). A start has a type and an end has nothing after its reference (`BatchSyntax`). A nested batch's start and end name the same outer batch (`BatchNest`): either MAY name one, and once one does, both must. The labeled batch is `labeled-response`, or a type that answers the whole command: `chathistory` and `draft/chathistory-targets` for CHATHISTORY, `draft/multiline` for the echo of any message. Anything else fails `BatchType`. An empty `labeled-response` batch is no response at all; ACK is the reply for none (`EmptyBatch`). An empty chathistory batch is a real answer. ACK takes no parameters. The labeled batch and every batch in it must end (`BatchClosed`).
- **One response** (LR). Every reply to the command is inside the labeled response, whether it is a lone line or one batch with its nested batches (`OneResponse`). Four kinds of line are not replies: lines from other users; a message, or a multiline batch, from us to us, which is the delivered copy (a delivered multiline batch must still be well formed); a server NOTICE to us; and a netsplit or netjoin batch. The last two are traffic. ACK only ever stands alone (`AckOnlyAlone`).
- **Echoes** (echo-message, multiline). The response is flattened through nested batches. A line is an echo only if it comes from us with the sent command. A multiline batch is one echo only if it is `draft/multiline` (the draft forbids the unprefixed name) and every line in it comes from us, with the sent command, to its target. The BATCH line itself may come from the server; the lines carry the sender. For a multiline send nothing else is an echo. record_lr's multiline scenes send PRIVMSG lines, so the checker expects PRIVMSG. With echo-message on, every target needs its echo or an error naming it (`EchoEach`), and 301s may sit beside them. An error is about the params between its recipient (for a numeric) or its command and code (for a FAIL) and its description, which is the trailing parameter when there is one. The description is prose, and names nothing. The multiline limit FAILs (`MULTILINE_MAX_BYTES`, `MULTILINE_MAX_LINES`, `MULTILINE_INVALID`) carry a limit, not a target, and refuse the whole message. An error about no param at all, such as 412 or a FAIL with no context, answers the whole command, but only when the response is errors alone. An error about a nick that is not a target answers no target. Without it, there is no echo; ACK, any number of 301s, and errors are the whole response. So a lone labeled 301, or several in a batch, accepts the message.
- **A NOTICE the server drops** (a moderated channel) draws no error (D20), so with echo-message on, ACK answers it. This passes only in the scenes listed in `NOTICE_DROPS`. That is an assumption about the fixture, not a protocol rule: the trace cannot show the drop.

With these, Ergo holds 63/63 both ways. nefarious2 fails exactly the filed issues:
- the away cases with echo on (#224). The labeled 301 has its echo outside the response, so they fail both `OneResponse` and `EchoEach`, except `privmsg-self-away`, whose unlabeled copy is a message to us and fails `EchoEach` alone;
- the silenced PRIVMSG answered by ACK (#227, filed as a question);
- the multiline batch with echo off that gets no labeled reply (#225).

#226 (STATUSMSG answered by 401) settles by its error. It is a delivery bug, not a label one, so the checker does not flag it. Ergo has no SILENCE command, so its `privmsg-user-silenced` trace is a plain delivered PM and says nothing about #227.
