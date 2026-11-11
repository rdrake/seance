# nefarious2 and Seance against the spec model (trace validation and refinement)

2026-11-10. Spec model v7 (D22-D25). Nothing here has been filed anywhere.

> **Hold (Richard, 2026-11-10):** nothing goes to evilnet/nefarious2 until each finding is
> confirmed. Confirmed means a direct reproduction, not the trace check alone (SPEC-REVIEW-8).

Two builds are covered: the September `ircv3-fixed` image (first section) and HEAD a5911f29
on MrLenin's testnet (second section, September vs HEAD).

## nefarious2, live, with services linked

- **Server:** Docker image `nefarious2:ircv3-fixed`, built 2026-09-09 from `ircv3.2-upgrade`.
  That is older than the checked-out HEAD (ce441a04, 2026-11-04), which has several SASL
  commits since (registration resume after an abort or a services split, among others).
  These traces describe the September build; code references below are to HEAD.
- **Config:** `conformance/results/nefspec-local.conf`: a server port for one linked server,
  `svc.example.net` (U:lined), with `SASL_SERVER = svc.example.net`,
  `SASL_DEFAULT_MECHANISMS = PLAIN` and `SASL_TIMEOUT = 2`.
- **Services:** fake P10 services (`conformance/drive.py`, class `Services`) answer SASL
  PLAIN like X3.
  - With services-based SASL at HEAD, the mechanism list can only come from
    `SASL_DEFAULT_MECHANISMS`. Services never set it over P10; only IAuth does
    (`set_sasl_mechanisms`, ircd.c:216). So this configuration is the production one.
- **Schedules:** `drive.py --services --settle 2.5`:
  - the 105 Ergo schedules;
  - 24 that drop the services link during the handshake: after LS, after the ACK, and between
    `AUTHENTICATE +` and the response;
  - 4 that drop it before the client connects.
- **What check.py enforces:** each drop trace records where the link went (`dropAt`, among
  the lines read). check.py then requires sasl to be withdrawn (`MaxEnv` 1) before any later
  server line. A server that sends no DEL diverges right at the drop.
  - The first pass recorded no drop point. Its 18 non-midexchange drop runs "matched" only
    because v7 could read their 904 as a timeout with services up, so they are not counted
    as matches.

| Pass | Plain (105) | Drop during the handshake (24) | Drop before connecting (4) |
| --- | --- | --- | --- |
| model v6 | 0 match (D22) | 0 | - |
| model v7, no drop point | 105 match | 18 "match" (not meaningful, see above), 6 diverge | - |
| **model v7, drop point enforced** | **105 match** | 0 match, **inconclusive**: all 24 diverge at the drop, but the check is not evidence (SPEC-REVIEW-8) | 0 match, inconclusive: the client side, after the LS |

### What the runs show

- **N1. An unprompted 906 when services are lost during an exchange, then a 904 for the
  late response.**
  - Wire: `AUTHENTICATE +`, `906 :SASL authentication aborted`, then
    `904 :SASL authentication failed: service unavailable` (the client's response, read as
    a new opener, D24), then 001.
  - The client never sent `*`. At HEAD this is the services-exit path, list.c:530-560 with
    `abort_sasl`.
  - Spec: 906 "is sent when the SASL authentication is aborted because the client sent an
    AUTHENTICATE command with `*`" (S1:223, descriptive). Nothing forbids it otherwise.
  - **Class (c):** the spec is silent on a server-side abort. Our model's server ends a
    failed exchange with 904 (`SrvSaslTimeout`), as S1:46-47 does for a failed agent
    association. A client that treats any terminal numeric as the end of its exchange (D12)
    is unaffected.
- **N2. No CAP DEL sasl for clients that are still registering.**
  - When the services link goes, `send_cap_notify` (m_cap.c:292-322) sends DEL only to
    `IsUser` clients, and `cap_notify_flush` (m_cap.c:200) does the same, so a registering
    client hears nothing.
  - A client that connects after the drop does not see sasl in LS (`*/after+drop-beforeConnect`:
    `LS a cap-notify`). `sasl_server_available()` checks the SASL server link (m_cap.c:264-275).
    So the gap is only the DEL to clients that were already negotiating.
  - Spec: cap-notify is enabled by `CAP LS 302`, and "the server MUST notify the client
    about ... existing capabilities that are no longer available" (CN:491-493).
  - **Class (a):** the same gap as Ergo item 1. The evidence is the code reading above and the
    fact that no run, here or at HEAD, ever shows a DEL to a registering client.
  - The drop-run divergences are **not** independent evidence (SPEC-REVIEW-8):
    - check.py's `dropAt` constraint puts a deadline of the next server line on sasl's
      withdrawal;
    - it counts on a different clock from the recording;
    - it does not record when the server detected the drop, and the text sets no deadline.
    So a divergence at k+1 does not show a violation. A fair check needs a recorded drop event,
    server detection, and an eventual-notification obligation. Until then, the drop-run
    verdicts are inconclusive.
- **N3. A REQ for sasl is ACKed while services are down.** This is a stronger form of F4
  (`CODE-FINDINGS.md`).
  - Wire: after the drop, `CAP REQ :sasl` gets `ACK sasl`, and the opener gets
    `904 :...service unavailable`.
  - It also happens when sasl was never listed: a client that connects after the drop sees no
    sasl in LS, REQs it anyway (outside the model client, so the trace stops on the client
    side), and gets `ACK sasl` (`*/after+drop-beforeConnect`). That is F4 seen live.
  - At HEAD, `sasl_server_available()` is consulted only for LS (m_cap.c:578, `is_ls`), not
    for REQ.
  - S2-2: a REQ for sasl while the backend is unavailable MUST be NAKed.
  - **Class (a).** It is recorded only; F4 stays unfiled.
- **N4. A late `*` after a completed login gets nothing.**
  - At HEAD (m_authenticate.c:127-150), `*` aborts only when an exchange is running, and
    otherwise returns silently. Every other AUTHENTICATE line after a login gets 907
    (m_authenticate.c:162-173).
  - D21 reads S1:81-82 ("the AUTHENTICATE command") as covering `*` too. Codex judged that
    defensible but not the only reading (SPEC-REVIEW-6).
  - **Class (c)**, reading-dependent. Not seen live: in every live run the `*` reached the
    server before the services decided, so it got 906.

- **N5. CAP END during an exchange holds registration until the exchange ends.** No 906 is sent.
  - S1:84-87: "If the client completes registration ... while the SASL authentication is
    still in progress, the server SHOULD abort it and send a 906 numeric, then register the
    client without an account" (S1-14, SHOULD).
  - nefarious2 holds registration while an exchange is open and registers when it finishes
    (with the account) or times out. This is deliberate: Seance's code model checks it as
    `NoRegisterDuringSasl`.
  - irctest's `testRegistrationDuringSasl`, whose client never sends a response, got no 001
    before it gave up.
  - **Class (b)**, against a SHOULD. The model accepts it because `AbortOnReg = FALSE`.
  - Ergo goes against the same SHOULD the other way: it registers at once (001) and lets the
    exchange finish after it (ERGO.md).

### Choices among the spec's options (matching Ergo where both were exercised)

- LS is two lines, with the modelled caps all on the first line (D22).
- One ACK line per REQ, in order.
- 900 and 903 are adjacent, with 900 first.
- A mid-exchange `*` gets 906, and a new opener gets a fresh `AUTHENTICATE +`.
- CAP END during an exchange: registration waits until the exchange ends (`*/good/midexchange`:
  AUTH+, 900, 903, 001; `*/bad/midexchange`: AUTH+, 904, 001). See N5.

## nefarious2 HEAD (a5911f29) on MrLenin's testnet: September vs HEAD

- **Server:** the testnet's `nefarious` submodule at a5911f29 (2026-11-10), built by the
  testnet's compose file. The testnet uses real X3 and Keycloak. SASL is `SASL_LOCAL`:
  nefarious2 asks Keycloak directly (libkc, `/realms/testnet/protocol/openid-connect/token`), so
  X3 is not on the SASL path.
- **Account:** `testuser`, created in Keycloak by hand (see the testnet bugs below).
- **Drops:** `drive.py --svc-down "docker stop keycloak" --svc-up "docker start keycloak"`. The
  same 133 schedules as September: 105 plain, 24 during the handshake, 4 before connecting.
- **Checked:** on gpu05 (job 10063, `hpc/tlc-traces.sbatch`) against v7, with drop points
  enforced. Traces: `conformance/results/testnet-a5911f29.jsonl`.

| Run | Plain (105) | Drop during the handshake (24) | Drop before connecting (4) |
| --- | --- | --- | --- |
| September (`ircv3-fixed`, P10 services) | 105 match | 0 match | 0 match |
| **HEAD a5911f29 (Keycloak)** | **104 match**, 1 harness artefact (a 433 nick clash with a leftover connection) | 0 match, **inconclusive** (SPEC-REVIEW-8): in most runs the server had not yet detected the loss | 0 match, inconclusive: LS still lists sasl before detection |

N2 and N3 are confirmed by the direct reproductions below, not by these rows.

### Direct reproductions at HEAD (2026-11-10, after the hold)

These are run by `conformance/repro_testnet.py`. The evidence is in
`results/repro-a5911f29-wire.log` (every line with its UTC receive time) and
`results/repro-a5911f29-server.log`.

The harness clock plays no part:
- the server's own log line fixes the moment it detected the loss;
- Keycloak was stopped with `docker stop`;
- client B's login then forced a token request.

The detection line:

```
[2026-11-10 19:59:46] SASL LOCAL: Keycloak became unreachable (result -1) — removing SASL
```

The clients:
- **A** sent `CAP LS 302`, NICK and USER, but never END, so it was still registering. Under 302,
  cap-notify "MUST be implicitly enabled" (CN:475-476).
- **R** sent `CAP REQ :cap-notify` and END, and was registered (001).
- **C** connected after detection.
- **D** sent a plain `CAP LS`.

**N2: confirmed.**
- R got `CAP reproR DEL :sasl` at 19:59:46.229, the same second as the log line.
- A got nothing after `19:59:45.371 NOTICE * :*** Couldn't look up your hostname` until the run
  ended at 20:00:00. It had been listed `sasl=PLAIN,OAUTHBEARER` at 19:59:45.353.
- The server knew, notified registered clients, and left the registering 302 client believing
  sasl was available.

**N3: confirmed, for a client that connects after detection.**
- C's LS at 19:59:49.298 correctly omits sasl.
- C then sent `CAP REQ :sasl` and got `CAP reproC ACK :sasl` (19:59:50.407): an ACK for a
  capability the server neither listed nor can serve. S2-2 says it MUST be NAKed.
- Client B's ACK (19:59:45.984) came before detection, while sasl was still listed, so it is
  not a deviation.

**N6: confirmed.**
- A plain `CAP LS` got two lines, both without the `*` continuation marker:
  - `CAP * LS :account-notify ... setname`, 507 bytes;
  - `CAP * LS : soju.im/search standard-replies userhost-in-names`, whose list starts with a
    space.
- A pre-302 client reads the first line as the complete list. Class (c), as above.

### N1-N5 at HEAD

- **N1** (an unprompted 906 when services are lost) is **not seen**. Every 906 at HEAD follows
  the client's `*`. On the Keycloak path, a lost backend shows up as a 904, a login that still
  succeeds, or no answer within the run.
- **N2** (no CAP DEL to registering clients) **still holds**. There is no DEL in any of the 133
  runs. The drop-run divergences in the table above are inconclusive (SPEC-REVIEW-8); the
  evidence is the code reading and the missing DEL.
  - At HEAD, nefarious2 learns that Keycloak is gone only when a token request fails:
    `SASL LOCAL: Keycloak became unreachable ... removing SASL`, and `sasl_mark_unhealthy`
    sends CAP DEL to `IsUser` clients only.
  - A health probe brings sasl back, with `Keycloak is now reachable`.
- **N3** (sasl ACKed while services are down) **still holds, in a new form**. Because
  detection is lazy, a client that connects just after Keycloak stops still sees sasl in LS,
  REQs it and gets ACK (`*/after+drop-beforeConnect`).
  - The first exchange then fails, with a 904 or no answer, and that failure is what removes
    sasl.
  - Several runs even log in (900, 903) after `docker stop keycloak`. The server answered
    without a working token endpoint, which looks like a cached result. This is not checked
    further, since the spec has nothing to say about it.
- **N4** (a late `*` after login gets nothing) is **now seen live**. In
  `*/abort-late.good/after` at HEAD, the data reaches Keycloak and is answered before the `*`
  is read. The output is 900, 903, then nothing for the `*`, then 001.
  - In September the `*` always arrived first, giving 906.
  - Class (c) as before. All 6 `abort-late.good/after` traces match v7 only with
    `Reauth = TRUE` (summary of job 10063).
- **N5** (CAP END mid-exchange holds registration) **is unchanged**: `*/good/midexchange` gives
  AUTH+, 900, 903, 001.

### Other differences from September (58 of 133 runs)

- **Timing, not semantics, for most of them.** The local Keycloak path answers faster than
  September's P10 relay. So:
  - `abort-early` now gets `AUTHENTICATE +` before its 906;
  - `abort-late` now logs in before the `*` (N4).
- **Pipelined REQ, END, REQ: HEAD suspends registration again (class (d), conforming).**
  - The schedule sends `CAP REQ`, `CAP END`, `CAP REQ` in one flush. At HEAD, registration
    is still waiting on the hostname lookup when the second REQ arrives, so nefarious2
    suspends registration until another END. None comes, so there is no 001 in the run.
  - CN:355 makes that a MUST: a REQ while registration is in progress suspends it.
  - September registered at once on the END and then ACKed the REQ, which also conforms,
    since registration had completed.
  - **For clients:** any CAP REQ sent after END but before 001 needs another END. That
    includes a late REQ and one triggered by `CAP NEW`. Seance's rule "nothing but
    registration before 001" covers this if it holds. It has not been checked against Seance
    here.
- **Persistence attaches the login to an existing session.** After SASL, 001 is addressed to
  the account's persisted nick (`t00001`), not the nick the connection registered with
  (`t00012`), followed by `NICK t00001`. This is draft/persistence, outside the handshake model.

### A new finding at HEAD: multi-line LS to a pre-302 client

- **N6. `CAP LS` with no version gets two LS lines, both final.** There is no `*` continuation
  marker on the first, and the second's list starts with a space (`CAP * LS : soju.im/search
  standard-replies userhost-in-names`).
  - The cap list has grown past one line. In September it fit on one line, so this is new.
  - Spec: "If the client supports CAP version 302, the server MAY send multiple lines"
    (CN:282). The `*` format is defined for 302 clients only (CN:285-288). Nothing says what a
    server does for a pre-302 client whose list does not fit.
  - **Class (c)**, outside the spec model, which covers `CAP LS 302` only.
  - Effect: irctest's pre-302 cases (`testReqOne`, `testReqTwo`, `testNoReq` and four
    others) read the first line as the whole list and fail on the second.
  - The leading space gives a strict parser an empty cap name. That is (d) at most, but worth a
    note.

### irctest against HEAD

`testnet_controller.py` creates each irctest account in Keycloak. Overall: 15 failed, 34
passed, against September's 6 failed, 41 passed. Two September failures now pass
(`testNoPassword`, `testPassAfterNickuser`). The 11 new failures are:
- the 7 pre-302 CAP cases (N6);
- 2 caused by the testnet itself: a CTCP `VERSION` PRIVMSG from the server arrives before
  001 (`testEarlyNickCollision`, `testPassBeforeNickuser`; it also gets in the way of the 001
  waits in other cases);
- `testPlainInfiniteMessages`, which hit an irctest bug
  (`'SaslTestCase' object has no attribute 'fail'`);
- `testPlainPostRegistrationAndReAuthenticate`.

The 9 traces in the model's scope (`CAP LS 302`) give the same result as September: 4 match
and 5 diverge on the client side, where irctest sends lines the model client does not.

### Testnet bugs found while bringing it up (worked around in scratch files, nothing committed)

1. `scripts/setup-keycloak.sh` (commit f66659a) adds an LDAP user federation for host
   `openldap`, but `docker-compose.yml` defines no openldap service.
   - Creating the test user fails (`Could not create user`), so testuser never exists.
   - nefarious then gets HTTP 500 from the token endpoint and removes SASL.
   - Worked around by deleting the federation in a throwaway Keycloak (H2) and creating
     testuser by hand.
2. nefarious HEAD rejects `websocket = auto` in the testnet's ircd config. It wants
   `autodetect`.
3. The compose file passes an empty `KC_DB_URL`, which breaks Keycloak's datasource.
4. X3's entrypoint `cp`s its config and then runs `sed -i` on it. That fails on a bind-mounted
   file, and it also overwrote `data/x3.conf` in the testnet checkout.

## irctest (CAP, SASL and registration cases) through the harness

`irctest` 13069d8, run from a scratch copy with a recording plugin (`irc_recorder.py`).
`conformance/irctest_traces.py` keeps a connection only when the irctest client stayed
within the model client, and counts the reasons for the rest.

- **Ergo:** 56 tests; all pass once the scratch copy's Ergo `registerUser` stops waiting for
  a close after QUIT (local only). That gives 98 connections, 47 of them in scope.
  - 42 match.
  - The other 5 stop on the client side: AUTHENTICATE without the cap (S1-1), and
    authentication or reauthentication after registration, which belongs to the wider-SASL
    model.
  - No server-side divergence.
  - Out of scope: 15 connections never send CAP, 15 REQ "blindly" without LS (CN:65,
    allowed by the spec but not by the model client), 9 send a version-less `CAP LS`, 5 use
    chunked or multi-step SASL, and 6 have other reasons.
- **nefarious2** (September build, `services_daemon.py` linked, `nefspec_controller.py`):
  - 56 tests: 41 passed, 6 failed, 5 skipped, and 4 xfail or xpass.
  - Four failures are irctest assumptions: the server name `My.Little.Server`, and the three
    password tests, which expect a PASS-protected listener this config does not have.
  - `testRegistrationDuringSasl` fails on an irctest bug (`self.fail` does not exist) after
    the N5 hold.
  - `testSaslTooLong` sends a 513-byte line. nefarious2 closes the link ("Excess Flood:
    message region too large") and sends a 906 first, where irctest expects 905 or 417. The
    line breaks the 512-byte limit before SASL comes into it. The 906 on the way out belongs
    to N1's family.
  - 59 connections, 9 in scope (Ergo's 47 were mostly its own registration helper): 4 match.
    The other 5 stop on the client side, the same as on Ergo. No server-side divergence.

## Seance: its code model against the spec model

- **Input:** Seance `test/formal/handshake/Handshake.tla` (seance-fix-review, 852e46795),
  whose server is nefarious2.
- **Traces:** every settled behaviour TLC prints with `MBT.cfg`'s Dump. That is exhaustive
  for Order = <<x, y, sasl>> and MaxCookie 3: 297,006 distinct states and 1,266 distinct
  wire traces once eager-client worlds are dropped (`conformance/handshake_traces.py`).
- **Check:** each trace goes through `check.py`. This is wire-trace inclusion, not a state
  refinement mapping: one Handshake step emits several lines that the spec model emits in
  several steps.

| Model | Matched | Diverged | Causes |
| --- | --- | --- | --- |
| v6 | 906 | 360 | D23 (144), D24 (144), N1 (72) |
| v7 | **1194** | **72** | N1 only (services lost: unprompted 906) |

### Results

- **Seance's client:**
  - It never fails to make its move. In every trace the frontier is on the server side.
  - The 72 v7 divergences stop at the server's 906, so the Seance lines after it are not
    checked in those traces. The same Seance client behaviour after a 904 is checked in the
    traces that match.
- **Reauth:**
  - 36 traces match only with `Reauth = TRUE`. In them, Seance's 12 s timer sends `*` after
    the login has already succeeded, and the code model's server stays silent.
  - That is N4. With `Reauth = FALSE`, D21 wants 907. The code model and the HEAD code agree
    with each other, so it is N4 rather than a modelling error.
- **Scope:**
  - This covers Seance against the nefarious2 model only, with single-line LS and no
    NEW/DEL.
  - It says nothing about Seance against split ACKs, reordered replies, NEW/DEL or 900 and
    903 that are not adjacent.
  - That needs the composition check: the spec's server with Seance's client actions, and
    the spec's client rules plus `CapsAgree`, `AccountAgrees` and `Terminates`. It is
    planned.

## Files

- `conformance/drive.py` (with `--services`), `conformance/check.py` (frontier diagnosis,
  per-Reauth counts, unpinned env, `nread`)
- `conformance/irctest_traces.py`, `conformance/handshake_traces.py`,
  `conformance/services_daemon.py`
- `conformance/irc_recorder.py`, `conformance/nefspec_controller.py` (irctest plugin and controller)
- `conformance/results/`: `nefarious-svc-ircv3fixed.jsonl`, `nefspec-local.conf`,
  `irctest-ergo-recordings.jsonl` and `irctest-ergo-traces.jsonl`,
  `seance-handshake-raw.jsonl` and `seance-handshake-traces.jsonl`, and `v7-*.summary.json`
  (per-run verdicts and frontiers).
