# Do not disturb and per-network presence

Status: built 2026-10-12; review rounds 2-4 and the polish round
2026-10-13. Branch `dnd` (from `origin/develop` `d9ec454d`).
This describes what was built; where the build changed the first plan, the
list at the end says so.

## What the user asked for

- A **do not disturb** state, switched on from a control next to the logo or
  by a **schedule**. While it is on the user stays away and neither browser
  notifications nor push notifications fire.
- A **presence mode per network**, chosen from the network list: **Online**
  (never away), **Auto** (away when not looking, today's behaviour), **Away**
  (always away), and **Do not disturb**.

Decisions taken in the design session (mock-ups:
<https://claude.ai/artifact/DAtxCRJ1BAPGMNyHXzktAF>):

| Question                        | Choice                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The global control              | **C**: a status pill under the logo, opening a menu                                                   |
| The per-network control         | **1**: a presence dot before the nick in the network's lobby row, opening the four modes              |
| What others see in Away and DND | Plain `AWAY *` for both (the server shows its `AWAY_STAR_MSG`, "Away"); nobody can tell DND from away |
| The schedule                    | One daily window (start, end, may cross midnight) and a set of weekdays                               |
| DND across the user's devices   | Shared: DND lives in the account's `draft/webpush/mute`, and every connected Seance reads it back     |

## Background: how away works today

`client/js/irc/presence.ts` sends `AWAY *` (`draft/pre-away`) when the page is
unattended — hidden at once, visible but unfocused after `UNFOCUSED_AWAY_MS`
(60 s) — and `AWAY` when attention returns, unless the user's own `/away` is in
force. `foreground.ts` feeds it through `manager.setAttendedAll`.

nefarious2 keeps each connection's state (present, away with a message,
`AWAY *`) and aggregates across the account's connections
(`bounce_compute_effective_away`): any present connection makes the user
present; `AWAY *` connections do not count; all `AWAY *` gives the
`AWAY_STAR_MSG` text. A change in the aggregate is broadcast to `away-notify`
clients in common channels. Consequence for this feature: **Away and DND
cannot override another device that is present on the same account.** They
mean "this client stops showing the user as present".

Push is gated by the account metadata key `draft/webpush/mute`
(`ircd/webpush_mute.c`): `;`-separated `target:until` entries (unix seconds),
`*` muting every target. The ircd notifies the account's own subscribed
connections when a key changes (`metadata_notify_subscribers`), which is what
makes a shared DND possible without a server change.

## 1. Model — `client/js/helpers/dnd.ts`

Vue-free, DOM-free, store-free; mocha loads it (`test/helpers/dnd.ts`).

```ts
type PresenceMode = "online" | "auto" | "away" | "dnd";

interface DndSchedule {
	enabled: boolean;
	start: string; // "HH:MM", local time
	end: string; // "HH:MM"; end <= start means the window crosses midnight
	days: number[]; // 0 = Sunday … 6; the day the window *starts* on
}

interface DndState {
	// span: the length picked ("For 1 hour"), so the menu can tick it.
	manual: {kind: "off"} | {kind: "until"; until: number; span?: number} | {kind: "indefinite"};
	schedule: DndSchedule;
	// Off pressed inside a scheduled window: the window's end (ms). The
	// schedule is ignored until then.
	scheduleSkippedUntil: number | null;
}

dndAt(state, now: Date): {active: boolean; until: number | null; source: "manual" | "schedule" | null};
nextWindow(schedule, now: Date): {start: number; end: number} | null;
```

- Manual wins over the schedule while it is on; `until` in the past is off.
- **Off during a scheduled window** sets `scheduleSkippedUntil` to that
  window's end, so DND resumes with the next window, not the current one.
- An empty `days` list or `enabled: false` means no schedule.
- **The same start and end time is a whole day**: the window runs from that
  time to the same time the next day (a window that ends at or before its
  start crosses midnight). The editor says so under the fields.
- **Editing the schedule keeps the skip** only while the window current at
  that moment stays as it was (`editSchedule`): another weekday, or a time
  outside tonight's window, leaves Off in force; moving tonight's window
  drops the skip and it holds afresh. Following the schedule on or off
  always drops it.
- The page re-judges the verdict when it can next change (`nextChangeAt`: a
  timed DND's end, the next window's start, the next minute boundary), so
  an end or a start takes effect on time, not up to a minute late. Two tabs
  of one device keep one state through the `storage` event.
- `parseDndState` resets only the half it cannot read: a bad schedule keeps
  a good manual switch, and the reverse.
- A window is judged in local time; a DST change is taken as it falls (the
  window is the wall-clock times, whatever their length that night).
- Stored in `thelounge.dnd` (JSON), carried by the settings backup (§6).

The global DND state is the one above. **Per network**, `SavedNetwork` gets
`presenceMode?: PresenceMode` (absent = `auto`), stored in
`thelounge.networks`; an unsaved network holds it on its `IrcClient` for the
session only. A `*` entry read back from the network's mute list (§4) is a
third input, `remoteDnd` on the client.

The mode is shared between the account's devices — the most recent choice
wins, including one made while a device was offline — through the private
account metadata key `seance/presence`, and the pill gained a global mode
(Online / Auto / Away above the DND choices, shared as `seance/mode`; a
network's own mode overrides it, Same as global being every network's
default): see [shared-presence-modes.md](shared-presence-modes.md).

The **effective state** of a network:

```
dnd       = globalDnd.active || mode === "dnd" || remoteDnd
wantsStar = dnd || mode === "away" || (mode === "auto" && !attended)
```

`online` therefore never sends `AWAY *` — unless DND is on: DND always means
away.

## 2. Presence — `client/js/irc/presence.ts`

`setAttended` stops sending directly. A single `syncPresence(client)` compares
`wantsStar` with `starSent` and sends `AWAY *` or `AWAY` (quiet replies as
today); it is called when attention changes, when a mode or the DND state
changes (`manager.syncPresenceAll()`), and at registration
(`presenceRegistered`). Unchanged rules:

- `/away` (`userAway`) wins over everything; nothing automatic is sent while
  it is in force.
- `/back` sends exactly one line, chosen by the same rule (`sendBack`):
  `AWAY *` while DND, Away or an unattended Auto calls for it, else `AWAY`.
  Its reply is the user's acknowledgement, so it is not counted as a quiet
  one. `userAwayChanged` only records and reports the state; it sends
  nothing, so a `/back` in DND never sends an `AWAY *` + `AWAY` pair.
- Nothing is sent before registration (end of MOTD, `canSend` is
  `isConnected`), except the one declaration below, which rides in the
  `CAP END` flush.
- A MARKREAD for the open channel is still scheduled only while the page is
  attended — attention, not presence mode, decides "the user has seen it".

### Away across reloads and reconnects

nefarious2's bouncer attaches a reload or a reconnect to the held session,
and a connection that registers without saying it is away counts as
present: one present connection makes the account present, and the server
announces the user back to everyone (measured on the testnet with
`tools/scenarios/away-live.mjs`: a `/away` was lost on reload, and DND and
Away mode flashed back until the post-MOTD `AWAY *`). So:

- The client requests `draft/pre-away` and declares its away state
  **before `CAP END`, in the same flush, immediately before it**
  (`presence.ts` `registrationAwayLine`, wired as the negotiator's
  `finalLines` hook so the pipelined path, a late ACK/NAK and the SASL path —
  `PERSISTENCE ATTACH`, then the `AWAY`, then `CAP END` — all carry it):
  `AWAY :<text>` while a `/away` is in force, else `AWAY *` when `wantsStar`
  (DND, Away mode, an unattended Auto page, or — on a device out of sync
  for longer than a reload, whose connection subscribed to the shared keys
  before `CAP END` — the account's shared state not yet read,
  `shareUnread`, so a device that missed another's global Away or DND
  never shows the account back at login; the registration burst ends it,
  docs/projects/shared-presence-modes.md § 5).
  On the pipelined path the cap
  is only requested, not yet ACKed; the server reads the REQ first. No
  305/306 answers a pre-registration AWAY, so nothing is counted quiet.
- **`presenceRegistered` says it once more after registration**, quietly
  (its 306 unshown): nefarious2 applies the declaration and then resets the
  connection's own away record to present, which the session's aggregation
  and the push attention rule read (§ Server notes). The declaration keeps
  the attach itself from counting as present; the repeat makes it last.
  `remoteDnd` is not known yet at that point; with `before-connect` the
  burst right after 001 brings it, else its GET follows.
- The `/away` text is remembered per network across reloads in
  `thelounge.state.away` (`irc/userAwayStore.ts`; `/back` forgets it, so
  does removing the network; never in the settings backup). It is this
  device's memory: a `/back` on another device does not clear it, and the
  next reload here declares the old text again.
- Without `draft/pre-away` (not offered, or NAKed), nothing is declared
  before 001 and `presenceRegistered` re-sends `AWAY :<text>` for a `/away`
  in force (its 306 kept quiet); the automatic star follows through
  `syncPresence` as before.
- A same-page reconnect goes through the same paths; `userAway` survives the
  close because it is declared again.
- A multi-cap REQ that is NAKed is asked for again one cap at a time; if the
  retry is ACKed before 001 the cap is on, but a pipelined `AWAY` went in
  under the refused REQ and was dropped. The repeat after registration
  covers that too.
  Nothing is declared while the client is quitting (a required login that
  failed inside `beforeEnd`), so `starSent` is set only for a line that goes
  out.
- **A present client on a held session says `AWAY`**, once, its 305 kept
  quiet (nefarious2 always answers a bare `AWAY` with 305): a held session
  keeps the away state it was left with — the worker's star below — and a
  reopened page that declared nothing would inherit it (`presence.ts`
  `armResumeCheck`, at registration). Every connection that holds a bouncer
  session as its primary (`heldByBouncer`, never an alias, never without an
  account) does it, since no batch tells a resume: nefarious2 sends no
  restoration batch for a held session with no channels and no replay batch
  when nothing was missed; a fresh session just gets a quiet 305. It waits
  for the account's mute list, read 10 s after registration, so another
  device's DND (`remoteDnd`) is known and turns it into `AWAY *` instead of
  a back-then-away blink — at once where the list cannot be read (no
  `draft/metadata-2`), and after `MUTE_READ_FALLBACK_MS` (20 s) without a
  read (a `FAIL METADATA` for the GET, say) as if no other device were in
  DND. `/away`, DND, Away mode and a hidden page each suppress it. Accepted
  cost: a reopen after the worker's star stays away to others for up to
  ~10 s (measured 10.5 s).
- The `/away` memory is pruned once per page, at autoconnect, to the saved
  networks and the live clients (`pruneUserAway`): a network that was never
  saved is never reconnected after a reload.
- Other users' `AWAY *` is kept as the star in the model (a query's
  `userAway`, a channel user's `away`), apart from `""` (present), so a peer
  going "lunch" → `*` → back still gets its "is back" line in a query; and
  a query shows "is back" only when its last away line was an "is away"
  (`Channel.awayShown`), so a pre-away peer's tab switch (`*` then back)
  shows nothing either way. A 301 carrying `*` — nefarious2 sends the raw
  star to a viewer that speaks pre-away (`away_text_for`) — shows as away
  with no message: "Away: (no message)" on the whois card, "is away" in a query.

### The away state of a closed page

A page that unloads cannot tell a reload from a close. A present Auto page
that said `AWAY *` as it went would blink away and back to everyone on a
reload; one that says nothing leaves the held session as it was. So on
`pagehide` with `persisted === false` (`foreground.ts`), the networks that
qualify (`presence.ts` `leavesAwayToWorker`: mode `auto`, connected,
`!starSent`, no `/away`, no DND, the session held by the bouncer —
`PERSISTENCE STATUS` ON as the effective state, or as the user's setting on
a connection that saw `NOTE BOUNCER ALIAS_ATTACHED` (an alias of another
device's session reads `STATUS ON OFF`: the alias is not held, the session
is, and closing the last connection leaves it held; a primary reads `ON OFF`
only when told not to hold, `BOUNCER SET SESSION … HOLD off`), or the cap on
a SASL login before any STATUS line; `OFF OFF` is believed — and a login
in the worker's stash, `webpush.ts` `hasStashedLogin`, seeded from IndexedDB
at boot and replaced on every write)
are posted to the controlling worker as `{type: "away-on-close", networks}`,
and the unload's `visibilitychange` leaves exactly those alone
(`setAttendedAll(false, except)`). No controller, nothing handed over. The
back/forward cache (`persisted === true`) is a hide, as before.

The worker (`service-worker.js` `awayOnClose`) holds the event with
`waitUntil`, waits `AWAY_ON_CLOSE_DELAY_MS` (5 s), and stops if any window
of the app is open (`clients.matchAll({type: "window", includeUncontrolled: true})` filtered to URLs under the app's own, since a github.io origin holds
other projects' windows too — the reply path's page relay filters the same
way; a reload's new document is one at once). One run is pending at a time:
a close, a reopen and a close inside the delay restart its timer and log in
once; a close that arrives while the run is logging in is queued for one
more run after it, never a second login alongside. Otherwise, one network
after another, found by uuid in the stash (never `stashNetwork`'s
first-network fallback) and only with a stored password, it logs in over its
throwaway connection (`swIrcOpen`, `draft/pre-away` requested when offered),
sends `AWAY *` before `CAP END` when the cap was ACKed (the alias path keeps
it) and again after 001 (resuming a held session as its primary drops the
pre-registration one), waits for the 306 (2 s at most) and QUITs, which the
bouncer holds. A network that does not qualify keeps the star at unload, or
its QUIT.

Accepted limits: others see the user present for about 5 s longer after a
close; a reopen within 5 s sends nothing; a reopen while the worker's
connection is up can show one away→back. A network whose push is off, or
whose password is not remembered, has no stashed login and keeps the old
behaviour.

What was measured (2026-10-13, testnet, `away-live.mjs` against the round-1
build and this one): in Chromium a real reload never blinked — `pagehide`
comes first and `manager.ts` sends `QUIT :page closed` there, so the star
the unload's `visibilitychange` sent behind it went nowhere. The blink the
scenario's `reload()` shows is the back/forward cache's: navigating to
`about:blank` keeps the page (`persisted === true`), which is a hide. What the
old build got wrong was the close: the star never got out, and the held
session showed `WHO … G` with no 301 and no `AWAY` to `away-notify` clients.
With the worker, one `AWAY :Away` reaches them about 5.3 s after the close.

### On a server without `draft/pre-away`

Audited 2026-10-17 against InspIRCd 3.15 behind a WebSocket→TCP gateway and
nefarious2 with the drafts stripped from `CAP LS`. Without the cap,
`AWAY *` is not "away for no reason" but an away message of `*`: other
clients showed "is away: \*", and an Auto page told the channel away and back
on every tab switch. So when the server does not know `draft/pre-away`
(neither negotiated nor requested in this registration — `presence.ts`
`speaksPreAway`):

- Auto's attention counts for nothing: hiding or unfocusing the page sends
  no `AWAY`, and coming back none either. Such a server has no notion of
  one connection being unattended, so there is nothing true to say.
- Away (the network's or the global mode), do not disturb and `/back` under
  one of them send a real away message, `AWAY :Away` (`AWAY_PLAIN`), for
  both — as before, others cannot tell Away from DND.
- `/away <text>`, its survival across a reload (said again after
  registration) and everything else are unchanged.

nefarious2 itself treats `AWAY *` as its star even without the cap, so this
only changes what other servers see. A `FAIL METADATA` for one of the keys
this client keeps by itself (`draft/webpush/mute`, `seance/presence`,
`seance/mode`) is not shown either (`standard-replies.ts`): a server with
`draft/metadata-2` that does not take those names refused every `SUB` and
`GET` on each connect, six error lines in the lobby, and nothing is written
after a read that failed.

### Server notes (candidate upstream issues, not changed here)

- `s_user.c` applies a pre-registration `AWAY` at registration and then
  clears `con_pre_away` (the connection's own record, "Clear pre-away
  state"), on every registration. The session's away aggregation
  (`bounce_compute_effective_away`) and the push attention rule
  (`wp_conn_state`) read that record, so a connection whose away was only
  declared counts as present to both: measured, a device on Away resuming a
  session another device on Online had left present showed the account
  present (WHO `H`) and was not pushed while its registration was recent
  (`tools/scenarios/presence-modes-two-devices.mjs`, step 7). The page
  (`presenceRegistered`) and the worker both say the state again after
  registration, quietly.
- An alias connection reads `PERSISTENCE STATUS ON OFF` (measured: a second
  SASL login while another is connected gets `STATUS ON OFF` and
  `NOTE BOUNCER ALIAS_ATTACHED`, and again after `PERSISTENCE SET ON`),
  although
  closing the session's last connection, an alias included, leaves the
  session held. The client reads the setting, not only the effective state.
- A held session whose last connections went without a usable away (their
  stars went out after their QUIT) shows `G` in WHO but no 301 and sends no
  `AWAY` to `away-notify` clients.

## 3. Browser notifications — `client/js/socket-events/msg.ts`

`notifyMessage` returns before showing anything (and before the sound) when
the message's network is in DND. Unread counts, highlights, the mentions list
and the page title's count are untouched. The push worker's page
notifications (`webpush.pushWorkerFor`) go through the same function and are
covered by the same early return.

## 4. Push and sharing — `draft/webpush/mute`

A new Vue-free `client/js/irc/pushMute.ts` (`test/irc/pushMute.ts`):

- `parseMute(value)` / `formatMute(entries)` follow the server's grammar:
  entries split at the first `:`, an `until` of 0 or below is indefinite and
  live. `withGlobal(value, until)` and `withoutGlobal(value)` change only the
  `*` entry, keeping every other entry (per-channel mutes from other devices)
  and dropping expired ones; `globalUntil` is the live `*` entry's end
  (`Infinity` for an indefinite one).
- `IrcClient` keeps the last value seen (`muteValue`) and writes the merged
  value **private**: `METADATA * SET draft/webpush/mute private :<value>`.
  nefarious2 stores `* SET key *` as public, visible to anyone sharing a
  channel; a private value reaches only the account's own sessions, and the
  push gate reads it whatever its visibility. The clear (an empty value) is
  bare, `METADATA * SET draft/webpush/mute`, which deletes the key.
- **Reading**: `METADATA * SUB draft/webpush/mute` and
  `METADATA * GET draft/webpush/mute` go out **10 s after registration**
  (`MUTE_READ_DELAY_MS`), when the connect burst's fake lag is spent, and
  only with the `draft/metadata-2` cap and an account (push needs both). On a
  network with many channels they can still fall inside `catchup.ts`'s 4 s
  pacing: two commands of fake lag. Until the `GET` is answered, another
  device's DND is not known here: for those first ~10 s a network shows no
  shared DND, and nothing is written (a change made meanwhile waits for the
  answer). A `GET` refused (`FAIL METADATA … RATE_LIMITED`) or lost is
  asked once more when the resume check's fallback fires
  (`MUTE_READ_FALLBACK_MS`, 20 s). The `GET` reply (761, or 766 for no key)
  and every later `METADATA` line update `muteValue` and `remoteDnd` (a live
  `*` entry). `handlers/metadata.ts` takes a value when its visibility is
  `private` or its target is our own nick. The replies (761, 766, 770) for
  the keys this client writes — the mute list and the payload tier — stay
  silent; a reply for any other key (a raw `/metadata`) is shown as before
  (`unhandled`). 762 names no key and stays silent.
  Each write comes back twice (the 761/766 and the subscribed `METADATA`
  line) and is recognised as our own echo (`mutePending`, dropped after
  30 s unechoed).

**Writing.** While a network's `dnd` holds, its `*` entry says the DND's end:
the end of a timed or scheduled DND, or now + 30 days for an indefinite one,
renewed when under 7 days remain (checked on the minute tick). Nothing is
written before the value has been read.

- **Ownership**: the entry is ours (`muteOwned`) while the live `*` entry's
  `until` equals the `until` this client last wrote (`muteOwnedUntil`). Only
  an owned entry is rewritten or removed when local DND ends.
- **This device's memory** (`client/js/irc/muteMemory.ts`): per network
  uuid, `thelounge.state.dndMute` keeps `{ownedUntil, confirmedUntil}` — the
  `*` end this device last wrote and the last of its writes the server
  echoed (a clear confirms `null`). It survives a reconnect and a reload, is
  never carried by the settings backup (`thelounge.state.*`), and is
  forgotten when the network is removed. The first `GET` of a connection
  judges what it reads against it:
  - the live `*` is the end we last wrote, or the last one confirmed (our
    newest write died with the socket or the page): ours, and the next sync
    writes what is wanted now;
  - no live `*` and our last write unconfirmed: it never landed (a clear
    included), and the sync writes the want;
  - no live `*`, though the server confirmed our entry and its end is still
    ahead, while DND is still wanted here: another device turned DND off
    while we were away — **cleared elsewhere**, below;
  - anything else: another device's entry, adopted (or none at all).
- **An explicit change claims the entry**: the user changing DND here by
  hand — For 1 hour, For 8 hours, Until I turn it off, Follow schedule,
  editing the schedule, Off (`client/js/dnd.ts` → `manager.claimMuteAll()` →
  `pushMute.ts` `claimMute`) — makes the next sync take the live `*` entry
  as ours and write the new want over it, whoever wrote it, and lifts a
  suppression another device's Off left. A claim made before the `GET` has
  answered waits for it. A change that wants no entry claims nothing, so
  following or editing a schedule never removes another device's DND (the
  pill's Off does, `clearRemoteDnd`). An indefinite `*:0` is never claimed.
  Automatic syncs (the minute tick, a reconnect) still adopt.
- **A live `*` entry another device wrote is adopted, never rewritten**:
  push is muted already, and rewriting it would have two devices that
  disagree on the end rewrite each other forever. When it expires our own
  entry goes in at the next sync (up to a minute later).
- **Cleared elsewhere**: when the live `*` entry disappears while this client
  still wants DND (live, or at the first `GET` as above), another device
  turned it off. It is not written back (`muteSuppressed` until DND starts
  afresh or the user claims it) and the client dispatches `dnd:cleared`; the
  page (`client/js/dnd.ts`) then turns its own DND off (`reconcileRemote` →
  `turnOff`, so a scheduled window is skipped to its end) — Off on another
  device is Off for the account. The network modes are left alone since
  they are shared (shared-presence-modes.md § 5; resetting a mode `dnd` to
  `auto` here used to stamp a choice newer than the real one). The page's DND is one switch for
  the whole device, so a `dnd:cleared` from any one network ends it
  everywhere here: the Off that follows removes this device's own entries
  on every other network too, those of other accounts included. That is on
  purpose (the user's call, 2026-10-13): an Off seen anywhere means the
  user is back.
- **Leaving for good**: `/quit`, and so removing the network, writes our own
  entry away first, on the same socket (`releaseMute`), or every other device
  would read the account as in DND for up to 30 days and a re-added network
  (its memory forgotten) would adopt it as another device's. Removing a
  network that is **not connected** cannot send that `SET`: its entry stays
  on the server until it expires by itself (up to 30 days for an indefinite
  DND or mode `dnd`), and every other device reads the account as in DND
  until then or until someone presses Off.

**The pill reads shared DND**: when every connected network has `remoteDnd`
and the local state is off, the pill says "Do not disturb" (set on another
device) and its Off removes the entries (`clearRemoteDnd`), except on a
network in mode `dnd`, which would only write its own again.

**Limitations (documented, not solved):**

- The schedule is per device, and the server's mute is "from now until X",
  so a scheduled window silences push only when some Seance is open at the
  window's start. A device cannot book a future window in advance.
- A change made from another session of the account **under a different
  nick** is not applied live: nefarious2 labels every `METADATA`
  notification `*`, private ones included, so it cannot be told from another
  user's public value. It is picked up at the next registration's `GET`.
  Push muting itself is server-side and immediate either way.

`webpush.setSnooze` and the Settings snooze buttons are removed; the pill menu
replaces them.

## 5. UI

- **Status pill** (`client/components/PresencePill.vue`, under the logo in
  `Sidebar.vue`): its own DND first — "Do not disturb · until 07:00", "Do not
  disturb" (indefinite or set elsewhere) — else what the networks' modes say
  when they all agree, "Online · auto", "Online", "Away" or "Do not disturb",
  and "Mixed" when they differ (`presenceSummary`). Its dot follows: red for
  DND, amber for Away, neutral for Mixed, green otherwise. Times follow the
  12/24-hour clock setting, the schedule's window in the menu included. The
  click opens a menu: Off · For 1 hour · For 8 hours · Until I turn it off ·
  Follow schedule (with the window's text, which never breaks inside the
  range) · Edit schedule… (opens Settings → Notifications). The current
  choice carries the menus' check mark (`checked` on the item:
  `menuitemradio`/`menuitemcheckbox` with `aria-checked`, the mark drawn by
  CSS), a running timed one also its end ("For 1 hour (until 13:00)"), and
  the trigger has `aria-expanded` (a menu opened over another tells the
  first trigger it closed). Off is ticked only while the pill does not read
  DND, so with every network in mode `dnd` nothing in the global section is;
  Follow schedule with no days is unticked, and a click turns it on. The label wraps to two centred lines, breaking only after
  its separator ("Do not disturb ·" over "until 10:36 AM"), so the end time is
  never cut off; it is clamped only past two lines, and the whole label is
  also the button's title.
- **Presence dot** in `NetworkLobby.vue`, before the nick (`.lobby-presence`;
  alone when there is no nick): green present, amber away (`AWAY *` in
  effect or `/away`), red DND, grey while the network is not connected
  ("… · not connected"). A thin ring in the rail's own text colour keeps it
  at ≥ 3:1 against the rail at the 2nd percentile in every tested theme
  (`dnd-visual.mjs`); the day theme is the narrowest at 3.2. Its hit box is 1.5rem around the 0.5rem dot,
  without moving the row. A click opens Online / Auto / Away / Do not
  disturb for that network; the dot has its own `aria-label` and does not
  start a drag or select the row; a right-click on it opens the same menu,
  not the lobby's.
- **Network form** (`NetworkForm.vue`): the same four words as a select,
  with a hint under it for the mode picked (Online: never away; Auto: away
  when you're not looking; Away: always away; Do not disturb: away and
  silenced); it shows the mode the dot set, and saving keeps it.
- **Settings → Notifications**: the schedule editor (enabled, start, end,
  weekdays) in place of the snooze buttons; its fields are dimmed and
  disabled while the schedule is off.
- Plain English copy as the surrounding components on this base (no i18n
  layer on `origin/develop`), sizes in `rem`, logical properties, the menus
  following the existing context-menu styling and keyboard handling.

## 6. Settings backup

`thelounge.dnd` joins `BACKUP_KEYS`; restoring a file made before it existed
resets DND to its default, as for every carried key. `presenceMode` rides in
`thelounge.networks` already.

## 7. Testing

- `test/helpers/dnd.ts`: windows crossing midnight, weekdays (the start day
  decides), manual over schedule, Off inside a window skipping to its end,
  expired `until`, an empty schedule.
- `test/irc/presence.ts`: each mode × attended/unattended × DND, `/away` on
  top, a mode change mid-session, nothing before registration.
- `test/irc/preaway.ts`: the declaration right before `CAP END` (plain and
  SASL, after `PERSISTENCE ATTACH`), a reload from the stored text, `/back`
  and network removal forgetting it, DND / Away mode / a hidden page
  declaring `AWAY *` and saying it once more after registration (also for
  Away mode resuming a session another device left present), the fallback
  without the cap (or with it NAKed), a NAKed REQ whose retry is ACKed
  before 001, a failed required login declaring nothing, the
  `AWAY` on resuming a held session, the prune, other users' star, and
  `leavesAwayToWorker`.
- `test/tests/service-worker.ts` "away on close": a close (no window after
  the delay: `AWAY *` before `CAP END` and after 001, then `QUIT`), without
  pre-away (after 001 only), a reload (a window that appears inside the
  delay: nothing), a window of another project at `/other/` (still logs
  in), two closes inside the delay (one login for both posts' networks), a
  close during the login (queued for one more run), no stashed password
  (nothing), only the named networks by uuid, several in the order given.
- `test/irc/pushMute.ts`: parse/format, the `*` merge keeping other entries,
  expired entries dropped, `remoteDnd` from 761/766/`METADATA`, the private
  write and the bare clear, adoption, ownership across a reconnect and a
  reload (the memory), a lost write or clear rewritten, another device's Off
  while away, the claim, `dnd:cleared`.
- `test/irc/multi-network.ts`: `network:presence-mode` on a saved and an
  unsaved network, `network:edit` keeping the dot's mode, `dnd:cleared`
  leaving a shared mode `dnd` as it is.
- Live check `tools/scenarios/away-live.mjs` against the testnet rig (SASL,
  `draft/persistence`, `draft/pre-away`; through `lib/irc-proxy.mjs` so a
  same-page reconnect is a socket cut, with the redials refused for 3 s so
  they resume the held session): what other users see — `/away`, DND and
  Away mode across a reload and a reconnect, never back in between; a
  present Auto page reloaded (no AWAY line), closed for real (one away from
  the worker after ~5 s, WHO G and a 301) and reopened (present). The Push
  API is faked (`lib/fake-push.mjs`) with notifications granted so the
  network subscribes and the worker stashes its login. The reconnect checks
  pass on the round-1 build too.
- Live check `tools/scenarios/away-two-devices.mjs`: two real Seance pages on
  one account, B a second Chromium with its own profile
  (`lib/device.mjs`): A closed while B is present (present), A's `/away`
  under a present B (present), B hidden (A's text), B back (present); A
  still on `/away lunch` while B turns DND on ("lunch" to others) and Off
  (present; A keeps its `/away` through `dnd:cleared`; "lunch" again when B
  hides); DND on A read by B and Off on B turning A's off, A reloaded under
  B (no AWAY line), both closed (one away), A reopened alone (present within
  ~15 s).
- In `away-live.mjs` the about:blank round trips are back/forward-cache
  hides (`bfcacheHide`), labelled so; real reloads (`Page.reload`) are
  checked under `/away`, under DND and for a present Auto page.
- Browser check `tools/scenarios/dnd.mjs` against the dev ircd (also
  `--mobile --width=390 --height=844`): the pill and its menu, the dot and its
  menu (no navigation, no drag, its own right-click menu), the `AWAY *` /
  `AWAY` frames, `presenceMode` saved, a highlight from a helper connection
  raising a notification and the sound out of DND and neither in it, and the
  pill's whole label in the sidebar at the huge font step. The dev ircd has
  no services, so no account and no `METADATA` write: the wire is
  `test/irc/pushMute.ts`'s.
- `yarn test` and `yarn build` green; a CLAUDE.md entry pointing here.

## Out of scope

- Away messages of the user's own choosing for Away/DND (the user picked
  plain `AWAY *`).
- Several schedule windows.
- Overriding another present device of the same account (not possible
  through `draft/pre-away`).
- Any change to nefarious2 or its configuration.

## Changed during the build

- The mute list is written `private`, and the clear is a bare `SET` (the
  plan wrote it public, which any channel-mate could read).
- A live `*` entry another device wrote is adopted and never rewritten (the
  plan rewrote it to our own end, which looped between two devices).
- Ownership is "the live `*` entry's `until` equals the one we last wrote",
  kept across reconnects (a flag reset on reconnect left push muted after
  Off), and across reloads in `thelounge.state.dndMute` with the last
  confirmed end (after a reload a shorter DND chose nothing, and another
  device's Off was undone at the next connect).
- An explicit change on this page claims the live `*` entry; automatic
  syncs still adopt it.
- Another device's Off also set networks in mode `dnd` back to `auto` (they
  stayed away and silent with push unmuted); since the mode is shared
  (shared-presence-modes.md) that reset is gone.
- Another device clearing the entry raises `dnd:cleared`, which turns this
  device's DND off instead of being written back.
- A change from a session under a different nick is not applied live (the
  server labels every notification `*`); it waits for the next `GET`.
- `GET` goes out 10 s after registration, not in the connect burst; `SUB`
  rides the `CAP END` flush where the server offers `before-connect`
  (shared-presence-modes.md § 5), else goes with the `GET`.
- `webpush.setSnooze` and the snooze buttons are removed, not merged.
- `/back` sends one line chosen by the presence rule, never `AWAY *` then
  `AWAY`.
- The pill's label wraps to two lines rather than being cut off.
- Copy is plain English, not `t()`: the base has no i18n layer.
- A closing page's `AWAY *` goes through the service worker (round 2 of the
  away fix), and a present client says `AWAY` when it resumes a held
  session.
