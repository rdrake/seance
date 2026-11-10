# History and delivery: the rules from the spec text

Model (a) of the queue (`../formal-spec/QUEUE.md`). It uses the same method as the handshake
spec model:
- every normative sentence in scope, with file:line;
- one model built from this text alone;
- witnesses, mutants and Codex review;
- trace validation against Ergo and nefarious2;
- refinement of Seance's code: `client/js/irc/catchup.ts`, pending messages and labels.

**Source:** `../formal-spec/specs-src/` at 9ff58d1. Prefixes:

| Prefix | File |
| --- | --- |
| CH | `extensions/chathistory.md` (work in progress; `draft/chathistory`) |
| CB | `batches/chathistory.md` |
| BA | `extensions/batch.md` |
| LR | `extensions/labeled-response.md` |
| EM | `extensions/echo-message.md` |
| MI | `extensions/message-ids.md` |
| ST | `extensions/server-time.md` |
| MT | `extensions/message-tags.md` |

**Level:** upper-case MUST, SHOULD and MAY are normative. Lower-case and plain prose are
descriptive (as in the handshake model, the repository defines no RFC 2119 boilerplate).
"Model" says how each rule is meant to appear: a guard (G), an invariant (I), an action
property (A), a liveness property (L), a switch (S), or out of scope (-).

## Batches

| Id | Where | Level | Rule | Model |
| --- | --- | --- | --- | --- |
| BA-1 | BA:37-43 | MUST | `BATCH +ref type params` starts a batch; `BATCH -ref` ends it. | message kinds `BStart(ref, type)`, `BEnd(ref)` |
| BA-2 | BA:45-46 | MUST | The reference is opaque and case-sensitive. | refs are model values |
| BA-3 | BA:51 | MUST | Batched events carry `batch=ref`. | message field `batch` |
| BA-4 | BA:52 | MUST NOT | Messages before the start or after the end of a batch (including the start and end lines of that batch) do not refer to it. | I on the server's output |
| BA-5 | BA:54 | MUST | Every started batch is ended. | L (server) |
| BA-6 | BA:55 | MAY | The client may delay processing batched events until the end. | client switch: buffer until end, or process at once |
| BA-7 | BA:57-58 | SHOULD | An empty batch is a no-op unless its type says otherwise. | client |
| BA-8 | BA:60-63 | MUST | Nested batches: the start and end of an inner batch both carry the same outer `batch` tag. The client may delay inner processing to the end of the outermost. | nesting depth 2 (labeled-response around chathistory) |
| BA-9 | BA:93-98, BA:100-112 | (example) | An unbatched line may fall between a batch's lines (93-98); batches may interleave with each other (100-112). | server may interleave |
| BA-10 | BA:78-81 | MAY | A client may ignore an unknown type and process messages one by one. | - |

## Labeled responses

| Id | Where | Level | Rule | Model |
| --- | --- | --- | --- | --- |
| LR-1 | LR:31 | MUST | `batch` must be negotiated to use labels. Negotiation order is not significant and MUST NOT be enforced. | client sends labels only with batch and labeled-response on |
| LR-2 | LR:53 | MUST | For a labeled message, the server includes the same label in any response required from it "where it is feasible to do so". | A; "feasible" is a server switch (D?) |
| LR-3 | LR:53 | MUST | The label is in exactly one logical message. | I: per label, at most one labeled logical response |
| LR-4 | LR:55-58 | MUST | A response of more than one message is a batch whose start carries the label. Its type is one applicable to the whole response, or `labeled-response`. | e.g. a labeled CHATHISTORY: a `chathistory` batch carrying the label, or one inside a `labeled-response` batch |
| LR-5 | LR:60 | MUST NOT | A message the client sends to itself: the delivered copy carries no label. Only the echo-message acknowledgment carries it. | self-PRIVMSG case |
| LR-6 | LR:64 | SHOULD NOT | The client does not reuse a label until it has received a complete response for it. | G (client) |
| LR-7 | LR:64 | MUST NOT | A label is at most 64 bytes. | - |
| LR-8 | LR:68-70 | MUST | A labeled command that normally produces no response gets a labeled `ACK`. | server |
| LR-9 | LR:76-83 | (non-normative) | Some labeled requests get no response at all (netsplit). Clients handle that as without labels. | the client must not wait forever: L under a lossy-server switch |
| LR-10 | LR:85-92 | (non-normative) | echo-message plus labels: the pending local message is cleared by the labeled echo. For a self-message, either ignore the labeled copy or the unlabeled one. | Seance's pending messages |

## echo-message

| Id | Where | Level | Rule | Model |
| --- | --- | --- | --- | --- |
| EM-1 | EM:21-22 | MUST | With echo-message on, PRIVMSG and NOTICE go back to the client that sent them. | A/L: every accepted message is echoed |
| EM-2 | EM:22-24 | MUST | If the server modifies the message, the echo is the final version. | the echo carries the stored msgid and text |
| EM-3 | EM:26-30 | MUST | The client treats a self-sent message the same as if it had sent it to the target. | client |
| EM-4 | EM:34-35 | descriptive (inherits EM-1/EM-2's MUSTs) | With message-tags, "the same rules apply" to TAGMSG. | TAGMSG as a message kind (optional) |
| EM-5 | EM:50-52 | MAY | The server may echo a faked message when the real one is silently blocked. | server switch: blocked message echoed but not stored or delivered |

## Message IDs

| Id | Where | Level | Rule | Model |
| --- | --- | --- | --- | --- |
| MI-1 | MI:25 | MUST | message-tags is negotiated before a server uses msgid. | precondition |
| MI-2 | MI:31 | SHOULD | If msgid is used, it is on every PRIVMSG and NOTICE. | every stored message has an id |
| MI-3 | MI:35 | MUST | Unique across the network for all time. | ids are fresh model values |
| MI-4 | MI:39 | SHOULD / MUST | A re-transmitted message (chathistory) reuses its id (SHOULD); clients accept shared ids (MUST). Accepting does not require deduplicating: that is a client choice. | replay carries the stored id (CH-18 makes it a MUST for chathistory); dedupe is a client switch |
| MI-5 | MI:41 | MUST | Clients compare ids case-sensitively and opaquely. | - |
| MI-6 | MI:74-78 | (non-normative) | Ids need not increase; do not correlate them across networks; handle accidental reuse gracefully. Nothing requires ordering by time: that is a client choice. | client never orders by id |

## chathistory

| Id | Where | Level | Rule | Model |
| --- | --- | --- | --- | --- |
| CH-1 | CH:41 | MUST | `draft/chathistory` is negotiated. | precondition |
| CH-2 | CH:41 | SHOULD NOT | With it negotiated, the server does not play back history automatically (on JOIN). | server switch |
| CH-3 | CH:49 | MUST / SHOULD | ISUPPORT `CHATHISTORY=n` is sent: the maximum per request (MUST). If 0, the client SHOULD assume there is no maximum. | constant `Limit` > 0 |
| CH-4 | CH:51-56 | SHOULD / MUST / SHOULD | `MSGREFTYPES` SHOULD list the supported reference types; clients MUST ignore unknown ones; if it is absent, clients SHOULD assume both, with no preference. | constant: msgid and timestamp (D11) |
| CH-5 | CH:67 | MUST | A selector has the format `timestamp=YYYY-MM-DDThh:mm:ss.sssZ` or `msgid=foobar`. | selector record (syntax out of scope) |
| CH-6 | CH:69 | MUST / should / MAY | The limit is a positive integer. The server "should attempt" exactly `limit` (or as many as available), but MAY return more or fewer. | server returns any count (switch: exact) |
| CH-7 | CH:71 | MUST | With batch negotiated, a successful CHATHISTORY is answered with a batch of type `chathistory` and the target's canonical name. | batch type |
| CH-8 | CH:71 | SHOULD | With no content, an empty batch. | server switch: empty batch or nothing |
| CH-9 | CH:73 | MUST NOT | Without `draft/event-playback`, only PRIVMSG and NOTICE in the reply batch (unless another negotiated cap allows more). | message kinds |
| CH-10 | CH:83 | descriptive / MUST | BEFORE requests up to limit messages before, and excluding, the selector (descriptive). Exactly one timestamp or msgid MUST be given. | server query semantics (D10) |
| CH-11 | CH:89 | descriptive / MUST | AFTER: up to limit after, and excluding, the selector (descriptive). Exactly one selector MUST be given. | |
| CH-12 | CH:95 | descriptive / MUST | LATEST `*`: the most recent up to limit; with a selector, restricted to after and excluding it (descriptive). Without `*`, exactly one selector MUST be given. | |
| CH-13 | CH:103 | descriptive / MUST | AROUND: before and after, at most limit in total; the split is the implementation's (descriptive). Exactly one selector MUST be given. | - |
| CH-14 | CH:111 | MUST | BETWEEN: counted from, and excluding, the first selector, finishing on, and excluding, the second. Either direction in time. | |
| CH-15 | CH:115-123 | MUST | TARGETS: timestamps only, matched against each target's latest message. | out of scope at first (one target) |
| CH-16 | CH:126 | SHOULD | The order within a batch is implementation-defined, but ascending time or an approximation of it. | server switch: ascending, or any |
| CH-17 | CH:126 | SHOULD | server-time is the time the server received the message. | each message has one time |
| CH-18 | CH:126 | MUST | The msgid of each returned message is the msgid as originally sent. | I: a replayed id equals the stored id |
| CH-19 | CH:128 | SHOULD / SHOULD | A consistent order for the connection's lifetime that orders any two messages, even with equal timestamps, so msgid pagination works (SHOULD). This order SHOULD coincide with the order within a response batch. It need not match delivery order. Ascending time (CH-16) is a separate SHOULD. | the server's order per connection is a sequence; batch order agrees with it (switch); delivery order may differ |
| CH-20 | CH:132 | MUST | Context messages carry `draft/chathistory-context`, immediately follow their parent and do not count toward the limit. | - (first version) |
| CH-21 | CH:136 | SHOULD | `draft/chathistory-end` on the first BATCH line when no more messages are available. | server switch; a client may stop paging on it |
| CH-22 | CH:141-160 | SHOULD | Errors use standard replies: INVALID_PARAMS, INVALID_TARGET, MESSAGE_ERROR, INVALID_MSGREFTYPE. | a FAIL reply kind (labeled, so it is the response) |
| CH-23 | CH:190-224 (ignore-live advice: CH:214) | (non-normative) | The client pseudocode: fill a gap with LATEST then BEFORE pages, dedupe, and stop at the lower bound minus FUZZ or at chathistory-end. Without dedupe, ignore live messages until the reply batch is complete. | the client algorithm the model checks; Seance's catchup.ts is checked against it |
| CH-24 | CH:239 | (non-normative) | There is no global order across servers, and clock skew means relay, store and replay orders can differ from timestamp order. | server switches: skewed times, two linked servers |
| CH-25 | CH:245 | MUST | Users cannot obtain history they are not authorised to view. | - (one authorised user) |

## Batch type chathistory and server-time

| Id | Where | Level | Rule | Model |
| --- | --- | --- | --- | --- |
| CB-1 | CB:17-20 | MUST | The parameter is the nick (private) or a channel the client is in. | one channel target |
| CB-2 | CB:22-27 | SHOULD / MUST | History relayed automatically goes into one chathistory batch (SHOULD). With server-time, each message carries its original time (MUST). | CH-2's automatic playback, if modelled |
| ST-1 | ST:41 | MUST NOT | No `time` before the cap is ACKed. | precondition (the handshake model's domain) |
| ST-2 | ST:39 | SHOULD | The client uses `time` as the message's time. | client |
| MT-1 | MT:118 | MUST | Client-only tags are relayed on PRIVMSG, NOTICE and TAGMSG. | - |

## What the model is for (properties to state)

From the rules above, plus what a client user expects. Each must be checked against the text:
nothing above promises it outright, so each is a claim about a client algorithm under stated
server switches.
- **No loss.** Every message stored in the channel while the client was away, between its last
  seen message and now, ends up in the client's buffer once the client has finished catching up
  (CH-10 to CH-14, CH-18, CH-19, CH-23), under a server that returns exact pages (CH-6) in a
  consistent order (CH-19).
- **No duplicates.** No msgid appears twice in the buffer (MI-4, CH-18).
- **Order.** The buffer is in the server's order (CH-16, CH-19), or explicitly not, under the
  out-of-order switch.
- **Pending messages resolve.** Each message the client sent is, eventually, either confirmed by
  its labeled echo, failed by a labeled error, or timed out (LR-2, LR-3, LR-9, EM-1). It never
  stays pending forever and is never confirmed twice.
- **Labels.** The label of a request is seen in exactly one logical response (LR-3). The client
  never reuses a label with a response outstanding (LR-6).
- **Batches.** Well-formed nesting and closing (BA-4, BA-5, BA-8), and the client attributes
  every batched line to the right batch.

## Open questions for DECISIONS.md

- **D1:** whether "where it is feasible" (LR-2) lets a server drop the label from a response, or
  only covers responses that never come.
- **D2:** what "exactly one logical message" (LR-3) means for an echo that arrives inside a
  `labeled-response` batch.
- **D3:** whether a server may count context and non-PRIVMSG lines toward the limit (CH-6, CH-20).
- **D4:** BETWEEN in reverse (CH-14): which end the page is counted from.
- **D5:** the timestamp-selector boundary with several messages at the same time (CH-19 plus
  CH-10/11).
- **D6:** live messages that arrive during a catch-up page: before, inside or after the batch
  (CH-23's "ignore until complete", CH:214, applies only to clients without dedupe).

All of these are now in `DECISIONS.md`, with D10-D14 added after review 1.

## Out of scope, listed so the inventory is complete (review 1, 1.4 and 1.5)

These normative sentences are in the files above but act on layers the model abstracts: names,
syntax, wire encoding and authorisation. The model assumes them and checks none of them.

| Where | Level | Rule |
| --- | --- | --- |
| CH:27-29 | MUST NOT / SHOULD | No unprefixed `chathistory`/`event-playback` cap names; use the `draft/` names. The `chathistory` batch type is used unprefixed. |
| CH:39 | descriptive / SHOULD NOT | Full support needs batch, server-time and message-tags; limited use without them (descriptive). Servers SHOULD NOT enforce that clients support all related caps (D11). |
| CH:43, 73 | MAY / SHOULD | `draft/event-playback` may be negotiated; with it, more line kinds SHOULD be in the batch (D3: not negotiated). |
| CH:245 | SHOULD | Match content to users by secure identification (one authorised user). |
| BA:29, 46, 67-72 | MUST | Cap named `batch`; reference alphabet, opaque and case-sensitive; vendor type prefixes; type names opaque. |
| LR:64 | MUST | Label values are opaque and at most 64 bytes (LR-7). |
| EM:19 | MUST | Cap named `echo-message`. |
| MI:31, 37, 45 | MAY / MUST NOT / SHOULD | Servers may attach msgid to any event; ids never start with `:` or contain SPACE, CR, LF; servers with ids SHOULD offer echo-message. |
| ST:32-44 | MUST / MAY / MAY / SHOULD | Timestamp syntax and millisecond precision; tags optional per message; clients may accept them at any time; SHOULD offer echo-message. |
| MT:53-59, 76-83, 100 | MUST / SHOULD | Tag keys unique (duplicate handling), opaque, invalid names accepted; UTF-8 values, empty equals missing; escaping; full-format support. |
| MT:120-127, 140-150, 165, 185-186, 196-209 | various | Tag order, naming, size limits and rejection, TAGMSG. |
| MT:215-231, 257-262 | various | CLIENTTAGDENY; unprefixed client tags removed before relay. |

The model's labels, ids, batch references and times are abstract values. The tag framework
that carries them is assumed to work; Seance's parser has its own tests.
