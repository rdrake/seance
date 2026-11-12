# Account state across a split and a burst: scope and design (before any TLA+)

The readings are in `DECISIONS.md`. This file fixes what gets modelled, at what bounds, and how
each property is checked.

## The world

- Servers **A** and **B**, one link, `up` or `split`. Each direction is a FIFO of P10 lines; a
  receive step processes one line.
- Clients:
  - **P**, a plain user homed on A (nick `P`), logged in as `X` at start;
  - **dA** and **dB**, the two devices of one bouncer session of account `X` (nick `S`), homed
    on A and B. One is the face (primary), the other an alias (`InitPrim`).
- Observers **oA** (on A) and **oB** (on B): other users in the same channel with
  `account-notify`, `extended-join` and `account-tag`. They only listen.
- Accounts `X`, `Y`; `*` is logged out.

## State

| Variable | Meaning |
| --- | --- |
| `acc[v][c]` | server v's account for client c; `acc[Home(c)][c]` is the truth; `-` is no copy |
| `alive[c]`, `inSess[c]` | client c exists; device c is in the session |
| `face[v]` | the client server v shows as nick S, or `none` |
| `chan[v]` | server v holds P as a member of the channel |
| `view[o][n]` | observer o's view of nick n: an account, `*`, or `gone` |
| `q[v]`, `link` | lines in flight from v; the link |
| `win` | the heal's verdict inputs (D8) |
| `bad`, `seen` | properties a delivered message broke; cover events |

## Actions

- `ChangeP(o, a)`: P's account changes at A (SASL, webhook) or at B (services), as `POrigin`
  allows, to `X`, `Y` or `*`. ACCOUNT to the local observer; `AC` to the peer.
- `PartJoinP`: with `Joins`, P parts or joins at A; extended JOIN or PART to oA; `J` to B.
- `SessReauth(c, a)`: with `SessSwitch` (the code; the #223 ruling forbids it, D10), the face
  re-authenticates to another name. When the
  session is found (`Lookup`: always for `"byRecord"`, only under the session's name for
  `"byName"`), the local copy of the remote alias is updated and `BX U` goes with `AC`, in the
  `AliasFirst` order; otherwise only `AC`. ACCOUNT to the local observer.
- `AliasReauthA(c, a)`: with `AliasReauth` (the code; the #223 ruling forbids it, D10), an alias
  device re-authenticates to another name: its own account, ACCOUNT under nick S to the local
  observer, `AC` to the peer.
- `SvcRenameB(a)`: with `SvcRename` (D10), services on B rename the account of the face B shows:
  B's copy changes, ACCOUNT to oB, and `AC M` goes to A (with `"all"`, one for the alias too).
  When the face is B's own client and the session is found (`Lookup`), B's copy of the alias
  changes and `BX U` goes before the `AC`; when the face is A's, A does the same on reading the
  `AC` (`RecvAC`).
- `LogoutFace(c)`: with `SessLogout`, during a split only: the face is deauthed and leaves the
  session.
- `Send(c)`: a message. Delivered at once on the sender's server, as `MSG` across the link. The
  tag is the delivering server's copy of the source it delivers as (P, or that server's face).
- `Recv(v)`: v processes the head line from the peer: `AC`, `BXU`, `MSG`, `N`, `J`, `BXC`,
  `KILL`.
- `Split`: drop the link (and, with `LossAtSplit`, whatever is in flight), drop the copies of
  the peer's clients, QUIT them to the local observer, promote the local device where the face
  was remote (D6, D7).
- `Heal`: choose the verdict, raise the link, and queue each server's burst: `N` for P (from A,
  with its channel membership) and for the local face (with its account and session flag).

## Properties

`NoLossAfterLinkedSvcRename` is P11 restricted to the services path: a rename while linked, no
change during a split.

P1 to P11 of `DECISIONS.md`, and `NoLossAfterLinkedRename` (P11 restricted to the live run's
sequence: a rename while linked, no change during the split). Quiescent = link up, both directions empty. P1, P3, P4, P5 and P10 are
checked in every state (P3-P5 through `bad`, set when a delivery breaks one). P2, P6 to P8 and P11
are checked in quiescent states only: a view may lag while its correction is in flight.
Convergence is a safety property at quiescence, not liveness: the model does not claim that
quiescence is reached, and the covers show that it is, after a heal.

## Bounds

`MaxChanges` (account changes and joins), `MaxMsgs`, `MaxSplits`. The limited configs use
`MaxSplits = 1`, `MaxChanges` 2 or 3, `MaxMsgs` 1 or 2. The comprehensive configs (`Big*`) use
2 splits, 4 changes, 2 messages.

## Mutants

Each replaces one anchor in `Bouncer.tla` (`mkcfg.py`) and must break the property named.

| Mutant | Change | Caught by |
| --- | --- | --- |
| `M_KeepReplica` | a split keeps the copy of the peer's plain user and sends no QUIT, so the burst finds a member and sends no JOIN (`m_burst.c:973`) | `ViewConverges` |
| `M_NoLocalNotify` | P's server does not tell its own observer of P's change | `ViewMatchesServer` |
| `M_NoRelayAC` | P's change is not sent to the peer | `ViewConverges` |
| `M_TagFromHome` | the delivering server stamps the tag from the sender's own server's value, not its copy | `TagAgreesView` |
| `M_NoBXU` | the face's change does not reach its remote alias | `AliasesAgree` |
| `M_MergeBothKeep` | at a merge the losing side refuses too, instead of demoting | `OneFace` |
| `M_ClassicNoKill` | a classic loser is replaced as face but not killed, and no KILL is sent for it | `OneFace` |
| `M_JoinStar` | the burst JOIN always carries `*` | `ViewMatchesServer` |
| `M_PromoteQuit` | the split promote QUITs the nick to the observer | `ViewMatchesServer` |
| `M_BurstStale` | the burst's `N` for P carries the account P had before the split | `ViewConverges` |
| `M_SvcNoEmit` | the face's server, reading services' `AC`, does not emit to the session's alias (`m_account.c:312` removed); run on `SvcRecordTight` | `NoLossAfterLinkedSvcRename` |
