# Push notifications across devices: prior art

Input for the TLA+ model of nefarious2 + Seance web push. Written 2026-11-12. Unless a claim is marked **[inferred]** or **[unverified]**, it comes from the file and lines linked. Source links are pinned to the commit I read.

## 0. Where nefarious2 + Seance stand today

- The read relay goes to **every** subscription on the account. That includes the reading device's own. `webpush_notify_read` → `webpush_emit_read` → `webpush_notify_account` ([m_webpush.c:917-944, 1186-1213](../nefarious2/ircd/m_webpush.c), at a59d1bf). It is gated on an outstanding message push per (account, conversation), not per subscription (`wp_outstanding`, :686-760). Read pushes for the same target are coalesced to one per 3 s (`WEBPUSH_READ_COALESCE`).
- Message pushes go out only when nobody is attending the account (`webpush_account_unattended`, :967-972).
- A subscription record holds the endpoint, the keys and the VAPID key id, and nothing that ties it to a connection or device (`include/webpush.h:43-50`). Delivery sends `TTL` (default 86400) but no `Topic` or `Urgency` header (`webpush.c:1005-1016`).
- Under WebKit, Seance's worker answers each relay with a silent "Marked as read" stub and closes the stub after about 31 s (`client/service-worker.js:569-700, 1695-1760`).

## 1. Per app

### Matrix (spec, Synapse, Sygnal, Element)

- **Count-only pushes.** The push gateway API says counts "may be sent along with a notification about an event or by themselves", and that `event_id` "may be omitted for notifications that only contain updated badge counts". `event_id_only` requires only `event_id`, `room_id`, `counts` and `devices` ([spec](https://spec.matrix.org/latest/push-gateway-api/)).
- **Synapse sends a count-only push on every new read receipt**, and only when the count has changed. It goes to each of the user's pushers, the reader's included ([httppusher.py:180-199, 532-551](https://github.com/element-hq/synapse/blob/7f832ceeedc921a6f2727e1b039acc00f97398b7/synapse/push/httppusher.py#L180-L199)). The code itself calls this "largely redundant. perhaps we can remove it" (:190).
- **Sygnal, APNs.** A count-only push becomes a bare `aps.badge` with no alert ([apnspushkin.py:530-556](https://github.com/matrix-org/sygnal/blob/4700184bac220125a51fed7ece428e233fb0c824/sygnal/apnspushkin.py#L530-L556)). Native iOS accepts that without showing anything. `event_id_only` sends just ids and counts, and the app's NSE fetches the event (:320-325, 388-413).
- **Sygnal, web push.** `events_only: true` drops every push that has no event id (`webpushpushkin.py:147-150`). The docs give the reason: with `userVisibleOnly` the browser shows "site has been updated in the background", which "can easily happen when sygnal sends a push message to clear the unread count" ([docs/applications.md:317-329](https://github.com/matrix-org/sygnal/blob/4700184bac220125a51fed7ece428e233fb0c824/docs/applications.md#L317-L329)). In other words, **Matrix web clients turn read-driven pushes off.**
- **Sygnal, collapsing.** `only_last_per_room` sets an RFC 8030 `Topic` to a hash of the room (`webpushpushkin.py:186-194`). The docs note it "only has an effect when notifications are queued up". FCM has `TODO: Implement collapse_key` (`gcmpushkin.py:544`).
- **Element Web** has no web push. Its service worker handles only install, activate, message and fetch ([serviceworker/index.ts:23-65](https://github.com/element-hq/element-web/blob/c3a4b8460cf2aa58bd7c3c4307d345d99b2a5b38/apps/web/src/serviceworker/index.ts)).
- **Element X iOS** clears notifications **on the device, after a sync**. Each room-list update calls `removeDeliveredNotificationsForFullyReadRooms`, which removes notifications older than the room's last message once the room has no unreads ([NotificationService.swift:63-101](https://github.com/element-hq/element-x-ios/blob/868a9af7e925af09bb9963cff086f84164959dd3/ElementX/Sources/Services/Notification/Service/NotificationService.swift#L63-L101)). Its NSE holds `com.apple.developer.usernotifications.filtering` ([target.yml:65](https://github.com/element-hq/element-x-ios/blob/868a9af7e925af09bb9963cff086f84164959dd3/NSE/SupportingFiles/target.yml#L65)), so it can swallow a push: a redaction push removes its target and returns `.processedShouldDiscard` ([NotificationHandler.swift:136-148](https://github.com/element-hq/element-x-ios/blob/868a9af7e925af09bb9963cff086f84164959dd3/NSE/Sources/NotificationHandler.swift#L136-L148)).
- **MSC4234** proposes a `cleared_notifs` flag on read receipts. When it is set, the server sends a "null" push to the user's **other** clients so they sync and recompute their badges ([MSC4234](https://git.sudo.is/matrix/matrix-doc/src/branch/matthew/msc4234/proposals/4234-reliable-app-badge-counts.md)).

### Zulip

- Each push is recorded per message as `active_mobile_push_notification`. When messages that carry the flag are read, the server queues a `"remove"` event for the user ([message_flags.py:280-295](https://github.com/zulip/zulip/blob/83cddef6cf05f176563edb67ba6d361f3979bd9f/zerver/actions/message_flags.py#L280-L295)). `handle_remove_push_notification` sends it to all of the user's devices, keeps the newest 200 ids, then clears the flag ([push_notifications.py:1313-1389](https://github.com/zulip/zulip/blob/83cddef6cf05f176563edb67ba6d361f3979bd9f/zerver/lib/push_notifications.py#L1313-L1389)).
- **iOS.** A removal is an APNs **background** push at priority 5 with no alert, while message pushes are `alert` at priority 10 (:1523-1547). `get_apns_badge_count` is "temporarily" hard-wired to 0 (:1162-1167). In the client, iOS removal is still out of scope: zulip-flutter tracks Android only, and iOS waits on zulip-mobile#3119 ([zulip-flutter#341](https://github.com/zulip/zulip-flutter/issues/341)).
- **Avoiding pushes to someone already reading.** A push is sent only if the user is off Zulip or presence-idle ([event_queue.py:1300](https://github.com/zulip/zulip/blob/83cddef6cf05f176563edb67ba6d361f3979bd9f/zerver/tornado/event_queue.py#L1300)), unless "Send mobile notifications even if I'm online" is set.

### Mattermost (server and push proxy)

- **Clear-on-read excludes the reading session.** `clearPushNotificationSync(currentSessionId, …)` sends `PushTypeClear` with `ContentAvailable: 1` and the new badge ([notification_push.go:395-413](https://github.com/mattermost/mattermost/blob/9e3a32bc209217ea014bb34fe5711f949d332dab/server/channels/app/notification_push.go#L395-L413)). `sendPushNotificationToAllSessions` skips `session.Id == skipSessionId` (:176). There is also a separate badge-only `PushTypeUpdateBadge` (:430-441).
- **Push proxy, APNs.** A clear is a `content-available` push with no alert ([apple_notification_server.go:261-262](https://github.com/mattermost/mattermost-push-proxy/blob/20f2a046fef76a7ab1c121cd01bc2b06206979be/server/apple_notification_server.go#L261-L262)). Notifications are grouped with `thread-id` = channel or thread root (:280-287). A clear with badge 0 is sent as badge **1** (:218-219), with no comment in the code. **[inferred]** This is probably there to avoid iOS's behaviour of clearing all delivered notifications when the badge drops to 0.

### Rocket.Chat

- **Collapsing.** `notId = hash(serverId|roomId)` ([PushNotification.ts:46-49, 82](https://github.com/RocketChat/Rocket.Chat/blob/1c0e41c0f02c6f76b8905fdb7b9be480bed23c52/apps/meteor/server/lib/notifications/push-config/lib/PushNotification.ts#L46-L49)). It becomes the APNs `threadId` ([apn.ts:71-72](https://github.com/RocketChat/Rocket.Chat/blob/1c0e41c0f02c6f76b8905fdb7b9be480bed23c52/apps/meteor/server/lib/notifications/push/apn.ts#L71-L72)), so each room has one collapse key.
- **Delay instead of clear.** Pushes for an `online` user are held for 120 s, and for away or offline users they go out at once ([NotificationQueue.ts:12-14, 151-163](https://github.com/RocketChat/Rocket.Chat/blob/1c0e41c0f02c6f76b8905fdb7b9be480bed23c52/apps/meteor/server/lib/notifications/queue/NotificationQueue.ts#L12-L14)). The model has `clearQueueByUserId` ([models/NotificationQueue.ts:63](https://github.com/RocketChat/Rocket.Chat/blob/1c0e41c0f02c6f76b8905fdb7b9be480bed23c52/packages/models/src/models/NotificationQueue.ts#L63)).
- **[inferred]** The queue is dropped when the user reads. I found no clear-on-read push in the server's push path.
- The cloud gateway relays to APNs/FCM (`push.ts:78-110`).

### Mastodon (web push)

- One push per notification, with `TTL` 48 h and `Urgency: normal`. A notification older than the TTL is skipped ([push_notification_worker.rb:9-16, 42-80](https://github.com/mastodon/mastodon/blob/918848eb9ef62668782cc1eebd9b303ba11b8761/app/workers/web/push_notification_worker.rb#L9-L16)). No `Topic`.
- **The worker collapses notifications itself.** At 5 or more visible notifications it closes them all and shows one grouped notification, and later pushes are appended to that group ([web_push_notifications.js:8-40](https://github.com/mastodon/mastodon/blob/918848eb9ef62668782cc1eebd9b303ba11b8761/app/javascript/mastodon/service_worker/web_push_notifications.js#L8-L40)). Otherwise tag = notification id (:93).
- There is no read-driven push. Cards stay until the user opens or dismisses them.

### Signal and Delta Chat

- **Signal iOS.** A read on a linked device arrives as a sync message. The receiver marks that message and the earlier ones read, then batch-cancels their notifications ([OWSReceiptManager.swift:905-932](https://github.com/signalapp/Signal-iOS/blob/a690a26d2cfe1bc15f99d73d2ef2054d41ba5e45/SignalServiceKit/Messages/OWSReceiptManager.swift#L905-L932)). The reader never gets its own read back.
  - **[inferred]** That follows from sync messages being addressed to the account's other devices.
  - When its time runs out, the NSE "complete[s] silently" with empty content ([NotificationService.swift:180-192](https://github.com/signalapp/Signal-iOS/blob/a690a26d2cfe1bc15f99d73d2ef2054d41ba5e45/SignalNSE/NotificationService.swift#L180-L192)). **[unverified]** I did not establish where Signal holds the filtering entitlement; it is not in `SignalNSE.entitlements`.
- **Delta Chat.** The notifications proxy "forwards device tokens to Apple and Google" to "wake up the clients" ([chatmail/notifiers](https://github.com/chatmail/notifiers)). **[unverified]** It looks like a content-free wake-up with all state reconciled from IMAP. Its cross-device read handling is not documented there.

### soju and Goguma (IRC)

- **Pushes are delayed and re-checked.** soju waits **5 s**, then re-reads the read receipt and pushes only if the message is still unread. It then records `pushTargets[buffer]` ([upstream.go:756, 780-795](https://github.com/emersion/soju/blob/8bff925bd7b952babe085eedac6c5f9eb68e39c5/upstream.go#L780-L795)).
- **soju pushes MARKREAD.** It sends a `MARKREAD` push only when the marker advanced and the target is in `pushTargets`, and deletes the entry once the marker covers it ([downstream.go:3354-3379](https://github.com/emersion/soju/blob/8bff925bd7b952babe085eedac6c5f9eb68e39c5/downstream.go#L3354-L3379)). There is a `// TODO: only broadcast if draft/read-marker has been negotiated`.
- **To whom: every subscription** on the network, the reader's included ([user.go:536-575](https://github.com/emersion/soju/blob/8bff925bd7b952babe085eedac6c5f9eb68e39c5/user.go#L536-L575)).
- **Headers.** `Urgency: high` for PRIVMSG/NOTICE/INVITE and `normal` for everything else, MARKREAD included. `TTL` is 7 days. No `Topic` ([server.go:339-375](https://github.com/emersion/soju/blob/8bff925bd7b952babe085eedac6c5f9eb68e39c5/server.go#L339-L375)).
- **The spec** lets the server push "a server-defined subset of IRC messages", one message per push (`doc/ext/webpush.md:55`).
- **Goguma [unverified].** Codeberg blocked fetching. My understanding, unconfirmed, is that Goguma is Android-only for push and cancels a buffer's notifications on a MARKREAD push. That would work because Android has no visible-push rule.

### Apple / WebKit

- **"Violations of the `userVisibleOnly` promise will result in a push subscription being revoked"** ([Meet Web Push](https://webkit.org/?p=12945)).
- **The silent-push rule in webpushd.** Each push handed to a worker is queued in `m_potentialSilentPushes` with a deadline ([WebPushDaemon.mm:776-783](https://github.com/WebKit/WebKit/blob/75e47c828579ee2bb0d07f29e2a8d4572937d72f/Source/WebKit/webpushd/WebPushDaemon.mm#L776-L783)). `showNotification` in time removes it (:728-745). Otherwise `incrementSilentPushCount` runs (:705-722).
- **The threshold.** At `maxSilentPushCount = 3` ([WebPushDaemonConstants.h:34-35](https://github.com/WebKit/WebKit/blob/75e47c828579ee2bb0d07f29e2a8d4572937d72f/Source/WebKit/Shared/WebPushDaemonConstants.h#L34-L35)) it runs "Removing all subscriptions associated with … origin" ([PushService.mm:661-676](https://github.com/WebKit/WebKit/blob/75e47c828579ee2bb0d07f29e2a8d4572937d72f/Source/WebKit/webpushd/PushService.mm#L661-L676)).
  - **[unverified]** The deadline is about 30 s (`silentPushTimeoutForProduction`); I did not find where it is defined. That the count never resets comes from Seance's notes; I did not re-check it.
- **A badge does not count.** `setAppBadge` never calls `didShowNotification` (:1215-1260). The WebKit badging post says so outright: "a badge update by itself does not fulfill the 'user visible' requirement" ([Badging](https://webkit.org/?p=14112)).
- **`close()` is refused within the minimum lifetime.** `Notification::close()` refuses a persistent notification younger than `s_persistentNotificationMinimumLifetime = silentPushTimeoutForProduction`, logging "Persistent notifications cannot be closed shortly after they are shown." ([Notification.cpp:77, 292-305](https://github.com/WebKit/WebKit/blob/75e47c828579ee2bb0d07f29e2a8d4572937d72f/Source/WebCore/Modules/notifications/Notification.cpp#L292-L305)). After that, `cancelNotification` does remove delivered notifications (:1108-1123).
- **Tags filter but do not replace.** Each notification is filed under its own UUID (`requestWithIdentifier: notificationID`, :1050). `getNotifications` only filters by tag (:1095).
- **Declarative Web Push** (iOS/iPadOS 18.4, macOS 15.5; [Meet Declarative Web Push](https://webkit.org/?p=16535); [Push API draft](https://w3c.github.io/push-api/)).
  - The payload is `{"web_push":8030,"notification":{title,navigate,…},"app_badge"?, "mutable"?}`.
  - A non-mutable message is shown by webpushd itself, with no worker involved (:576-587).
  - A mutable one goes to the worker, which may show a replacement. If it does not, the proposed notification is shown, and there is "no penalty". Declarative messages never enter the silent queue (:777-780).
  - **It does not allow an invisible push**: the spec has no way to suppress the fallback. So it removes the revocation risk but not the visible card.

### Chrome / FCM

- When the event ends, Chrome **counts the visible notifications** on the registration. **No notification is needed if a tab of the origin is visible** ([push_messaging_notification_manager.cc:138-201](https://github.com/chromium/chromium/blob/ed125175bfb982da798debb7ddfc8ad568dcac0a/chrome/browser/push_messaging/push_messaging_notification_manager.cc#L138-L201)).
- If nothing is visible, Chrome spends budget. If the budget is exhausted, it shows the generic "updated in the background" notification (:236-282). It never revokes the subscription.
- **Budget.** The engagement-based budget allows "6 silent push messages a day for a fully engaged site" ([budget_database.cc:28-34](https://github.com/chromium/chromium/blob/ed125175bfb982da798debb7ddfc8ad568dcac0a/chrome/browser/push_messaging/budget_database.cc#L28-L34)).
- There is a TODO saying that hiding a notification "should also count" as a user-visible action, but it is not implemented (:146-149). A relay that closes the last notification therefore spends budget.

## 2. Practices that hold up

1. **Don't push the read back to the reader.**
   - Mattermost skips the reading session by id.
   - Signal's read sync goes only to the other devices.
   - MSC4234 targets "other clients".
   - Synapse, Zulip, soju and nefarious2 do not exclude the reader. Zulip and Synapse are native apps, where a background or badge push costs nothing visible.
2. **Send a clear only for what was actually pushed.** Zulip keeps a per-message flag, soju keeps `pushTargets`, and nefarious2 keeps `wp_outstanding`. All three track this per account. None track it per device.
3. **Delay or gate a push so it is never needed.**
   - soju waits 5 s and re-checks.
   - Rocket.Chat holds pushes 120 s while the user is online.
   - Zulip pushes only when the user is idle or off.
   - nefarious2 pushes only when the account is unattended.
4. **Native platforms clear with invisible pushes; the web cannot.** APNs `content-available` pushes (Mattermost, Zulip) and bare badge pushes (Sygnal) clear or update without showing anything. On the web, Sygnal's `events_only` exists to *drop* count-only pushes, and WebKit says a badge does not count as visible.
5. **On iOS, let cards go stale and reconcile when the app opens** (Element X; Zulip leaves iOS removal unimplemented). Apple's own forums describe background clears as best-effort: "treat the push as a hint… reconcile again when the app next runs" ([forum 852769](https://developer.apple.com/forums/thread/852769); [774856](https://developer.apple.com/forums/thread/774856)).
6. **Collapse by conversation.**
   - The APNs `thread-id` is the channel or room (Mattermost, Rocket.Chat).
   - Sygnal can set the web push `Topic` to the room.
   - Mastodon groups at 5 notifications.
   - Seance tags per network and conversation, but under WebKit a tag does not replace, so the worker has to close the older ones itself.
7. **Lower the priority of clears** (Zulip: background push, priority 5; FCM `normal`).

## 3. Candidate rules for the model

`S` = server change in nefarious2, `C` = Seance-only change.

- **R1 (S). No self-relay.** Bind each subscription to the connection or session that last registered it, or have Seance send a per-install device id with `WEBPUSH REGISTER`. `webpush_notify_read(account, target, ts, origin_conn)` then skips the subscriptions bound to `origin_conn`. Model invariant: `∀ relay r: r.sub ∉ subsOf(r.reader)`. This alone removes the annoying stub on the reading device. Seance closes that device's own notification locally (page → worker).
- **R2 (S). Outstanding per subscription.** Keep `outstanding[sub][conv]` and send a relay to `sub` only if a message push for `conv` went to `sub` after the last relay. Invariant: every relay delivered to `sub` has something to close there.
- **R3 (S). No relay to strict-visibility endpoints by default.** For a WebKit subscription (recognisable by its endpoint host **[inferred]**; Seance could instead declare it at REGISTER), skip relays and let cards go stale. Recovery comes from R4 and R5. If kept, R6 bounds the cost.
- **R4 (S+C). Piggyback reconciliation.** Carry the account's current read state for recently pushed conversations (`read: {conv: ts}`) on the next *message* push. The worker closes stale cards while it shows the new one. This costs no extra push and is always visible.
- **R5 (C). Reconcile on open.** When the app opens, `tidy` closes every card at or below the read markers. This already exists; in the model it is the liveness path for WebKit devices.
- **R6 (C). Strict relays are bounded.** Under WebKit, a relay that does arrive must `showNotification` before the deadline: a replace-in-place stub, as today. Model: `silentCount[origin] < 3` always, with the count never reset. Under Chrome, a relay that leaves zero notifications spends budget; leaving the stub up for a moment avoids that.
- **R7 (S). Push-service headers.**
  - `Topic` = hash(network, conversation) on message pushes, so a device that comes back online receives one push per conversation.
  - `Urgency: low` and a short `TTL` on relays, so stale clears die in the queue.
  - **[unverified]** whether Apple's endpoint honours `Topic` and `Urgency`.
  - Model this as a lossy, reordering channel with per-Topic replacement.
- **R8 (S). Delay-and-recheck message pushes** (soju's 5 s, or longer) on top of the attention gate. A message read during the window produces no push and no relay.
- **R9 (S+C). Declarative Web Push for strict endpoints.** Send relays and messages as `mutable` declarative payloads. A worker that misses the deadline then costs nothing, so revocation becomes impossible by construction. The card is still visible, so R1–R3 are still needed.
- **R10 (C). Order safety.** A relay closes only notifications whose message time is at or below the marker, because the channel can reorder message pushes and relays. Seance does this already; the model should check it under reordering.

## 4. Open questions

1. **Identity.** What identifies "the reader's subscription"? A browser origin has one endpoint shared by all accounts and networks (Sygnal's "Multiple pushers on one origin"). Bouncer aliases mean the MARKREAD may come from a different connection than the one that registered. A client-supplied device id is probably the most robust option **[inferred]**.
2. **Endpoint recognition.** Can the server reliably tell a WebKit endpoint apart, or should the client declare `strict` itself?
3. **Apple headers.** Does `web.push.apple.com` honour `Topic`, `Urgency` and `TTL: 0`? I found no Apple documentation.
4. **Silent-count reset.** Does webpushd's count ever reset, for example when the app is reinstalled or permission is re-granted? I read only `incrementSilentPushCount`.
5. **Declarative in Home Screen apps.** Are declarative pushes fully supported there, and does `silent: true` suppress sound on iOS?
6. **Product choice.** Is "stale until opened or until the next push" (R3–R5) acceptable on iPhone, or is the desktop-read → phone-cleared promise worth one silent stub per conversation (R6)?
7. **Goguma and Delta Chat.** Their behaviour needs confirmation from source, which I could not fetch here.
