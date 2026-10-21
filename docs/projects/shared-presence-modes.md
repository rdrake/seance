# Shared presence modes and the global mode

Status: shared modes and global away built 2026-10-15 on branch `dnd` (the
commits after 1b4fb464); § 5 and § 9 record what the two-device runs
changed. **Revised 2026-10-16** and built 2026-10-17: global away becomes a
global _mode_ (§ 2), and a network's own mode overrides it. Builds on [do-not-disturb.md](do-not-disturb.md), which
introduced the presence modes, the pill and the shared do not disturb this
reuses.

## 1. What and why

Each network has a presence mode — Online, Auto, Away, Do not disturb — set
from the lobby row's dot or the network form. Until now the mode was kept on
the device (`presenceMode` on the saved network entry), so a phone and a
desktop on one account could disagree, and a change on one never reached the
other. And there was no way to go away everywhere at once: the pill under the
logo only switched do not disturb.

The user's requests (2026-10-15):

- the devices share the mode, **including a change made while a device is
  offline**, and when two devices changed it while apart, **the most recent
  change wins**;
- a **global away**: one switch that puts every network away, on top of the
  per-network modes, shared between devices the same way (2026-10-15);
- revised 2026-10-16: the pill is a **global mode** with the network's own
  choices — Online (forced online, replacing Available), Auto, Away, and do
  not disturb — and "it should work the same as the individual network
  overrides". Of the two orders the user was shown, **the network wins**: the
  global mode is every network's default, and a network set on its own dot
  overrides it. The global mode starts on **Auto** where nothing was chosen
  for the account.

What follows from that:

- A network's mode is the same on every device of the account; so is the
  global mode. A change on one device shows on the others at once if
  they are connected, and at their next login if not.
- A change made on a device with no connection is kept there and applied at
  its next login, unless another device changed it later.
- Auto still means "this device follows its own attention": with Auto
  shared, each device goes away when nobody is looking at it.
- Two devices can no longer hold different modes at the same time (the
  desktop Online, the phone Away). That is the point of sharing.

Out of scope: the `/away` message (per device, `thelounge.state.away`), the
do not disturb schedule (per device; DND itself is already shared through
the push mute), and networks without an account or without
`draft/metadata-2`, which keep the mode on the device as before and apply
the global mode locally without sharing it.

## 2. The global mode

- **Two levels.** The pill holds the **global mode**: `online`, `auto` or
  `away` (Auto when never chosen). Each network's dot holds its own mode:
  **Same as global** (the default — every network starts there, and a saved
  entry with no `presenceMode` means it), `online`, `auto`, `away` or
  `dnd`. A network's **effective mode** is its own mode, or the global mode
  while it is on Same as global. Everything that used to read the network's
  mode reads the effective one: `presence.ts` `wantsStar`, the presence
  snapshot, the dot's words, the push mute's per-network DND.
- **Do not disturb on the pill stays the global do not disturb switch**
  (timed, until turned off, or the schedule) and outranks both levels on
  every network, as before: away, no notifications, push muted for the
  account. It is not a global _mode_: picking a DND duration leaves the
  global mode underneath, and when DND ends the networks go back to it.
- **The pill menu**: **Online**, **Auto**, **Away** (the global mode;
  picking one also turns do not disturb off — one choice at a time), a
  divider, **Do not disturb for 1 hour / for 8 hours / until I turn it
  off**, a divider, **Follow schedule (…)** (a toggle) and **Edit
  schedule…**. The checked item is the DND item while DND is on, else the
  global mode. A scheduled window leaves the global mode as it is.
- **The pill's words and dot**: do not disturb (as before), else the global
  mode's name — "Online", "Auto", "Away" — with its colour (Auto green, or
  amber while this device is unattended). Networks overriding it show on
  their own dots; the pill no longer summarises the networks.
- **The dot menu**: **Same as global (Away)** — naming what the global mode
  is now — then Online, Auto, Away, Do not disturb. The dot's words name the
  effective mode and where it comes from: "Away · global" for a network
  following the pill, "Online" for one set on its own; "· away" is still
  added when the effective mode is present but the network is away for
  another reason (DND, attention).
- **The network form's** mode select gains Same as global, its default.
- **Kept on the device** in `thelounge.dnd`, beside the DND switch and
  schedule, as `mode: {value, at}` (`at` the Unix ms of the user's last
  choice, null if never chosen; replaces 2026-10-15's `away: {on, at}`, which
  only existed on this branch and is read as `away` on, `auto` off). It
  follows the DND state across this device's tabs and in the settings
  backup.
- **Migration**: a saved network with no `presenceMode` was Auto and is now
  Same as global, whose default is Auto: the same behaviour until the user
  picks a global mode. An explicit `auto` is now stored as `auto` (it used
  to be dropped as the default).

## 3. Where the shared state lives

Two private account metadata keys per network (that is, per server):

```
METADATA * SET seance/presence private :<mode> <changedAt>
METADATA * SET seance/mode private :<online|auto|away> <changedAt>
```

- `seance/presence` is the network's own mode: `global` (Same as global),
  `online`, `auto`, `away` or `dnd`; `seance/mode` is the global mode
  (2026-10-16; it replaces the unreleased `seance/away`, which is no longer
  read or written).
- `<changedAt>` is the moment the user made the choice, in Unix
  milliseconds, on the device that made it. Not the moment it reached the
  server: a change made offline at 15:00 and uploaded at 16:00 still counts
  as 15:00.
- `private` is required: nefarious2 stores a `SET` without a visibility as
  public (found with the mute key, do-not-disturb.md § Server notes).
- nefarious2 accepts the keys (`a-z 0-9 _ . / -`, `m_metadata.c`
  `is_valid_key`) and persists account metadata server side (RocksDB), so
  the values outlive every connection of the account.
- A value that does not parse (an unknown word, no time, extra words) is
  ignored as if absent, so a later client can extend the format without
  older ones fighting over it.
- The global mode is one choice for the whole device, but each network's
  server holds its own copy: a device writes it to every network it can,
  and adopting it from any one network makes the device write it to the
  others whose copy is older (§ 4). Networks on different accounts or
  servers therefore carry it between devices that share at least one of
  them.

## 4. The rule: the most recent choice wins

The same rule for both keys. For each network and key, a device knows its
own choice (value and `changedAt`, or none — a mode never chosen, the
global mode never picked) and the last value it read from that network's server
on this connection. It compares by `changedAt`; on a tie, by the value's
word (plain string order), so every device picks the same winner without
talking to the others.

- **Server newer than the device's choice**: adopt it — the value and its
  `changedAt` — save it, and apply it at once (`syncPresence`: `AWAY *` /
  `AWAY`, the push mute). For the global mode, adopting it on one network makes
  the page switch it for every network (§ 6), and each of those writes it to
  its own server if that copy is older.
- **Device newer than the server's value** (a change made here, online or
  offline, or a newer value a late older write replaced): write the device's
  choice, and remember it as the server's value so it is not written twice.
- **Same value, or neither has one**: nothing.

So a change made while offline needs no flag of its own: at the next login
the device's choice is newer than the server's and goes up; one made on
another device since is newer still and is adopted instead.

The server stores the last write it received, not the newest choice. Two
devices can race: A reads an older value, B writes a newer one, A's write
lands after it. Every connected device is subscribed, so B hears A's older
value and, knowing a newer one, writes its own again. Only a device that
knows a strictly newer choice ever writes in answer to a read, so this
settles on the newest and stops.

Device clocks decide the order. Phones and computers set their clocks from
the network and agree to well under a second; a device whose clock is off
by minutes can lose a change made just after another device's. Accepted.

## 5. When it is read and written

- **Subscribed from the start**: with `draft/metadata-2=before-connect` and
  a SASL login, `METADATA * SUB draft/webpush/mute seance/presence seance/mode` rides the `CAP END` flush (before registration, so no fake
  lag; `IrcClient.metadataSubscribed`). Without `before-connect` it goes out
  with the login read below. Subscribing only 10 s in lost changes: a device
  that registered missed another device's change made in that window, and
  the server then answered its GET from the connection's own stale copy
  (§ 9), so the two devices stayed apart (found live, presence-shared
  case 5).
- **At registration**: nefarious2 sends the account's own metadata in a
  burst at registration (`metadata_burst_self_to_client`); its
  `seance/presence` and `seance/mode` lines go through § 4 at once.
- **Login read**: 10 s after registration (`IrcClient.scheduleMuteRead`,
  `MUTE_READ_DELAY_MS` — after the connect burst, where nefarious2's fake
  lag is cheapest) one `METADATA * GET` names all three keys (metadata-2
  allows several keys per `SUB` and `GET`); it answers a key the burst did
  not carry (unset) and goes through § 4.
- **A choice on this device** (the dot, the network form; the pill's
  Online / Auto / Away items for the global mode, and its DND items): applied at once as today, stamped with
  `Date.now()`, saved, and written to every network that can (registered,
  `draft/metadata-2`, logged in) once that network's login read has
  answered — before that, § 4 decides at the read.
- **Another device's DND Off** (`dnd:cleared`, irc/pushMute.ts) turns this
  device's global DND off and **leaves the network modes alone**. It used to
  set a network in mode `dnd` back to Auto; with the mode shared that
  stamped a choice newer than the real one (a device leaving mode `dnd`
  clears the mute, the other read that as a DND Off and stamped Auto, and
  every device adopted Auto — found live, presence-shared case 5). A device
  that leaves mode `dnd` sends its new mode itself.
- **A choice on another device**: the subscription's `METADATA` line, put
  through § 4 like a read.
- **Our own write's echo** (the 761 confirmation and the subscription's
  line): equal to what we remembered writing; nothing.
- A `FAIL METADATA` for our write: nothing now; the next login reads the
  server's value again and writes ours if it is still newer.
- A connection that closes forgets the server's values and that it read
  them: the next login reads again.

**Away until read.** A device that missed a change while it was off (the
global Away set on another device) used to declare its old state during the
next registration, so a present-looking device showed the account back to
everyone (`AWAY ` then `AWAY :*`, found live 2026-10-19) until the burst
brought the newer state a moment later. Now a connection holds itself away
until the read — `AWAY *` before `CAP END` and again at registration
(`presence.ts` `shareUnread`, part of `wantsStar`) — when all of these hold:

- it subscribed before `CAP END` (`before-connect`, so the burst follows
  at registration) and speaks `draft/pre-away`;
- this device **may have missed a change** on this network: it was never in
  sync, or not for longer than `SYNC_WINDOW_MS` (120 s). "In sync" is dated
  by the last line received on a connection that had read the shared state
  (`irc/presenceSync.ts`, `thelounge.state.presenceSync`, uuid → ms, written
  every 15 s and at the close, forgotten with the network, never in the
  backup) — the last line in, not the close, because a socket the OS killed
  in the background reports its close only when the page wakes. A reload or
  a quick reconnect is inside the window and declares its own state as
  before, so a present device's reload is no away blip; a change another
  device makes inside the window still shows at this one's login (accepted).

The burst (`handlers/metadata.ts` `metadataBatch`, `BATCH +ref metadata <own nick>`) ends the hold: what it carries is adopted through § 4, so a
device meant to be present says `AWAY` once, right after it, and one meant
to be away (the global Away, another device's DND) says nothing more. A key
the burst does **not** carry is not read as unset — a burst can come from a
stale copy (§ 9; measured: one without `draft/webpush/mute` while DND was
on), and reading it as gone cleared DND — so writing and an entry gone
still wait for the 10 s GET. The hold never outlasts `MUTE_READ_FALLBACK_MS`
(a read refused or lost). Without `before-connect` there is no burst and no
hold: the old state is declared and corrected at the 10 s read, as before.

## 6. Where it is kept on the device

- The mode's time: `presenceAt?: number` on the saved network entry
  (`saved-networks.ts`), beside `presenceMode`; absent for a mode never
  chosen. Carried by the settings backup with the entry; a restored old
  choice simply loses to a newer server value by § 4. A network that is not
  saved keeps it in memory for the page.
- The global mode: `mode: {value, at}` in `thelounge.dnd` (§ 2), held by
  `client/js/dnd.ts`, which hands it to every IRC client
  (`manager.setGlobalModeAll`, beside `setGlobalDndAll`) and listens for one
  adopted from a server (`mode:shared`).

## 7. Components

- **`client/js/irc/presenceShare.ts`** (new, Vue-free, DOM-free, under
  mocha): `PRESENCE_KEY`, `AWAY_KEY`, `parseStamped` / `formatStamped`
  (`<word> <ms>` against a word list), `newer(a, b)` (§ 4's order),
  `onPresenceValue` / `onAwayValue` (a value read: adopt, or write ours
  back), `syncShared(client)` (write whatever this device knows newer than
  its server).
- **`client/js/helpers/dnd.ts`**: `GlobalMode` (`online` / `auto` /
  `away`), `DndState.mode` (`{value, at}`) and its parse (the 2026-10-15
  `away: {on, at}` read as `away` / `auto`), `NetworkMode` (`global` plus
  the four modes), `effectiveMode(network, global)`, and `pillStatus(state, now)` → `online` / `auto` / `away` / `dnd` (the pill's checked item and
  words).
- **`IrcClient`**: `presenceMode` (a `NetworkMode`, `global` by default),
  `presenceAt`, `globalMode {value, at}`, `effectiveMode`, and per key the
  server's last value and whether it was read on this connection (reset on
  close); `setPresenceMode(mode, at?)` and `setGlobalMode(mode)`.
- **`presence.ts`**: `wantsStar`, `effectiveDnd` and the snapshot read the
  effective mode; the snapshot also says whether it is the global one.
- **`handlers/metadata.ts`**: both keys join `OWN_KEYS` and are routed to
  `onPresenceValue` / `onGlobalModeValue`.
- **`bus.ts` / `manager.ts`**: a mode chosen here is stamped and saved with
  its time; `network:presence-shared` saves an adopted one;
  `manager.setGlobalModeAll`; new clients start with the saved mode and
  time and the page's global mode.
- **`client/js/dnd.ts`**: `setGlobalMode(mode)` (stamped, saved, and DND
  off), DND choices leave the global mode as it is; `mode:shared` adopted
  when newer; `pillLabel` / `pillState` read `pillStatus`.
- **`PresencePill.vue`** and **`NetworkLobby.vue`** (the dot): the menus of
  § 2; **`NetworkForm.vue`**: Same as global in the mode select.
- **`client.ts` `scheduleMuteRead`**: subscribes to and gets the three keys.

## 8. Testing

- **`test/irc/presenceShare.ts`**: the values' parse and format (bad values
  ignored); `newer` including the tie; for each key: adopt a newer server
  value (the mode applied with its time and `network:presence-shared`; the
  global mode applied with `mode:shared`), `global` as a network's shared
  mode, write a device choice newer than the
  server's, adopt instead of writing when the server's is newer, an empty
  server with and without a device choice, our echo writing nothing, the
  race (an older value arriving after ours written back once, and not again
  on its own echo), no write before the login's read, a reconnect reading
  again before writing, nothing without an account or `draft/metadata-2`, a
  `FAIL METADATA` writing nothing, the login read's lines, and the
  subscription: before `CAP END` with `before-connect` after a SASL login
  (then the read only GETs), with the read without it, again after a
  reconnect; away until read — a device never in sync declares `AWAY *`
  at login and says `AWAY` once the empty burst is read, a burst carrying
  the global Away (or another device's DND) sends nothing more, a burst
  without a key reads nothing into it, Online is held too, the fallback
  ends a hold no read answers, no `draft/metadata-2` means no hold, a quick
  reconnect and a reload inside the window hold nothing, and a connection
  silent past the window (however late its close) or a reload after it
  holds. Browser check: `tools/scenarios/presence-connect-away.mjs` (an
  observer with away-notify sees no AWAY line while A reloads, closes and
  reopens and a new device B logs in and reloads, all under global Away).
- **`test/irc/presence.ts`**: the effective mode — a network on Same as
  global follows each global mode (Online present even unattended, Auto by
  attention, Away `AWAY *`), a network with its own mode ignores the global
  one, global DND outranks both, and the effective state is declared before
  `CAP END`.
- **`test/helpers/dnd.ts`**: `mode` parses, defaults to Auto, survives a
  bad value and reads the old `away` field; `effectiveMode`; `pillStatus`
  for each combination (DND outranks the global mode).
- **`test/irc/saved-networks.ts`**: `presenceAt` round-trips and is dropped
  when malformed; no `presenceMode` reads as `global`, an explicit `auto` is
  kept.
- **`test/irc/multi-network.ts`**: a dot or form choice is stamped and
  saved; the same mode re-posted by the form stamps nothing;
  `network:presence-shared` saves; another device's mute clear leaves a
  shared mode `dnd` as it is. (`manager.ts` imports the store and cannot
  load under mocha: `setGlobalModeAll` and a new client's starting state
  are covered by the browser runs.)
- **Live, two devices** (`tools/scenarios/presence-shared.mjs`, the testnet
  rig, two Chromium profiles as in `away-two-devices.mjs`):
  1. A mode change on A reaches a connected B within a few seconds.
  2. B closed; A changes the mode; B reopens and shows it after its login
     read.
  3. B disconnected; the mode changed on B; B reconnects and uploads it; A
     shows it.
  4. Both change while apart, B later than A; after both reconnect, both
     show B's mode.
  5. The global mode: Away on A's pill; B's pill reads Away, a network on
     Same as global reads "Away · global" on both devices and others see it
     away; a network set to Online on its own dot stays present; Online on
     B's pill brings both devices' pills to Online.
- **Browser, one device** (`tools/scenarios/dnd.mjs`): its pill-menu steps
  follow the new items (Online replaces Available), plus the global mode's
  Away / Online / Auto on a network following it, and the dot's Same as
  global.
- **`tools/scenarios/presence-modes-two-devices.mjs`** gave each device its
  own mode (A Away, B Online). With sharing that state cannot be set up, so
  that scenario is reworked to share one mode (Away) and keep its
  measurements; its step-7 regression stays covered by `test/irc/preaway.ts`.
- `yarn test`, and the existing `away-live.mjs` and `away-two-devices.mjs`
  runs (their Off steps now click the pill's Auto, the old default).

## 9. Server notes (measured on the testnet, not changed here)

- nefarious2 keeps a copy of the account's own metadata per connection. A
  `SET` updates the writer's copy and the account store and notifies the
  subscribers, but a connection that was not subscribed keeps its old copy,
  and a later `GET` from it, and the registration burst of a connection
  resuming a held session as primary, answer from that copy. Measured with
  `/tmp`-only probes (two raw connections on one account): the primary was
  handed `seance/away on …892110` while an alias of the same session got the
  newer `off …900141`. § 4's rule tolerates a stale read (the stale value is
  older, and the device holding the newer choice writes it back when it sees
  the older one); subscribing before registration (§ 5) closes the window
  in which a connection missed a change. A candidate upstream issue.
- A `SUB` before `CAP END` is accepted (770, answered under the
  pre-registration nick) and survives registration.
- **Known gap**: a device that resumes a held session as primary can be
  handed a stale value that is newer than its own choice (in the burst, and
  again by the GET). It adopts it and writes nothing, so no other device
  sees a disagreement to repair: it holds the stale value until another
  device writes again. No read the client can make gets past the stale
  copy; the fix belongs in the server (keep the per-connection copy in step
  with the account store).
- A value this build cannot read (a later client's format) is never
  answered with a write; only a choice made on this device after it was
  read goes over it (§ 3: no fighting over a format we do not know).
