# Push model: readings and open questions

## D1. Who read, as the server sees it (`Identity`)

The page's connection sends `WEBPUSH REGISTER` for the device's subscription (`client/js/webpush.ts`). A **Mark read** tapped on a card (`handleMarkRead`) goes through the open page when there is one (`viaPage`). With no page, the worker opens a throwaway connection, sends `MARKREAD` and quits (`swMarkRead`, "marking read over a throwaway connection"), and that connection registers nothing. The model takes "a page" to mean the app is open.

So there are two ways for the server to know whose subscription to skip under R1:
- `Identity = "conn"`: the server skips the subscription that the reading connection registered. This misses every Mark read made with the app closed, and those reads still come back to the device that sent them.
- `Identity = "device"`: the client names its device, for example with an id given at `REGISTER` and on `MARKREAD`. This catches both paths.

The model's `Who(d, via)` makes this a choice. The `R1Conn` configs are expected to show that the connection-bound version still breaks `RuleNoSelfRelay` and `RuleNoOwnReadStub`.

## D2. Relays happen only when the marker rises

nefarious2 calls `webpush_notify_read` only when `metadata_readmarker_set` took the new marker (`rc == 0`: newer than the stored one, `ircd/m_markread.c` :389-396 and :517-521). A read at or below the stored marker relays nothing. The model's `ReadAt` relays only when `n > marker[c]`.

## D3. The time a merged card carries (`MergeTime`)

A conversation's pushes merge into one card. The card's `data.time`, which the relay's close and Mark read compare, is the time of **the push that arrived last**, not the newest message in the card (`showMessage`, `time` in `data`).

Pushes can arrive out of order (RFC 8030). When message 2 arrives before message 1, the card holds both but carries time 1. Then:
- a relay at marker 1 closes it although message 2 is unread;
- Mark read on it sets the marker only to 1.

The model's card has both `n` (the time it carries) and `top` (its newest message). `MergeTime = "last"` is today's behaviour, `"newest"` the fix. `Today__RuleCloseOnlyRead` and `W_ClosedUnread` are expected to show it. This is a Seance finding, so it can be fixed in this repository.

## D4. Attention, abstracted

nefarious2 pushes a message only when no connection of the account attends: held, away, or idle past the window (`webpush_account_unattended`). The model reduces that to "no device's app is open". Idle windows and away state are left out.

## D5. One network, one subscription per device

Seance keeps one subscription per network per device (`docs/resources/web-push-map.md`). The model has a single network, so each device has at most one subscription.

## D6. Silent pushes and stubs as the worker does them today

- **Strict (WebKit).** Every push shows something. A relay always shows the stub beside whatever it left; a read message push shows the quiet stub.
- **Lax (Chrome).** A stub is shown only when nothing else would be up and no window is open (`closeOrConvert`, `keepChromeCount`).
- The 31 s stub close and the refused early close are both the later `Close` of a stub.

What v0 leaves out:
- **Copies left on WebKit screens.** WebKit keeps every notification shown under a tag on screen until `tidy` closes the older ones, and it refuses any close within 30 s of a show, message cards included. The model keeps one card per tag and closes at once.
- **Separate tags for stubs.** A relay that leaves a newer card shows its stub under a `read/` tag of its own. The model files stubs by conversation, so a stub and a message card can sit side by side, but stubs never stack.
- **Chrome's own variations.** `closeOrConvert` can keep a converted stub up even with a page visible, as long as a deferred close can run, and Android with no window (`closesRunLater` false) shows no stub at all. The model's lax rule is "a stub only when nothing else is up and the app is closed". It also treats "open" as "visible".

## D7. Stubs carry no time

`showStub`'s data has no `time`, and both relay closes match a notification without one whatever the marker. So any relay for a conversation closes its stubs. The model's stubs have `n = 0`. The one exception is Chrome's converted card, which keeps the card's `time` through `...keep.data`. The model treats it like every other stub.

## D8. What Mark read does on the device

`markedReadHere` runs first, so the tap answers at once.
- **WebKit:** only the tapped card goes.
- **Chrome:** every card of the conversation goes, with no time cutoff. When that would leave nothing up, the newest is turned into "Marked as read" for a moment.

That Chrome stub is the intended answer to the tap. It is not a relay coming back, so it is marked `by = Local` and `RuleNoOwnReadStub` does not count it. Both the local effect and the server's handling happen in one `ReadAt` step. In reality the card changes before the MARKREAD is sent, even if the send then fails.

## Open questions

- **Q1.** R7: do Apple's push endpoints honour `Topic`, `Urgency` and `TTL: 0`? This is not modelled. A `Topic` would replace a queued message push per conversation inside the push service.
- **Q2.** R4: carrying the read state on the next message push. Not in v0. It would be the WebKit-safe way to clear stale cards under R3.
- **Q3.** R9: declarative web push for strict endpoints. It removes revocation by construction but still shows a card. Not in v0.
- **Q4.** Without R3, can a WebKit card still go stale, with everything read and no relay on its way? **Yes**, at 39a7be2e5. nefarious2's outstanding flag is per account and conversation, so the first relay consumes it while a newer message is still on the phone. The steps: messages 1 and 2 are pushed; d1 marks 1 read and relay 1 clears the flag; d1 then marks 2 read, the marker rises, the gate is closed and no relay goes. d2 keeps card 2. R2's per-subscription flag would not consume it the same way.
- **Q5.** A product choice for Richard. R3 means no "Marked as read" on the phone ever, with cards staying until the app opens or the next push. Without R3, reading on the Mac replaces the phone's card with a "Marked as read" stub for about 30 s (`W_OtherReadStub`).
