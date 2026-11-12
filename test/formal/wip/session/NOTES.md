# Session.tla: the cold-start restore race (D34 item 2)

A small TLA+ model of when Seance sends its own `JOIN` and its own catch-up on a
cold start against a held session (`draft/persistence`), relative to the server's
restoration batch. It answers D34 item 2, which History.tla leaves out. These
notes live here and not in `../history/DECISIONS.md`.

Code modelled: Seance develop febe817b6 (#282), as in `/home/claude/sdev`:
`client/js/irc/persistence.ts`, `handlers/batch.ts`, `client.ts`
(registration end, `restorationSettled`, `autojoin`, the `selfJoin` →
`enqueueCatchup` / `serverReplayCovers` path), `handlers/join.ts`,
`handlers/standard-replies.ts` (NOTE BOUNCER), `catchup.ts` (prefetch).
Server: nefarious2 `bounce_setup_local_alias` / `bounce_send_channel_state`
(NOTE, then `BATCH +p draft/persistence` with JOIN, topic, MARKREAD, NAMES per
channel, `BATCH -p`) and `replay.c` (the cursor's
`evilnet.github.io/bouncer-replay`, after the restoration).

## Files

- `Session.tla`: the model. `MC.tla`: tuple constants (a `.cfg` cannot write one).
- `mkcfg.sh`: writes every `.cfg` from one table of defaults and overrides.
- `run.sh CFG...`: TLC on `MC.tla`, `-workers 1`, one summary line per config,
  logs in `logs/` (not committed). `results.summary`: the last full run.

## Design

**Server.** A fixed script, built from the constants:
`[NOTE] BATCH+p { [BATCH+n] JOIN c, BODY c [BATCH-n] }* BATCH-p [REPLAY]`.
`BODY` stands for topic, MARKREAD and NAMES (all buffered, all equal for the
client). `Nested` picks which channels come in a nested batch. `REPLAY` is the
whole cursor replay as one line (it covers every restored channel). The client's
`JOIN` is answered after `BATCH -p`: the server wrote the batch before it read
our line, and the stream is ordered. A restored channel's answer (echo or
nothing) is a no-op either way (`alreadyJoined`).

**Time.** Discrete ticks. Real-ratio configs use 250 ms ticks: `Quiet 3`
(750 ms), `InitialWait 8` (2 s), `Cap 32` (8 s). Network delay is the
interleaving of `Tick` and `Deliver`: at most `MaxGap` ticks between two server
lines (and before the first), unless `StallOK` (the server may stop for good
before `BATCH -p`) or `Endless` (the batch never closes, restoration lines keep
coming within `MaxGap`). A due timer fires before time moves on, but a line
arriving in the same tick can be read before or after it (two events at the same
millisecond). So `MaxGap = Quiet - 1` is "every pause under 750 ms" and
`MaxGap = Quiet` lets a pause equal the quiet period.

**Client.** `timer` is `RestoreState.timer` as ticks left (−1 = null), armed at
registration with `InitialWait` (`awaitRestoration`) and re-armed to `Quiet` by
each restoration activity, clamped to the deadline (`arm`: `min(delay,
deadline - now)`). Activity under #282: the NOTE, the batch opener, every line
inside it, a nested opener and closer (`inRestoration` walks the parent chain),
the replay's close. Firing runs `restorationSettled` → `autojoin`: one JOIN for
every channel still PARTED, and the active one's catch-up prefetched behind it.
`BATCH -p` runs `persistenceBatch`: the restored JOINs are applied in restoring
mode (each starts a catch-up unless `serverReplayCovers`, i.e. a cursor, or it
was prefetched), then `restorationSettled` if the timer was still waiting. A
later JOIN echo for a channel not yet joined starts its catch-up unless
prefetched.

**Switches** (the real code is `Rule = "pr282"`, `CloseActivity`, `HasCap`):
- `Rule = "pre282"`: lines inside the batch are not activity (before #282).
- `Rule = "open"`: the timer may not fire while the restoration batch is open,
  until the cap. Open-batch tracking; #282 does not do this (see Findings).
- `CloseActivity = FALSE`: a nested batch's closer is not activity.
- `HasCap = FALSE`: no `RESTORE_MAX_WAIT_MS`.

## Properties

- (a) `NoRace`: no JOIN and no catch-up for a restored channel while `BATCH +p`
  has been read and `BATCH -p` has not, and the cap has not expired.
  (Before `BATCH -p` every restored channel is still to be restored: the batch
  is buffered and applied only when it closes.)
- (a') `NoEarlyJoin`: the same from registration on, before the opener too.
- (b) `NoDouble`: per channel, client walks + the server's replay ≤ 1.
- (c) `Settles`: `<>settled`, the autojoin goes out (weak fairness on Tick,
  Fire, Deliver, More and the JOIN answers; none on Stall).
- (d) `CaughtUp`: every channel is caught up by the client or the replay
  (configs without stall or endless batch).
- Covers (invariants violated iff the path is reachable): `NotClosedFirst`
  (the batch closed while the autojoin waited), `NotNestedHeld` (it closed after
  `Quiet` ticks with only nested lines since the last outer one: the nested batch
  kept the wait alive), `NotCapFired` (the cap fired with the batch not closed),
  `NotCapRaced` (a JOIN for a restored channel after the cap, batch not closed).

## Runs

Local, `tla2tools.jar` (TLC 2026.11.06), `-workers 1`, all under a minute in
total. Defaults: Chans {a,b,c}, restored ⟨a,b⟩, Nested {b}, Active a, Alias,
Cursor, Quiet 3, InitialWait 8, Cap 32, MaxGap 2, real code.

| Config | Change from defaults | Checks | Distinct states | Result | Expected |
|---|---|---|---|---|---|
| Base | — | a, a', b, c, d | 889 | pass | pass |
| BaseNoCursor | no cursor | a, a', b, c, d | 703 | pass | pass |
| BaseStatusOnOff | InitialWait 3 (`STATUS ON OFF`) | a, a', b, c, d | 889 | pass | pass |
| BaseActiveFree | Active c (not restored), Nested {a,b} | a, a', b, c, d | 1013 | pass | pass |
| Big | Chans {a,b,c,d}, restored ⟨a,b,c⟩, Nested {b,c} | a, a', b, c, d | 1441 | pass | pass |
| Small | Quiet 2, Wait 3, Cap 12, MaxGap 1, Nested {a,b} | a, a', b, c, d | 336 | pass | pass |
| Stall | StallOK | c | 1667 | pass | pass |
| EndlessCap | Endless | c | 499 | pass | pass |
| OpenStall | Rule open, StallOK | a, b, c | 1597 | pass | pass |
| OpenGap | Rule open, MaxGap 5 | a, c, d | 6665 | pass | pass |
| W_Gap | MaxGap 3 (= Quiet) | a | 53 | NoRace violated | finding |
| W_StallRace | StallOK | a | 108 | NoRace violated | finding |
| W_OpenEarly | Rule open, MaxGap 5 | a, a' | 37 | NoEarlyJoin violated | finding |
| W_SlowServer | Rule open, Cap 8 | b | 530 | NoDouble violated | inherent limit |
| M_Pre282 | Rule pre282 | a | 59 | NoRace violated | caught |
| M_Pre282Double | Rule pre282 | b | 576 | NoDouble violated | caught |
| M_Pre282NoCursor | Rule pre282, no cursor | b, c, d | 1438 | pass | pass (premature, but no double) |
| M_NoCloseAct | CloseActivity FALSE | a | 279 | NoRace violated | caught |
| M_NoCapEndless | no cap, Endless | c | 496 | Settles violated | caught |
| M_NoCapOpenStall | no cap, Rule open, StallOK | c | 1590 | Settles violated | caught |
| M_NoCapStall | no cap, StallOK | c | 1667 | pass | see below |
| CoverClosedFirst | — | NotClosedFirst | 120 | violated (reachable) | reachable |
| CoverNestedHeld | — | NotNestedHeld | 255 | violated (reachable) | reachable |
| CoverCapFired | Rule open, StallOK | NotCapFired | 1550 | violated (reachable) | reachable |
| CoverCapRaced | Rule open, Cap 8 | NotCapRaced | 209 | violated (reachable) | reachable |

Counterexamples, in short:
- **M_Pre282**: NOTE arms 3; `BATCH +p` at tick 2 does not re-arm; the timer
  fires at tick 3 with the batch open. The phone trace (0.76 s batch after the
  note, 0.75 s quiet).
- **M_Pre282Double**: the premature autojoin prefetches the active, restored
  channel's history; the cursor replay then covers it too.
- **M_NoCloseAct**: `BATCH -n` at tick 2 does not re-arm; `BATCH -p` comes
  after tick 3; fire in between.
- **W_Gap**: a 3-tick (750 ms) pause right after `BATCH +p`; the timer fires.
- **M_NoCapEndless**: restoration lines every 2 ticks forever; with no cap the
  quiet timer is re-armed forever. **M_NoCapOpenStall**: with open-batch
  tracking and no cap, a stalled batch holds the autojoin forever.
- **M_NoCapStall passes**: under #282's rule a silent stall still lets the quiet
  timer fire, so without the cap liveness fails only for a batch that keeps
  trickling (M_NoCapEndless). The cap matters for both rules, for different
  server behaviours.

No run came near the 10-minute limit; nothing is listed for the cluster.

## Findings

1. **#282 waits for activity, not for the batch to close.** Every restoration
   line re-arms the 750 ms quiet timer (`handlers/batch.ts:101,163,182` →
   `persistence.ts:134` `noteRestorationActivity` → `arm`, `persistence.ts:144`),
   but nothing keeps the timer from firing while `BATCH +p` is open. A single
   pause of 750 ms or more between two lines of the batch (a TCP retransmit on a
   phone is enough) still sends the client's JOIN and the active channel's
   prefetch (`client.ts:2041`) while the restore is open: W_Gap, W_StallRace.
   The commit message says what the code does ("waits while the batch is still
   arriving"); D34's stated property ("no client JOIN or walk while the restore
   batch is open") is stronger, and the code does not give it. The model's
   `Rule = "open"` (do not fire while a restoration batch is open, up to the
   cap) does give it for any pause length: OpenGap and OpenStall pass (a).
   Whether to change Seance is a decision for the maintainers; the cost is that
   a server that opens the batch and then dies holds the autojoin for the full
   8 s instead of 750 ms.
2. **Before the opener, only the quiet period guards.** Between the NOTE (or
   registration) and `BATCH +p` nothing says a batch is coming, so even the
   open rule fires if that pause reaches the quiet period (after a NOTE) or
   `RESTORE_WAIT_MS` (without one): W_OpenEarly. nefarious2 sends the NOTE and
   the batch in the same call, so the pause is network-only, but it is not
   covered.
3. **The 8 s cap is an inherent limit.** A server whose batch takes longer than
   `RESTORE_MAX_WAIT_MS` (or stalls) still races, by design: the cap fires, the
   client JOINs and prefetches with the batch open, and with a cursor the active
   channel is caught up twice (W_SlowServer, CoverCapRaced; run at Cap 8 ticks
   to keep the script short, the shape is the same at 32). (a) is therefore
   stated "unless the cap expired"; (b) holds only while the cap is not reached.
   Liveness needs the cap under both rules (M_NoCap*).
4. No discrepancy found in the parts the model covers beyond (1): a premature
   autojoin without a cursor does not double-walk (the prefetch flag stops the
   restored JOIN's walk, `catchup.ts` `enqueueCatchup`; M_Pre282NoCursor), and with a cursor a
   restored JOIN read inside `persistenceBatch` is covered (`restoring`), so the
   only double is the active channel's prefetch.

## Abstractions and gaps

- Every restored channel holds history (`historyRequested`, `before` defined),
  so `serverReplayCovers` reduces to "cursor and restoring". A channel with
  nothing held (fresh page) walks LATEST even under a cursor, by design; not
  modelled.
- The cursor replay is one line and always taken; `FAIL PERSISTENCE ATTACH`
  (fallback to own walks) and `CURSOR_UNKNOWN` are not modelled. Its own lines
  and nested `chathistory` batches are not split out (they come after
  `BATCH -p`, when the client is no longer waiting).
- No unbatched burst (no `batch` cap), no second burst after an alias attach,
  no `STATUS ON` without a batch (the 2 s "nothing held" path is only the
  initial timer).
- The `PERSISTENCE SET ON` line, MODE/MARKREAD queues, TARGETS ordering and
  the background pacing are left out: they do not decide when JOIN or the first
  catch-up go out. A catch-up "walk" is its start only.
- Transport close (`cancelRestoration`) and reconnects are not modelled: one
  connection.
- The JS timer is exact to the tick; a late timer only helps (more lines read).
  Lines within one tick can come in any number; `More` (Endless) needs a tick
  between lines so that time can pass.
- Time is saturating counters (`elapsed` stops at Cap, `gap` at MaxGap), which
  is what keeps infinite behaviours finite for the liveness checks.
- N is 2 or 3 restored channels; the real phone trace had 10. The race depends
  on pauses, not on N, so a larger N only lengthens the script.
