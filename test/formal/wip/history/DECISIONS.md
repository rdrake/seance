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
