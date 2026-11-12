# Push model: readings and open questions

## D1. Who read, as the server sees it (`Identity`)

The page's connection sends `WEBPUSH REGISTER` for the device's subscription (`client/js/webpush.ts`). A **Mark read** tapped on a card does not go over that connection. The worker opens a throwaway connection, sends `MARKREAD` and quits (`swMarkRead`, `client/service-worker.js` "marking read over a throwaway connection"), and that connection registers nothing.

So there are two ways for the server to know whose subscription to skip under R1:
- `Identity = "conn"`: the server skips the subscription that the reading connection registered. This misses every Mark read, and those reads still come back to the device that sent them.
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

## Open questions

- **Q1.** R7: do Apple's push endpoints honour `Topic`, `Urgency` and `TTL: 0`? This is not modelled. A `Topic` would replace a queued message push per conversation inside the push service.
- **Q2.** R4: carrying the read state on the next message push. Not in v0. It would be the WebKit-safe way to clear stale cards under R3.
- **Q3.** R9: declarative web push for strict endpoints. It removes revocation by construction but still shows a card. Not in v0.
- **Q4.** Without R3, can a WebKit card still go stale, with everything read and no relay on its way? `R1Dev__W_StaleCard` asks this; there is no expected result.
- **Q5.** A product choice for Richard. R3 means no "Marked as read" on the phone ever, with cards staying until the app opens or the next push. Without R3, reading on the Mac replaces the phone's card with a "Marked as read" stub for about 30 s (`W_OtherReadStub`).
