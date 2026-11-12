# Bouncer.tla: account state across a split and a burst (v0)

Readings: `DECISIONS.md` (D1-D9, P1-P10). Scope, actions, mutants: `DESIGN.md`. Server:
nefarious2 `ircv3.2-upgrade` at e81d12aa.

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
candidate `PromoteNotify`), and a merge's `BX C` carrying the device's account.

**Witnesses** (each one switch at the value the code allows; expected to fail):

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
| `W_Code` | every switch at the code's value | P1 | as `W_AliasReauth` |

P5 is not a guarantee (DECISIONS P5): the tag is computed by each delivering server from its
copy of the face (`send.c:604-608`, `ircd_relay.c:648-651`).

**Covers** (all violated, as required): a SQUIT promote (both `InitPrim`), a D.2 merge reaching
quiescence (also under `LossAtSplit` + `PromoteNotify`), a classic kill reaching quiescence, P
logged out during a split then healed with oB told `*`, a message from an alias device
delivered, a session change that crossed the link to a remote alias.

**Mutants**: all ten caught (`results-limited.summary`).

## Limited runs (here, one worker)

`list-limited`: 43 checks, about 4 minutes in all; the largest, `Mid` and `MidB` (3 changes, 2
messages, joins, 1 split), are 1.58 M distinct states in under a minute each.

## Comprehensive, for gpu05 later (`list-big`, written, not run)

| Config | Bounds |
| --- | --- |
| `BigBase` | 2 splits, 4 changes, 2 messages, joins |
| `BigB` | as `BigBase`, the face on B |
| `BigLossFix` | as `BigBase`, lossy split with `PromoteNotify` |
| `BigRemote` | as `BigBase`, P changed by services only (no P4) |
| `BigCode` | every switch at the code's value; only `TypeOK` and `NoUnexpected` (a reachability run) |

A partial `BigBase` run here passed 8.3 M distinct states in 5 minutes with the queue still
at 1.4 M; it was stopped there.

## Open (not modelled)

- Held ghosts, a third device, a second session of the account, a linked deauth of a session.
- `NICK` (D9), WHO/WHOX, account tags on numerics (AT:24-28).
- The user's own ACCOUNT (D1, Self).
