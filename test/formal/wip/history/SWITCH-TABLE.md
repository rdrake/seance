# Seance against History.tla v1.1: switch table (draft, unverified)

A subagent read this from evilnet develop 4f5a4bd12 (catchup.ts, history.ts, client.ts) on
2026-11-11. Every claim cites file:line, but none has been checked by hand yet. It is input to
D27 and PROMPT-H5, not a decision.

Paths: C = client/js/irc/catchup.ts, H = client/js/irc/history.ts, CL = client/js/irc/client.ts.

## Closest config

The closest config is reconnect with:
- Limit capped by ISUPPORT `CHATHISTORY=`;
- pages(5);
- Dedupe, MsgidAnchor and StopOnHeld on;
- InsertMerge off.

No CFGS entry combines StopOnHeld=TRUE with InsertMerge=FALSE, so this is "HHeldStop with
deltas", not a named config. Three behaviours have no model value (✗).

| Model item | What Seance does | Model value |
|---|---|---|
| Mode reconnect | First `LATEST * min(100, cap)` in append mode (H:286-292, H:184). Then `BEFORE <oldest-by-time line of last page>` with the same limit (H:580-603). Chosen when `historyRequested && before` (H:285). `before` = newestRef taken before our JOIN is handled (CL:3101). | reconnect: first query `star`, then Before(anchor) |
| Mode join | `LATEST * min(50, cap)`, prepend, one page (H:295-299, H:63). Used when nothing was requested before or nothing is held. | join, "one" |
| Mode more | `BEFORE <ref of lastId> min(100, cap)`, prepend, one page (H:255-268). lastId = the first row shown that is not showInActive (MessageList.vue:289-300). With nothing shown it sends `LATEST *` (H:244-252). One request per channel at a time (H:240). | more ✓ |
| MsgidAnchor | `msgid=` if the ref has a msgid and MSGREFTYPES is absent or allows msgid, else `timestamp=` (H:157-169). Decided per request. | TRUE when every anchor row has a msgid |
| Budget | LATEST plus 4 BEFOREs (H:65, H:290, H:590). | pages(5) ✓ |
| Limit | 100 / 50 / 100, capped by `CHATHISTORY=` (H:143-146). | set via 005 |
| Floor stop | Stops if any line on the page has time < floor − 5000 ms, strict `<` (H:562, H:576). | `<` ✓. Fuzz=1 if one time unit is 5 s; Fuzz=0 if units are ≥ 10 s apart |
| StopOnHeld | Stops on any msgid the channel holds at batch close (H:561, H:571). That includes live lines relayed during catch-up and our own JOIN echo. | ✗ wider than `Range(ms) ∩ Held` |
| Empty stop | A page with no timed line gives no anchor, so the walk stops (H:590). A labelled ACK counts as empty (H:761). | "empty" ✓ |
| End stop | `draft/chathistory-end` stops the walk (H:590, H:687). | "end" ✓ |
| Dedupe | By msgid against the channel at each batch close (H:398, H:426). Pages are gathered and delivered at the end (H:587, H:643) with no msgid check at delivery (H:511-516). | TRUE, except a live line relayed mid-walk after a page that contains it is held twice (CoverLiveBoth's interleaving) |
| InsertMerge | Reconnect: appended (CL:3613-3700, messageUpdates.ts:204-216). Join/more: put in front of everything (H:458, more.ts:54). | reconnect: FALSE (W_Append). join/more: same as TRUE when the page is older than everything held |
| Live line during catch-up | Pushed at once (CL:3613-3700). An unbatched line is not buffered (handlers/batch.ts:82-94). | see the two rows above |
| FAIL | Ends the request (H:743-748). Reconnect: delivers the pages gathered so far and does not set historyFilled (H:639-644). No retry, except a `more` lost to a socket close (H:311-339). A 15 s timeout behaves the same (H:216). | MayFail, "fail" ✓ |
| Anchor on a reversed batch | The oldest line by time; on a tie the first seen wins (H:580). | ✗ the model uses `ms[1]`; same only when BatchAgrees |

## Possible bugs to verify

- **CONFIRMED 2026-11-11 (throwaway mocha probe on 4f5a4bd12 + the delivery fix).** The probe
  ran with CHATHISTORY=2 and held `seen` at 12:10. After a reconnect, carol's live g4 (12:31)
  arrives while LATEST is in flight. The LATEST page is full, [g2 12:16, g4 12:31], with no end
  tag.
  - Result: no BEFORE is sent, historyFilled = true, and the rows read ["four", "two"].
  - So a gap message between 12:10 and 12:16 is never fetched, and the channel claims it has
    filled the gap. The gap also lands after the live line, as W_Append predicts.
  - The probe was reverted; nothing is committed.
- **Held stop on page 1.** A live line, or our JOIN echo, that is also in the LATEST page stops
  the walk after one page (H:571, H:590). It also sets historyFilled (H:639), so a gap longer
  than one page would be truncated and still marked filled.
- **Own JOIN under event-playback.** If nefarious2 stores and replays our own JOIN, every
  reconnect walk would stop after LATEST. This is unverified.

## Pinning a replay outside the model

- **TARGETS:** use one channel (C:501-518).
- **Read markers:** leave `draft/read-marker` off.
- **Persistence:** leave it off (persistence.ts:351-361).
- **Fake lag:** use `NO_FAKE_LAG` (support.ts:120).
- **Active channel:** none (CL:592); don't open the channel before connecting.
- **FAIL matching:** keep labeled-response on (H:376-380).
- **Timeout:** answer within 15 s of fake time.
- **Live lines:** use LiveOn=FALSE, or send the live line after the last page. Leave
  event-playback off.

The stop reason cannot be observed. A replay can check only:
- the CHATHISTORY requests sent;
- the delivered rows;
- `chan.historyFilled`.

## Harness

- `support.ts` `register()` hard-codes `CHATHISTORY=100` (support.ts:180) and has no reconnect
  helper.
- `test/irc/history.ts` has `setup({isupport})` and `reconnect()` (:141, :968-997).
- Read requests from `h.transport.sent`.
- The buffer is `h.payloads("more")` pages, each later page in front, then `h.messages(chanId)`.
- `joined()` resets the dispatch spy (support.ts:235).
