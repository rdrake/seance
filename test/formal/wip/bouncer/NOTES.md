# Bouncer.tla: account state across a split and a burst (v2)

Readings: `DECISIONS.md` (D1-D9, P1-P11). v1 follows a live two-server run that corrected
three v0 readings (DECISIONS.md, v1 note: `Lookup`, `ClassicTie`, `NoSessionLoss`). v2 follows
the ruling on nefarious2 #223 (DECISIONS.md D10): a SASL re-auth never moves a client to another
account, so the only route left is a services rename (`SvcRename`). Scope, actions, mutants:
`DESIGN.md`. Server: nefarious2 `ircv3.2-upgrade` at e81d12aa; services: evilnet/x3 at a8f6d02.

## Files (`model/`)

- `Bouncer.tla`: the model.
- `mkcfg.py`: writes every `.cfg`, the `M_*` mutants and `list-limited` / `list-big`. Run it
  from `model/` after any change to `Bouncer.tla` (a mutant's anchor must occur exactly once).
- `run.sh LIST`: TLC, `-workers 1`, one summary line per check; logs in `logs/` (not
  committed).
- `results-limited.summary`: the last run of `list-limited`.

## What the runs say

**Positives** (every property but P5 in one run each; `BaseRemote`/`MidRemote` leave out P4,
which `W_RemoteTag` shows breaks there). All pass under the restrictions each names: one
origin for P's changes, no alias re-authentication, no account change while a burst `N` or a
merge's `BX C` is unread, a split that cuts nothing in flight (or one that may, with the
candidate `PromoteNotify`), and a merge's `BX C` carrying the device's account, a session found by its record (`Lookup =
"byRecord"`, a candidate change), and an abstract classic outcome (`ClassicTie = "any"`).
`BaseWinner` and `MidWinner` (exactly one classic winner) add P11 and pass. `CodeRecord` has
every switch at the code's value except `Lookup = "byRecord"` (and no alias re-auth, no
change in the burst window, no loss at the split): the live run's sequence then merges and
`NoLossAfterLinkedRename` holds.

**Witnesses** (each one switch at the value the code allows; expected to fail):

`AliasReauth` and `SessSwitch` at TRUE are server defects under the #223 ruling (D10): the
`W_AliasReauth*` rows are the route of #218, `W_CodeRename` (and `W_LookupByName`) that of #219.

| Config | Switch | Breaks | Shortest trace |
| --- | --- | --- | --- |
| `W_AliasReauth`, `-Tag`, `-Agree` | `AliasReauth` | P1, P3, P6 | the alias device re-authenticates to Y; the observer is told Y under nick S; the face (and every tag) stays X |
| `W_SplitLoss`, `-Conv` | `LossAtSplit` | P1, P2 | the face changes to Y; the peer reads `BX U` (its alias becomes Y), the split cuts the `AC`; the alias is promoted silently; the observer keeps X, also after the heal |
| `W_BxcSession` | `BxcName = "session"` | P6 | both faces change to Y during the split; the heal merges them; the demoted face's `BX C` carries the session name X |
| `W_BurstReauth` | `ReauthInBurst` | P10 | a face changes account after its `N` is sent; one server merges (from the `N`), the other goes classic (from its client now) |
| `W_BurstReauthAgree` | `ReauthInBurst` | P6 | the face changes account after a merge, before the demoted face's `BX C` is read; the face's server has no alias on its roster to tell |
| `W_BothOrigins` | `POrigin = "both"` | P7 | P's server and services change P at once; the two `AC` lines cross and each overwrites the other's copy |
| `W_TagAtSend` | none (Base) | P5 | the face changes to Y; the alias device sends before it reads `BX U`; the face's server tags it Y |
| `W_RemoteTag` | `POrigin = "services"` | P4 | services change P; P sends before the `AC` reaches A; B tags it with the new account |
| `W_LookupByName` | `Lookup = "byName"` | P6 | the face changes to Y; no `BX U` (the session is filed under X); the alias stays X |
| `W_TieCode` | `ClassicTie = "code"` | P11 | the face is deauthed during the split; at the heal the classic rules end both devices |
| `W_LookupLoss` | `Lookup`, `ClassicTie` at the code's values | P11 | as `W_TieCode` (the shortest path) |
| `W_Code` | every switch at the code's value | P11 | as `W_TieCode` |
| `W_CodeRename` | the code's values, no alias re-auth, no change in the burst window, no loss at the split | `NoLossAfterLinkedRename` | the live run's sequence: the face renames X to Y while linked; only `AC` goes; SQUIT; B promotes its alias (X); heal; the `N` lines show Y and X; no D.2; same user@host and nick TS; each server kills both |
| `W_CodeView` | every switch at the code's value | P1 | as `W_AliasReauth` |

P5 is not a guarantee (DECISIONS P5): the tag is computed by each delivering server from its
copy of the face (`send.c:604-608`, `ircd_relay.c:648-651`).

## After the #223 ruling (v2): does `NoSessionLoss` hold when only services renames remain?

`INTENDED` (`mkcfg.py`) is every switch at the code's value except the ruling's two
(`SessSwitch`, `AliasReauth` FALSE) and no deauth during a split (`SessLogout` FALSE; that route
is not a rename, `W_IntendedLogout`). `TIGHT` adds no lossy split and no change in the burst
window. All at 2 changes, 1 message, 1 split unless named.

| Config | Settings | Invariant | Result | Distinct states | Time |
| --- | --- | --- | --- | --- | --- |
| `I_Name` | `INTENDED`, `byName`, no rename | `NoSessionLoss` | holds | 8,645 | 2 s |
| `I_Name3` | as `I_Name`, 3 changes, 2 splits | `NoSessionLoss` | holds | 100,760 | 6 s |
| `W_SvcName` | `INTENDED`, `byName`, `SvcRename = "face"` | `NoSessionLoss` | violated | 16,356 | 3 s |
| `W_SvcNameLinked` | the same | `NoLossAfterLinkedSvcRename` | violated | 16,356 | 3 s |
| `W_SvcNameTight` | `TIGHT`, `byName`, `"face"` | `NoLossAfterLinkedSvcRename` | violated | 12,405 | 3 s |
| `W_SvcNameTightB` | as `W_SvcNameTight`, the face on B | `NoLossAfterLinkedSvcRename` | violated | 12,151 | 2 s |
| `W_SvcNameAll` | `TIGHT`, `byName`, `"all"` | `NoLossAfterLinkedSvcRename` | violated | 12,630 | 3 s |
| `W_SvcRecord` | `INTENDED`, `byRecord`, `"face"` | `NoSessionLoss` | violated | 17,893 | 3 s |
| `W_SvcRecordLinked` | the same | `NoLossAfterLinkedSvcRename` | violated | 17,893 | 4 s |
| `W_SvcRecordBurst` | as `W_SvcRecord`, no lossy split | `NoLossAfterLinkedSvcRename` | violated | 11,903 | 3 s |
| `W_SvcRecordLoss` | as `W_SvcRecord`, no change in the burst window | `NoLossAfterLinkedSvcRename` | violated | 17,940 | 3 s |
| `SvcRecordTight` | `TIGHT`, `byRecord`, `"face"` | `NoLossAfterLinkedSvcRename` | holds | 12,866 | 3 s |
| `SvcRecordTight3` | as `SvcRecordTight`, 3 changes, 2 splits | `NoLossAfterLinkedSvcRename` | holds | 173,105 | 9 s |
| `SvcRecordTightAll` | `TIGHT`, `byRecord`, `"all"` | `NoLossAfterLinkedSvcRename` | holds | 13,300 | 3 s |
| `W_SvcRecordTightSplit` | `TIGHT`, `byRecord`, `"face"` | `NoSessionLoss` | violated | 10,787 | 3 s |
| `W_IntendedLogout` | `INTENDED` with `SessLogout`, no rename | `NoSessionLoss` | violated | 10,728 | 3 s |
| `CoverSvcRenameHealed`, `-B` | `TIGHT`, `byRecord`, `"face"` (face on A, on B) | the cover | reached | 8,325 / 8,217 | 2 s |
| `M_SvcNoEmit` | `SvcRecordTight` with no emit on the `AC` | `NoLossAfterLinkedSvcRename` | caught | 12,379 | 3 s |

(Each run also checks `TypeOK` and `NoUnexpected`.)

**Answer.** Under `Lookup = "byName"` (the code), a services rename still loses the session:
`W_SvcNameTight` is the live run's sequence with services in place of SASL. Services rename the
face X to Y while linked; A sets it and looks the session up by Y, finds none (filed under X),
so no `BX U`; SQUIT; B promotes its alias, still X; heal; the `N` lines carry Y and X, so no
D.2 merge; same user@host and nick TS, so each server kills both. It is lost even if services
told every device (`W_SvcNameAll`: both show Y, and no session is filed under Y). Under
`"byRecord"` the face's server finds the session, the alias follows by `BX U`, and the heal
merges: `SvcRecordTight` and `SvcRecordTight3` hold, and `M_SvcNoEmit` shows they rest on that
emit (`m_account.c:312`). So `byRecord` fixes the linked rename, with three limits the runs show:

- a rename in the burst window (`W_SvcRecordBurst`: services rename B's face after B's `N` is
  queued; A merges from the old name in the `N`, B goes classic from its face now): the
  `W_BurstReauth` hazard of v1, reached now by services;
- a split that cuts the `BX U` after the face's server sent it (`W_SvcRecordLoss`): the faces
  meet at the heal with Y and X;
- a rename during a split (`W_SvcRecordTightSplit`): services reach only B's side, A's device
  keeps X, and the heal meets Y and X. No lookup fixes this one; the meeting needs equal names.

Each of the three ends in the classic rules with equal nick TS and the same user@host, the
v1 `ClassicTie = "code"` reading (D8). With X3's `sync_log` off (its default) `RENAME` sends no
line, nothing changes on the network, and `I_Name` covers it.

**Covers** (all violated, as required): a SQUIT promote (both `InitPrim`), a D.2 merge reaching
quiescence (also under `LossAtSplit` + `PromoteNotify`), a classic kill reaching quiescence, P
logged out during a split then healed with oB told `*`, a message from an alias device
delivered, a session change that crossed the link to a remote alias.

**Mutants**: all eleven caught (`results-limited.summary`).

## Limited runs (here, one worker)

`list-limited`: 70 checks (v2: 19 new; the v1 51 unchanged in result and state count), about 7 minutes in all (`results-limited.summary`, each line with
its distinct states and time); the largest, `Mid` and `MidB` (3 changes, 2 messages, joins, 1
split), are 1.59 M distinct states in about 55-70 s each.

## Comprehensive, for gpu05 later (`list-big`, written, not run)

| Config | Bounds |
| --- | --- |
| `BigBase` | 2 splits, 4 changes, 2 messages, joins |
| `BigB` | as `BigBase`, the face on B |
| `BigLossFix` | as `BigBase`, lossy split with `PromoteNotify` |
| `BigRemote` | as `BigBase`, P changed by services only (no P4) |
| `BigCode` | every switch at the code's value; only `TypeOK` and `NoUnexpected` (a reachability run) |
| `BigWinner` | as `BigBase`, exactly one classic winner, with P11 |

A partial `BigBase` run here passed 8.3 M distinct states in 5 minutes with the queue still
at 1.4 M; it was stopped there.

## Open (not modelled)

- Held ghosts, a third device, a second session of the account, a linked deauth of a session.
- `NICK` (D9), WHO/WHOX, account tags on numerics (AT:24-28).
- The user's own ACCOUNT (D1, Self; the live run confirmed the code skips it).
- What X3 does at a relink with a device still logged in under a handle it has renamed (a
  rename during a split); the model stops at the nick collision, which comes first.
- `/CHECK` and WHOIS are not modelled; the live run's answers agree with `Belief` (the face's
  account).
