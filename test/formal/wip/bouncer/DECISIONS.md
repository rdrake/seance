# Account state across a split and a burst: decisions (v0)

Each entry settles a reading the text leaves open, says why from the spec text or from the
nefarious2 source, and says how the model shows it. Written before any TLA+.

**Sources.**
- Spec text: `ircv3/ircv3-specifications` at 9ff58d1 (the copy the other models cite). Prefixes:
  `AN` `extensions/account-notify.md`, `EJ` `extensions/extended-join.md`, `AT`
  `extensions/account-tag.md`.
- Server: `evilnet/nefarious2` branch `ircv3.2-upgrade` at **e81d12aa** (2026-11-11). A citation
  `file:line` is under `ircd/` at that sha. Prose in the repository's `.claude/skills/` was read
  as a pointer only; every reading below is checked against the source.

**Kinds**, as in `../history/DECISIONS.md`:
- **guaranteed:** a MUST, or what the code does on every path;
- **allowed:** something the text or the code permits;
- **adversarial:** worse than the text permits, to show a property survives it;
- **restriction:** narrower than the text or the code, to keep the model small.

A property holds only under the settings it names. Nothing here claims more.

## Switches and fixed choices

| Name | Values | Kind | Text / code |
| --- | --- | --- | --- |
| `InitPrim` | the session's primary at start is `dA` (on A) or `dB` (on B) | allowed, both checked | D6 |
| `RemoteOrigin` | P's account may also change at B (services' server) | allowed (code: TRUE) | `m_account.c:187-351`, D3 |
| `SessSwitch` | the session's primary may re-authenticate to another account name | allowed (code: TRUE) | `m_authenticate.c:154-186`, AT:30-36, D4 |
| `AliasFirst` | the primary's server sends `BX U account=` before `AC` | guaranteed order (code: TRUE); FALSE is a variant | `sasl_auth.c:933,941`, D5 |
| `AliasReauth` | an alias device may re-authenticate on its own | allowed by the code (TRUE); FALSE is a restriction | `m_authenticate.c:154-186`, `bouncer_session.c:12293`, D5 |
| `SessLogout` | a session face may be logged out (deauth) during a split | allowed | `sasl_webhook.c:186-219`, D4 |
| `Joins` | P may PART and JOIN | allowed | EJ:20-37, D2 |
| `LossAtSplit` | a split may cut lines still in flight | allowed (code: TRUE); FALSE (split only with empty links) is a restriction | D7 |
| `PromoteNotify` | the split promote tells observers when the promoted device's account differs from the face they were shown | FALSE is the code (`bouncer_session.c:8617-8619`); TRUE is a candidate change, not the code | D7 |
| `BxcName` | a merge's `BX C` carries the session record's name (`"session"`) or the device's account (`"device"`) | `"session"` is the code (`bouncer_session.c:10397`, `:14518`); `"device"` is a restriction | D8 |
| One channel; every user and both observers are in it | fixed | restriction | D2 |
| Two servers, one link, at most `MaxSplits` splits | fixed | restriction | D6 |
| Observers negotiated `account-notify`, `extended-join`, `account-tag` | fixed | restriction | D1 |
| Nick changes are not modelled | fixed | restriction | D9 |
| Session faces log out only during a split | fixed | restriction | D4 |
| Two devices, one per server; no held ghost | fixed | restriction | D6 |
| Each P10 line is processed atomically, in order (TCP) | fixed | guaranteed | D7 |
| Same-nick convergence is one shared verdict per heal | fixed | restriction (abstracts `bounce_nick_verdict`'s inputs) | D8 |

## D1. What an observer is told, and the view it keeps (AN, EJ, AT)

AN:19-21: with `account-notify`, clients "get the ACCOUNT message to designate the account name
changes for clients on common channels with them, including themselves." AN:25-35: `ACCOUNT
<name>` is a login, `ACCOUNT *` a logout. EJ:20-37: with `extended-join`, a JOIN carries the
account name, or `*`. AN:42-59 tells a client to keep a cache from these two and update it on
each ACCOUNT. AT:19-21: the `account` tag "contain[s] the sender's current services username",
and MUST NOT be sent when the user is not identified.

**Reading.** An observer's view of a user is the value of the last JOIN, ACCOUNT or QUIT it
received for that nick. The spec's own example (AT:30-36) shows the tag following the ACCOUNT
lines in the same stream: after `ACCOUNT bob`, the tag is `bob`.

**Model.** One observer per server, `oA` and `oB`, with all three caps. `view[o][nick]` is an
account, `*`, or `gone` (QUIT, PART, or never joined). Delivery from a server to its own client
is immediate and in order (the observer's socket), so the view changes in the step that sends.

**Errata AN:63-66.** The spec once told clients to send WHO after a netsplit, and withdrew it:
"deemed unnecessary". So a client may rely on the server's lines alone across a split and a
heal. That is what makes convergence (P2) the server's job, not the client's.

**Self (fixed, outside the model).** AN:20-21 and AN:68-69 include the user's own changes. The
code passes the changed client as the `one` to skip in every account-notify send
(`sasl_auth.c:936-938`, `m_account.c:209`, `:325`, `sasl_webhook.c:203`), and in
`sendcmdto_common_channels_capab_butone` the client itself is sent to only when `from != one`
(`send.c`, the function at 2935, its tail). The model's observers are other clients, so this is
not checked; the user is told by 900 (`sasl_auth.c`, step 2) on the SASL path.

## D2. Where account-bearing lines come from (code)

- **Login, re-authentication (post-registration SASL).** `sasl_auth.c:894-944` (step 7): set the
  account, `bounce_emit_alias_update` (933), `ACCOUNT` to common channels (936), then the
  `AC R|M` broadcast (941). A re-authentication with a registered account is allowed only by
  OAUTHBEARER, which may change the account name (`m_authenticate.c:154-186`).
- **Logout.** The Keycloak webhook's `deauth_client` (`sasl_webhook.c:186-219`): `ACCOUNT *` to
  common channels, `AC <user> U` to every server. Services send `AC U` too.
- **Receipt.** `ms_account` (`m_account.c:147`): an `AC` for an unknown numeric is ignored
  (189-190: "probably crossed"); otherwise the copy is set and `ACCOUNT` goes to the local
  common channels (209 for U, 325 for R/M), then the line is relayed onward (342-351).
- **Join.** `channel.c:5856-5859`: the extended JOIN carries `cli_account` of the joiner at the
  server that sends it, or `*`.
- **Burst.** `m_burst.c:973-987`: a burst member who is not yet a member here is added and a JOIN
  goes to local members with the account the N line gave (`m_nick.c:518-560` reads `+r
  account[:ts[:id]]`). A member already present gets no JOIN (973).
- **Tag.** `send.c:604-608` (and 952, 1062, 1157, 1256): the tag is
  `cli_user(from)->account` **on the server that delivers the line**, for the `from` it delivers
  as. Account tags are not carried between servers.

**Model.** `acc[v][c]` is server v's copy of client c's account; `acc[Home(c)][c]` is the
truth. Every line above is a model line (`AC`, `BXU`, `N`, `J`, `MSG`, `BXC`, `KILL`), sent on a
FIFO link. `Joins` (allowed) lets P part and join, each sending a `J` line.

## D3. Where a plain user's account changes (`RemoteOrigin`)

A local SASL login changes the account at the user's own server. Services (X3) send `AC` to
their uplink, which applies it to its copy and relays it toward the user (`m_account.c:187-351`
does the same for any `AC` whatever its origin). With services on B, B's copy of P changes
before A's truth.

**Model.** `RemoteOrigin` lets a change of P start at B, while B has a copy of P. It is the only
way the model can make a remote copy run ahead of the truth.

## D4. Session account changes (`SessSwitch`, `SessLogout`)

The session's primary re-authenticates like any client (D2). `SessSwitch` lets it switch to the
other account name, as the spec's example does (AT:35). A session's record is filed under the
name it was created with (`bouncer_session.c:1964`, set only at create, and at restore/transfer
`5872`, `7645`); a re-authentication does not refile it.

A logout destroys every session of the account on that server (`bounce_account_deauth_apply`,
`bouncer_session.c:12101-12151`) and leaves the connection outside any session.

**Restriction.** A session face logs out only during a split (`SessLogout`). A linked deauth of a
session with a device across the link involves the alias-exit cascade (#12 of the skill,
`bouncer_session.c:12138-12151`), which is out of this model.

## D5. Aliases follow the primary (`AliasFirst`, `AliasReauth`)

`bounce_emit_alias_update` (`bouncer_session.c:12287-12330`) gives this server's copy of every
alias the new account directly (12313-12315) and sends `BX U <alias> :account=<name>` to the
other servers; the receiver applies it only to a client that is an alias (`bounce_alias_update`,
around 15328). In step 7 it runs before the `AC` broadcast (`sasl_auth.c:933` before `941`), so
on the wire `BX U` precedes `AC`: `AliasFirst` is the code; FALSE is checked as a variant.

The function returns at once for a client that is itself an alias (12293:
`if (!IsAccount(primary) || IsBouncerAlias(primary)) return;`). An alias device that
re-authenticates (OAUTHBEARER is not refused for one, `m_authenticate.c:154-186`) changes its
own account only; its `ACCOUNT` goes to the channels it is a member of, which are its primary's
(the mirror rule, skill #17), under the session's nick; its `AC` reaches the peer, whose copy of
the alias is a member there too and gets the same `ACCOUNT` (`m_account.c:325`).

**Model.** `AliasReauth` (TRUE = the code) lets the alias device do that. The message source of
an alias is rewritten to its primary (`ircd_relay.c:648-651`, `:913-918`), so the tag on its
messages comes from the delivering server's copy of the primary (D2, Tag).

## D6. The session across a split (code)

A session has one primary (the face, holding the nick, introduced by `N`) and aliases (each its
own Client, introduced by `BX C`, not visible as separate users). At a split
(`s_misc.c:1083-1104`), `bounce_prepare_squit_promotions` (`bouncer_session.c:8820-8902`) drops
the aliases behind the departing server; when the primary leaves with the split and an alias
survives, `bounce_execute_squit_promotions` (8912) promotes it (`bounce_promote_alias`, 8413):
it takes the nick in place, sends `BX P`, and the old primary is removed from channels silently
(8673-8676). The promoted face sends no line to observers: "no line, no aggregation (no
recompute at a promote ...)" (8617-8619). Other remote users leave with a netsplit QUIT
(`s_misc.c:1051`).

**Model.** Two devices: `dA` (home A) and `dB` (home B), one the face, the other an alias
(`InitPrim`). At a split each server keeps or promotes its own device. With no device of its
own it QUITs the nick. Held ghosts, three or more devices and a second session are out
(restriction).

## D7. What a split cuts (`LossAtSplit`, `PromoteNotify`)

A split closes the TCP link: what a server has not read is gone. A server processes one line at
a time (`parse_server`), so a split can fall between `BX U` and the `AC` that follows it.

**Model.** `LossAtSplit` (TRUE = what TCP permits) lets a split drop whatever is in flight.
Each P10 line is one atomic receive step. FALSE allows a split only when both directions are
empty (restriction). `PromoteNotify` is a candidate change, not the code: at the promote, an
`ACCOUNT` goes to the local channels when the promoted device's account differs from the copy of
the old face's.

## D8. Same-nick meetings at the burst (code, abstracted)

After a heal each server bursts its users by `N`, with the account (`+r`). Two faces of nick S
meet. `m_nick.c:655-658`: the same-nick convergence (D.2) applies only when the incoming `N`'s
account equals **our client's current** account (`cli_user(acptr)->account`), both are logged
in, and the peer is IRCv3-aware; the verdict (`bounce_nick_verdict`) is computed by both servers
from the same facts, so one keeps when the other yields. A merge either refuses the incoming `N`
silently (we keep) or demotes our face to an alias of the incoming one, with no QUIT and no
JOIN, and tells the links by `BX C` carrying `session->hs_account`
(`bouncer_session.c:10361-10397`); the receiver sets the alias's account from that field
(`:14518`, `:14561`). Otherwise the classic rules apply (`m_nick.c:1068-1135`): by nick TS one
side or both are killed, the loser locally and by `KILL` on the wire.

**Model.** The verdict's static inputs (nick TS, numerics, session ids) are one choice made at
the heal, `win.merge` and `win.classic`, read by both servers alike: that is the code's
contract. The dynamic inputs are read as the code reads them: the incoming side from the `N`
(the snapshot at the burst), our side from our client now. `BxcName` picks what the `BX C` of a
demote carries.

## D9. Nick changes (restriction)

`NICK` carries no account, and the account stays on the client across a rename. A client that
follows NICK keeps its cache keyed by the client. So the model keys views by client identity
(nick `P` for P, nick `S` for the session face) and leaves NICK out. Nick collisions at the
burst are D8's.

## Properties (decided before the model)

| Id | Name | Statement | Kind | Basis |
| --- | --- | --- | --- | --- |
| P1 | `ViewMatchesServer` | always: each observer's view of each nick equals what its own server holds (the account of the face it shows, of P if P is in the channel there, else gone) | guaranteed reading | AN:19-21, EJ:20-37: every change of what a server shows is announced to its clients on common channels |
| P2 | `ViewConverges` | at quiescence (link up, nothing in flight): each view equals the truth at the user's own server | guaranteed reading | AN:63-66 (no WHO after a netsplit); the burst's JOIN (EJ) |
| P3 | `TagAgreesView` | every message an observer receives is tagged with exactly its current view of the sender (no tag iff `*`) | guaranteed reading | AT:19-21, AT:30-36 |
| P4 | `TagAtSendPlain` | a message from a plain user is tagged with the account it had at its own server when it sent | guaranteed reading (FIFO, D2) | AT:19-21 "current" |
| P5 | `TagAtSend` | as P4, for a session device too | not guaranteed: AT:19-21 says "current", and the code stamps from the delivering server's copy of the primary (D2, D5); a witness | AT:19-21 |
| P6 | `AliasesAgree` | at quiescence: every live device of the session, and every server's copy of it, has the face's account | guaranteed reading | skill #12, `bounce_emit_alias_update` |
| P7 | `CopiesAgree` | at quiescence: every server's copy of a live client equals its truth | guaranteed reading | D2 |
| P8 | `OneFace` | at quiescence: both servers show the same live face (or none), every live device is its server's face or an alias of a session face there, and no copy names a dead client | guaranteed reading | skill "Burst & Convergence", D8 |
| P9 | `NoStaleAfterSplitLogout` | is P2 for P after a logout during a split; covered by P2 and its cover `CoverSplitLogoutHealed` | guaranteed | AN:25-35, AN:63-66 |

P1 and P2 together say: the view is what the server holds, and what the servers hold converges.

**Covers** (each must be violated in some passing config): a SQUIT promote; a D.2 merge; a
classic kill; P logged out during a split, then healed and quiescent with oB told `*`; a message
from an alias device delivered; a session account change that crossed the link with a remote
alias.

**Mutants** (each must be caught by the property named): see `DESIGN.md`.
