# Textual-NG handshake traces

Textual-NG is checked out at `~/workspace/afternet/Textual-NG`. It is Richard's fork `rdrake/Textual-NG`, master **8debe5afddd34d0675dce0c805ffff5fc64fd7b7**, up to date with origin.
The traces are in `conformance/results/textual-8debe5a.jsonl`: 60 runs, one per scenario, the same 60 as HexDroid.
TLC has not been run on them. The model check decides; everything below marked *candidate* is unverified.

## How it is driven

- **Client.** TextualCore's real `Client` actor runs in-process: `Client.swift`, `Client+Negotiation.swift`, and `CapabilityRegistry` + `SASLCapability` for CAP/SASL. It is the same code the app runs, without the app.
  - The driver is a Swift Testing test, `~/workspace/afternet/Textual-NG/TextualCore/Tests/TextualCoreTests/ConformanceClient/SpecHandshakeTraceTests.swift`. It is uncommitted and is the only file added to that tree. `Package.swift`, the existing tests, transcripts and goldens are untouched.
  - Its construction is copied from the package's own `irc-conformance-client` executable (`Sources/irc-conformance-client/ConformanceClientRunner.swift`): an in-memory GRDB `MessageStore`, credentials passed directly in `ClientIdentity`, and `floodControlMaximumMessages = 1_000_000`.
  - Nothing touches the keychain, the app's settings or a real host.
  - The test reads a plan file named by `TEXTUAL_SPEC_PLAN`, and is disabled when that is unset. It connects one `Client` per plan line, in order, and waits for the server to close each connection. It watches `SocketTransport.inboundTee`, which finishes on EOF, with a 180 s cap. Then it calls `disconnect()` (which sends no QUIT) and closes the transport.
  - Each client uses nick `txNNN`, username `u`, realname `spec`, and `autoReconnect = false`. SASL is PLAIN with authcid `tester` and password `goodpass`, `wrongpass` or none. With SASL off, the mechanism list is empty.
  - **No password.** The test mirrors what `ClientIdentityResolver` (`ClientIdentityResolver.swift:85-118`) makes of "PLAIN configured, secret missing": the negotiated `saslMechanismPreference` is pruned to `[]` and `requestedSASLMechanisms` keeps `[PLAIN]`.
- **Transport.** The transport is `ScenarioKit.SocketTransport`, the harness transport used by `irc-e2e` and `irc-conformance-client`, not the app's production `NetworkTransport`. It speaks plain TCP to `127.0.0.1:<port>` only, and above it the bytes go through the same `Client` framer and dispatch.
- **Server.** The server is `conformance/spec_server.py`, unchanged in behaviour (see HEXDROID.md § How it is driven). It has a new `--client hexdroid|textual` switch, with hexdroid as the default. In textual mode:
  - it writes the same plan format;
  - it runs `swift test --filter SpecHandshakeTraceTests` in `TextualCore/`;
  - it never wraps the socket in TLS;
  - it names the extra trace key `textual` instead of `hexdroid`.

  Scenarios, pacing (`QUIET` 0.3 s, `AFTER_REG` 1 s, `STALL` 8 s) and the trace format are identical. `--list` gives the same 60 names, in the same order.
- **Why `r` is the number of lines read.** The inbound consumer (`Client.swift`, `startConsumers`) awaits `handleInbound` for each chunk, and each line is handled in order.
  - CAP and SASL replies go out through `await sendRawInternal` inside that handler, before the next line is read. That calls `transmitLine` (`Client+FloodControl.swift:233-238`), which enqueues the line and then awaits `drainFloodControl`. The drain does `await transport.send` inline (`:289-313`).
  - Before 001 the flood window is not enforced: `nextLine(enforcing: isRegistrationComplete)` (`:112-121`). So nothing is deferred past the 0.3 s quiet window.
  - The lift to 1,000,000 messages, copied from `irc-conformance-client`, is belt and braces. The defaults are 6 messages per 2 s (`IRCConnectionConfig.swift:145-148`).
- **A departure from the suite's own layering.** The scenario-suite design (`docs/superpowers/specs/2026-06-01-scenario-test-suite-design.md` §3) keeps real socket I/O in executable targets (`irc-e2e`) and the test target offline.
  - This test opens a loopback socket from the test target. The alternative, a new executable target, would have meant editing the tracked `Package.swift`.
  - It is disabled unless `TEXTUAL_SPEC_PLAN` is set. Checked: `swift test --filter SpecHandshakeTraceTests` without it reports `runPlan() skipped`. So a normal `swift test` stays offline.
  - Nothing in `Tests/TextualCoreTests/Scenarios/CLAUDE.md` is touched; its rules are about goldens.
- **Trace format.** As HEXDROID.md. The extra key is `textual: {stalled, notes, tls}`, and `tls` is always false. check.py ignores it.

**Departure from HexDroid: no TLS.** `SocketTransport` cannot do TLS, and Textual-NG does not need it: `SASLCapability.startPlain` has no TLS gate, so PLAIN sends the password over plaintext. Every run is plaintext, so `sasl/plaintext-abort` loses its premise (see Substitutions).

## Rerun

On the Mac. It runs `swift test`, never TLC.

```sh
cd ~/workspace/afternet/seance/tmp/formal-spec/conformance
python3 spec_server.py results/textual-8debe5a.jsonl --client textual          # all 60, about 8 min (first build longer)
python3 spec_server.py /tmp/x.jsonl --client textual --grep del/ --stall 75    # subset
python3 spec_server.py --list                                                  # scenario names (same for both clients)
```

`--textual DIR` overrides the checkout (default `~/workspace/afternet/Textual-NG`). The `swift test` log goes to a temp directory, whose path is printed. To validate on the cluster, run `check.py results/textual-8debe5a.jsonl WORKDIR -j N`.

## Scenarios (60) and substitutions

The scenario list is HEXDROID.md § Scenarios, unchanged. The `client-nosasl` variants still REQ `sasl`, because the cap is catalogued `advertise: .always` (`CapabilityCatalog.swift:104`); `onEnabled` then finds no mechanism and sends no AUTHENTICATE. Several scenarios lose their premise with this client. They were kept under their names and recorded as they ran:

| Scenario | Premise (HexDroid) | What Textual-NG does instead |
| --- | --- | --- |
| `sasl/plaintext-abort` | Client refuses PLAIN over plaintext and sends `AUTHENTICATE *` | Sends the password; the wire is the same as `sasl/ok` (900/903). |
| `sasl/plaintext-abort-nopass`, `sasl/no-password` | Client opens PLAIN, then aborts for lack of a password | The mechanism is pruned before negotiation, so there is no AUTHENTICATE at all. It REQs and gets an ACK for `sasl`, then sends CAP END. `env.creds` is false. |
| `sasl/full-caps-two-reqs` | Two REQs, the second with no modelled cap | Textual REQs only the 21 caps it knows, which fit in one REQ. One REQ. |
| `req/full-caps-nak-second` | NAK of the second REQ mid-exchange | With only one REQ, the `nak` policy never fires; the wire is the same as `sasl/full-caps-two-reqs`. |
| `sasl/value-external`, `sasl/value-scram-904` | (HexDroid: no EXTERNAL; switches to SCRAM) | `SASLMechanismRotator.decide` skips any preferred mechanism missing from a non-empty advertised list (`SASLMechanismRotator.swift:153-160`, the sasl-3.2 availability check). With preference `[PLAIN]`, nothing remains, so `onEnabled` fails with no AUTHENTICATE and the client sends CAP END after the ACK. SCRAM is never tried, because it is not in the preference. |
| `req/split-sasl-last/001-between` | The client's early END lets 001 fall between the ACK parts | Textual does not END until every REQed cap is answered (`pending` is per name), so the server never registers between the parts. The wire is the same as `req/split-sasl-last`. |

## Candidate divergences

The model check decides. Rule IDs are from `RULES.md`. Wire excerpts drop `CAP LS 302`/NICK/USER/005/376 and the `:spec.example` prefix; `S` is the server, `C` the client.

### T1. SASL opened on the first part of a split ACK (CN-14, S1-1/D1, D15, D17). Safety

**Scenarios:** `req/split-sasl-first/stray-drop`, `req/split-sasl-first/stray-904`

```
S CAP tx043 LS :sasl=PLAIN server-time cap-notify message-tags echo-message
C CAP REQ :cap-notify echo-message message-tags sasl server-time
S CAP tx043 ACK :sasl
C AUTHENTICATE PLAIN
S CAP tx043 ACK :cap-notify echo-message message-tags server-time
   (stray-drop: nothing more from the client; stopped at the 8 s stall limit)
   (stray-904:  S 904 / C CAP END / S 001)
```

- **Cause.** `CapabilityRegistry.handleACK` (`CapabilityRegistry.swift:759-784`) moves each name to `enabled` and calls `SASLCapability.onEnabled` on the ACK line that names it, without waiting for the rest of the REQ's set. `onEnabled` (`SASLCapability.swift:126-139`) writes `AUTHENTICATE PLAIN` at once.
- **The model's rule.** The model client enables caps only when the ACKed caps equal the REQ (CN-14, D17), so CMech (S1-1, D1) is not enabled after `ACK :sasl` alone. The frontier should be the client's `AUTHENTICATE PLAIN` at r=2.
- **Same root cause as HexDroid H1, but no early END.** `maybeEmitCapEnd` waits for `pending` to be empty (`CapabilityRegistry.swift:967-970`), and `pending` is tracked per name. So Textual does not send CAP END after the first part, and the `001-between` consequence of H1 does not occur.
- **Liveness, `stray-drop` only.** The server ignored the opener (D7), and the client waited for `AUTHENTICATE +` through the whole 8 s stall window. With no negotiation or SASL timeout in TextualCore (`CapabilityRegistry.swift:1007-1011`), the wait is presumably indefinite; see the long rerun under Liveness.

### Liveness only: the client never finishes

check.py checks safety only, so these traces should match the model. The stall is recorded in `textual.stalled`. Each recorded run was stopped by the server's 8 s stall limit.

A scratch rerun of `del/sasl-after-opener` with `--stall 110` saw nothing from the client after the DEL for 110 s: no CAP END, no PING, no QUIT and no close. HexDroid's watchdog closes at about 60 s; Textual has no such watchdog. The registry's own comment says TextualCore has no negotiation timeout (`CapabilityRegistry.swift:1007-1011`). The other liveness cases are inferred to behave the same from that and from the code; they were not rerun long.

#### T2. No CAP END after `CAP DEL sasl` cancels an exchange (CN-19, CN-21/D5, CN-22)

**Scenarios:** `del/sasl-after-opener`, `del/sasl-after-response`

```
C CAP REQ :cap-notify echo-message message-tags sasl server-time
S CAP tx052 ACK :cap-notify echo-message message-tags sasl server-time
C AUTHENTICATE PLAIN
S CAP tx052 DEL :sasl
   (client silent; in del/sasl-after-response the DEL follows C AUTHENTICATE dGVzdGVy...)
```

- **Cause.** `handleDEL` (`CapabilityRegistry.swift:856-891`) removes `sasl` from `enabled` and calls `SASLCapability.onDisabled` (`SASLCapability.swift:147-149`), which resets the SASL state. It then returns `[]` and never calls `maybeEmitCapEnd`.
- **Effect.** Every condition for CAP END now holds: `pending` is empty, and `sasl` is no longer enabled. But nothing re-evaluates the gate, so registration never completes.
- **Compared with HexDroid H2.** The outcome is the same, but the cause differs: here the SASL state is cleared correctly, and only the END re-check is missing.

#### T3. REQ after CAP END and before 001, with no second END (CN-13, D13)

**Scenarios:** `new/a-after-end/client-nosasl`, `new/sasl-after-end`, `new/a-after-end/no-cap-notify`

```
C CAP REQ :cap-notify echo-message message-tags server-time
S CAP tx058 ACK :cap-notify echo-message message-tags server-time
C CAP END
S CAP tx058 NEW :sasl
C CAP REQ sasl
S CAP tx058 ACK :sasl
C AUTHENTICATE PLAIN
S AUTHENTICATE +
C AUTHENTICATE dGVzdGVyAHRlc3RlcgBnb29kcGFzcw==
S 900 ... / S 903 ...
   (no second CAP END; a server that follows CN:355 holds registration)
```

- **Cause.** `handleNEW` (`CapabilityRegistry.swift:821-849`) REQs the new caps whatever the phase. `maybeEmitCapEnd` returns nil unless `negotiationPhase == .requesting` (`:968`), and after the first END the phase is `.complete`. So a REQ that suspends registration again (CN-13) is never followed by the END it needs.
- **`new/sasl-after-end`.** This run also does a full SASL exchange after END and before 001.
- **After 001.** Not sending another END would be correct then (CN:403-405). The same as HexDroid H3.

#### T4. A challenge other than `+` to PLAIN is ignored (S1-4; outside the model)

**Scenario:** `sasl/nonplus-challenge`

```
C AUTHENTICATE PLAIN
S AUTHENTICATE Zm9vYmFy
   (client silent; server note: "closed while the server still owed a line")
```

- **Cause.** `SASLCapability.handleSubcommandShared` (`SASLCapability.swift:170-203`) acts on `AUTHENTICATE +` only in `.awaitingChallenge`, and on a non-`+` payload only for SCRAM. For PLAIN, anything else falls through to `return []`. The client neither aborts (`AUTHENTICATE *`) nor ends, and with no timeout (S1-4) it stayed silent through the stall window.
- **Not modelled.** The junk challenge is not a model message, so check.py sees an open exchange with nothing more from the client. That is a liveness gap, not a safety violation. HexDroid aborts here.

### Not divergences, noted

- **`client-nosasl` REQs `sasl`.** It also ACKs and enables it, and sends no AUTHENTICATE. The model client may REQ any available cap (CReq, CN-18), and CMech is guarded by `env.wantSasl`. It should match.
- **REQ of `cap-notify`** whenever it is listed. ReqCapNotify is TRUE in check.py's config (CN-23b, D14).
- **`sasl/908-then-904`, `sasl/908-then-906-on-reg`.** The 908 exhausts the client's one mechanism, so it sends CAP END at once, while the server still has the exchange open; the 904 or 906 follows. The model treats an END during an exchange as an abort (S1-3, D16) and allows it.
- **`new/sasl-before-ack`, `new/a-mid-exchange`.** The NEW-triggered REQ is counted in `pending`. CAP END waits for its ACK and for SASL to finish (`new/a-mid-exchange`: REQ server-time mid-exchange, ACK after the response, END after 903).
- **`del/sasl-between-ls-lines`.** The DEL removes `sasl` from `advertised`, so the REQ omits it.
- **`del/sasl-crossing-req`.** The REQ is NAKed whole, and the client sends END with nothing enabled.
- **`sasl/ok-903first`.** CAP END goes out after 903 and before 900; S1 permits it.

## What Textual-NG could not be made to do (with these scenarios)

- **SASL required.** `IRCConnectionConfig.requireSASL` exists (enforced in `maybeEmitCapEnd`, `CapabilityRegistry.swift:979-984`, and on 001 in `Client+Negotiation.swift:232`). It is not exercised, because the scenarios are kept identical to HexDroid's, so `env.required` is always false and S2-3 is not covered. A `required` variant of the `sasl/*` and `req/nak` scenarios could exercise it.
- **TLS.** The harness transport is plaintext only. That does not matter for the handshake, because nothing in CAP/SASL depends on TLS for PLAIN.
- **Retry after 904 with another mechanism.** The client would rotate through `saslMechanismPreference`, but the plan configures `[PLAIN]` only, so MaxSasl stays 1.
- **Reauthentication** (907, `Reauth`): the client does not reauthenticate on its own initiative before 001.
- **An `AUTHENTICATE *` abort.** Textual sends `*` only in SCRAM failure paths (`SASLCapability.swift:733-737`), never with PLAIN. CAbort and CGiveUp are not exercised.
- **Two REQs.** The full cap list fits in one REQ, so CN-12 splitting is not exercised (see Substitutions).
- **DEL between ACK and AUTHENTICATE, as the client sees it.** The opener is written in the same `handleCAP` call as the ACK. As with HexDroid, the earliest point the server can reach is `del/sasl-after-opener`.
- **Pre-registration nick.** CAP replies carry the client's nick, not `*`. Textual accepts either.

Not filed anywhere. The fork is rdrake/Textual-NG; the candidates are for the model check first.

## Live checks (testnet a5911f29, 2026-11-10)

T1-T4 were rerun with the **real macOS app and a real server**. The server was nefarious2 a5911f29 on MrLenin's testnet (Keycloak SASL_LOCAL), and the Ergo control used the scratch Ergo. Setup is as in HEXDROID.md § Live checks: `conformance/inject_proxy.py`, the throwaway account `livetest`, and pacing on modelled lines.

- **Route: the real app for every row.** The gated `SpecHandshakeTraceTests` was not used.
- **The app.** TextualNG.app from 8debe5a, built unsigned the same way as `make verify`: `xcodebuild -scheme TextualNG -configuration Debug build CODE_SIGNING_ALLOWED=NO`, into a scratch `-derivedDataPath`. So the production `NetworkTransport` and `ClientIdentityResolver` path ran, not the harness `SocketTransport`.
- **Isolation.** None of Richard's Textual settings, data stores or keychain items were changed. That was checked as follows:
  - **Bundle id.** The built app is `org.afternet.textual-ng.dev`, which is Richard's dev defaults domain. A scratch copy had `CFBundleIdentifier` changed to `org.afternet.textual-ng.livetest` and was ad-hoc re-signed.
  - **Home directory.** It was launched with `CFFIXED_USER_HOME` (and `HOME`) set to a scratch directory. An unsigned build has no sandbox, so without this, `Settings.store` and `Application Support/TextualNG` would be Richard's shared `~/Library/Application Support` files. A probe confirmed that both move under the fake home.
  - **Profile and password.** The profile came from `TEXTUAL_NG_SEED_FROM_JSON` (DevSeeder), pointing at a scratch seed. So the SASL password lived in `DevCredentialStore`, not the keychain, and the DEBUG fallback to the real `~/.config/textual-ng/dev-seed.json` never ran.
  - **Two profile fields set in the scratch store.** With the app down, sqlite set `ZAUTORECONNECT=0`, and `ZVALIDATESERVERCERTIFICATECHAIN=0` for the TLS run.
  - **What could not be redirected.** Global preferences read the real `group.org.afternet.textual-ng` suite: `containerURL` is non-nil without the entitlement, and cfprefsd ignores the fake home. They were only read. Its md5 and `defaults export` were identical before and after all runs, and so were `org.afternet.textual-ng{,.dev}.plist` and the shared `Settings.store`.
  - **Cleanup and keychain.** The `.livetest` defaults domain that the runs created was deleted afterwards, and both scratch bundles were unregistered from LaunchServices. There is no keychain item for `org.afternet.textual-ng.livetest.credentials`. A search of `~/Library` (depth 4) finds nothing named `*textual-ng.livetest*`, and `com.apple.ncprefs` has no entry for it. Two probe plists from the redirection test (`org.afternet.livetest-probe`, `group.org.afternet.livetest-probe2`) briefly landed in the real `~/Library/Preferences` and were deleted. A Debug run also left an empty `TextualCore/default.profraw` (coverage) in the checkout, and that was deleted too.
- **Raw logs:** `conformance/results/live/textual-proxy.jsonl`.
- **Traces:** `conformance/results/live-textual.jsonl`, 9 runs, with the extra key `live`. The ircd's registration-timeout ERROR is left out of `obs`, as for HexDroid. No TLC or check.py was run on the Mac.
  - `new-before-001` is cut at the proxy's timeout release, as in HEXDROID.md (`stalled` true, the released 001 left out).
  - Wire times are UTC on 2026-11-11.

| Finding | Scenario (live) | Verdict | Route |
| --- | --- | --- | --- |
| T1 | `split-ack` (plaintext) | **Confirmed, reproduced with injection.** `AUTHENTICATE PLAIN` 1 ms after `ACK :sasl`, before the second part. No CAP END between the parts. | real app, nefarious2 |
| T2 | `del-opener`, `del-response` (plaintext) | **Confirmed, reproduced with injection.** No CAP END after `CAP DEL :sasl` in either variant. In a rerun where the proxy hid the ircd's close, the client sent nothing for 149 s after the DEL: no END, no QUIT and no close. It ended only when the app was killed. | real app, nefarious2 |
| T3 | `new-before-001` (plaintext) | **Confirmed, reproduced with injection.** `CAP REQ server-time` after the NEW, and no second CAP END. The held 001 was released by the proxy's 30 s timeout. | real app, nefarious2 |
| T4 | `nonplus` (plaintext) | **Confirmed, reproduced with injection.** `AUTHENTICATE Zm9v` got no reply: no `*` and no END. After 30 s the ircd's own SASL timeout sent 904, and only then did the client send CAP END. | real app, nefarious2 |
| control | `none`, plaintext and TLS | Happy path. Over TLS the wire is the same as over plaintext. | real app, nefarious2 and Ergo |

**TLS finding: the real app sends PLAIN over plaintext.** With `useTLS = false` it sends `AUTHENTICATE bGl2ZXRlc3QAbGl2ZXRlc3QAbGl2ZXBhc3MxMjM=`, the password in base64, over a plaintext socket, with no prompt or refusal. That happened in every plaintext run, the `none` control included. So the harness observation holds for the production `NetworkTransport` path: there is no TLS gate on PLAIN.
- Over TLS (`useTLS = true`, certificate validation turned off for the self-signed proxy certificate), the handshake is the same line for line.
- **Default caveat.** DevSeeder defaults to TLS on (`prefersSecuredConnection = doc.useTLS ?? true`). The in-app editor's default was not checked. The issue is that nothing stops PLAIN once TLS is off. HexDroid, by contrast, refuses with `AUTHENTICATE *`.

**Did the real servers make these moves on their own?** No, in any run.
- Each forwarded REQ got one ACK line, never split and never with `*`.
- Neither server sent a native `CAP NEW` or `CAP DEL`.
- Neither server sent a challenge other than `+`.
- For T3, nefarious2 sent 001 right after the first END and never saw the REQ (the proxy answered it). The CN:355 hold was the proxy's, not the ircd's.

### Wire (trimmed, as in HEXDROID.md)

T1, `split-ack`:
```
46:13.247 C CAP REQ :cap-notify sasl server-time …(+23)
46:13.551 S CAP * ACK :sasl                        <- first part
46:13.552 C AUTHENTICATE PLAIN                     <- 1 ms later
46:13.874 S CAP * ACK :cap-notify server-time …(+23)
46:13.875 S AUTHENTICATE +
46:13.878 C AUTHENTICATE bGl2…
46:14.187 S 900 / 903
46:14.189 C CAP END
46:14.500 S 001 txlive
```

T2, `del-opener` with the ircd's close hidden (`del-response` is the same, with the DEL after the data line and 900/903 swallowed):
```
53:28.693 C AUTHENTICATE PLAIN
53:28.695   (ircd AUTHENTICATE + swallowed)
53:28.996 S CAP * DEL :sasl                        <- injected
53:58.845   (ircd 904 "request timed out" swallowed)
54:28.022   (ircd ERROR Registration Timeout swallowed; ircd closed; client socket held open)
55:57.655 client socket closed when the app was killed: 148.7 s of silence after the DEL
```

T3, `new-before-001`:
```
49:48.350 S 903 * :SASL authentication successful
49:48.351 C CAP END
49:48.355   (ircd 001 txlive held)
49:48.653 S CAP * NEW :server-time                 <- injected
49:48.654 C CAP REQ server-time                    <- not forwarded; proxy ACKs
49:48.956 S CAP * ACK :server-time                 <- injected
   (30 s: no second CAP END)
50:18.353 S 001 txlive                             <- released by the proxy's timeout
```

T4, `nonplus`:
```
50:35.822 C AUTHENTICATE PLAIN
50:35.824 S AUTHENTICATE Zm9v                      <- the ircd's AUTHENTICATE +, rewritten
   (30 s: nothing from the client)
51:05.996 S 904 * :SASL authentication failed: request timed out     <- the ircd's own SASL timeout
51:05.998 C CAP END
51:06.305 S 001 txlive_
```

### Notes

- **Pre-registration line outside the model.** Textual sends `ISUPPORT` before 001.
- **Nick collisions from persistence.** draft/persistence on the testnet attached some logins to the account's earlier session. In one run 001 named `hxlive`, and in the nonplus run there was a 433, so the client registered as `txlive_`. This is outside the handshake.
- **The REQ format differs after NEW.** Textual's REQ after the NEW has no `:` (`CAP REQ server-time`), unlike its first REQ. Both are valid.

## Live checks of the fix branch (testnet a5911f29, 2026-11-10)

The same live procedure was rerun against branch `fix/sasl-handshake-conformance` at 22be3cb1e (worktree `Textual-NG-sasl`), with the **real macOS app and a real server**: nefarious2 a5911f29 on MrLenin's testnet (Keycloak SASL_LOCAL), with the scratch port override (26667) and the documented workarounds. Setup and isolation follow § Live checks above step for step, with these differences:

- **The app.** TextualNG.app from 22be3cb1e, built unsigned with `xcodebuild -workspace Textual.xcworkspace -scheme TextualNG -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`, into a new scratch `-derivedDataPath`. A copy had its bundle id changed to `org.afternet.textual-ng.livetest` and was ad-hoc re-signed. The `SASL PLAIN was not used` string is in the built binary.
- **Profile.** A new, empty scratch home was seeded from the same scratch seeds by one launch with no proxy listening. Then, with the app down, sqlite set `ZAUTORECONNECT=0` and `ZVALIDATESERVERCERTIFICATECHAIN=0`. After the first TLS launch the store read port 17001, TLS on, and both flags still 0.
- **The transport for each row.** The fix refuses PLAIN on a connection that is not encrypted, so on plaintext T1, T2 and T4 would pass without testing anything. Those three therefore ran **over TLS**, through the proxy's TLS listener (`tls=True` in every one of their connect records). T3 and a `none` control ran over plaintext as before, and a `none` control ran over TLS. The Ergo control was not repeated.
- **Testnet.** Brought up with `docker compose -f docker-compose.yml -f <scratch override> up -d --no-build`. `keycloak-setup` had added the LDAP federation again, so it was deleted and `livetest` was checked to exist (testnet bug 1). A direct SASL login to 26667 then succeeded (the first try, a few seconds after start, got 904). The testnet was taken down with the same `-f` files at the end, without `-v`. The testnet's `git status` matched the pre-run copy, and `data/x3.conf` kept its 12:50 mtime.
- **Raw logs:** `conformance/results/live/textual-fix-proxy.jsonl`, with tags `textual-fix/nefarious/{plain,tls}`.
- **Traces:** `conformance/results/live-textual-fix.jsonl`, 7 runs, in the same format as `live-textual.jsonl`, with `live.app` set to 22be3cb1e. Explanatory lines were appended to `live.notes`. No TLC or check.py was run on the Mac.
  - **Nonplus caveat.** The trace shows `AUTHSTAR` at r = 3 with nothing before it in `obs`. The injected `AUTHENTICATE Zm9v` is outside `drive.model_of`, so it is not in `obs`, the same as in the 8debe5a trace. Expect check.py to flag the abort as unprompted unless that challenge is modelled.
  - **`new-before-001` is not cut.** The client's second CAP END released the hold, so `stalled` is false and the 001 stays in `obs`.
  - Wire times are UTC on 2026-11-11.

| Finding | Scenario (live) | Verdict | Route |
| --- | --- | --- | --- |
| T1 | `split-ack` (TLS) | **Fixed.** Nothing from the client for 3.0 s after `ACK :sasl`. The proxy then released the second part on its timer, and `AUTHENTICATE PLAIN` followed 3 ms after it. | real app, nefarious2 |
| T2 | `del-opener`, `del-response` (TLS) | **Fixed.** `CAP END` 3 ms (opener) and 2 ms (response) after `CAP DEL :sasl`. In `del-opener` the ircd then held registration until its own 30 s SASL timeout. It sent 904, which the proxy swallowed, then 433 and `001 txlive_`. In `del-response`, 001 came 313 ms after the END. The `--mask-close` rerun was not needed, because the client did not go silent. | real app, nefarious2 |
| T3 | `new-before-001` (plaintext) | **Fixed for a NEW after an unauthenticated END.** `CAP REQ server-time` after the NEW, the injected ACK, and then a second `CAP END` 1 ms later. That END released the held burst (release `second CAP END`, not the timeout), and 001 followed. **Caveat:** on plaintext the fix withholds PLAIN, so there was no SASL exchange before the first END. The 8debe5a run had 903 before it, so this live run did not exercise the path through a completed login. | real app, nefarious2 |
| T4 | `nonplus` (TLS) | **Fixed.** `AUTHENTICATE *` and `CAP END` 2 ms after `AUTHENTICATE Zm9v`, with no data line and no second mechanism. The ircd answered 906, then 001 came 0.6 s after the challenge. In the 8debe5a run the client waited 30 s for the ircd's timeout. | real app, nefarious2 |
| plaintext | `none` (plaintext) | **Wire: fixed.** `sasl` is still REQed and ACKed, but no AUTHENTICATE line is sent. `CAP END` came 2 ms after the ACK, then 001. **Notice: seen in the log only, not on screen** (see below). | real app, nefarious2 |
| control | `none` (TLS) | Happy path: REQ, ACK, `AUTHENTICATE PLAIN`, `+`, data, 900, 903, END, 001. | real app, nefarious2 |

**The plaintext notice: log evidence only.** In both plaintext runs, the app's unified log has `SASL PLAIN withheld: the connection is not encrypted (no TLS)` from the TextualNG pid, followed by `cap diag: saslEndedUnauthenticated`: pid 59499 at 03:35:08.630 (`none`) and pid 59859 at 03:38:01.108 (`new-before-001`). In the code, that log line comes right before `emitLocalNotice("SASL PLAIN was not used: …", to: "*server")`. The local notice is not stored in `messages.sqlite`. Screen access to the livetest app was asked for and declined, so the notice was **not seen on screen**.
- **Do not compare these times with the wire times to the millisecond.** Both log lines are 13-15 ms earlier than the proxy's record of writing the triggering ACK. The unified log and the proxy are separate clocks and separate write paths, so this does not mean the notice fired before the ACK.

### Wire (trimmed, as above)

T1, `split-ack` (TLS):
```
43:49.370 C CAP REQ :… sasl …
43:49.680 S CAP * ACK :sasl                        <- first part
   (3.0 s: nothing from the client)
43:52.691 S CAP * ACK :account-notify …(rest)       <- second part, released by the proxy's 3 s timer
43:52.694 C AUTHENTICATE PLAIN                     <- 3 ms after the last part
43:53.001 S AUTHENTICATE +
43:53.004 C AUTHENTICATE bGl2…
43:53.312 S 900 / 903
43:53.314 C CAP END
43:53.626 S 001 txlive
```

T2, `del-opener` (TLS):
```
45:12.041 C AUTHENTICATE PLAIN
45:12.043   (ircd AUTHENTICATE + swallowed)
45:12.347 S CAP * DEL :sasl                        <- injected
45:12.350 C CAP END                                <- 3 ms later
45:42.862   (ircd 904 "request timed out" swallowed: the ircd's own SASL hold)
45:42.863 S 433 * txlive
45:42.865 C NICK txlive_
45:43.177 S 001 txlive_
```

T2, `del-response` (TLS):
```
46:03.523 C AUTHENTICATE bGl2…
46:03.526   (ircd 900 / 903 swallowed)
46:03.830 S CAP * DEL :sasl                        <- injected
46:03.832 C CAP END                                <- 2 ms later
46:04.145 S 001 txlive
```

T3, `new-before-001` (plaintext):
```
38:01.121 S CAP txlive ACK :… sasl …
38:01.125 C CAP END                                <- no AUTHENTICATE: PLAIN withheld on plaintext
38:01.127   (ircd burst and 001 txlive held)
38:01.431 S CAP txlive NEW :server-time            <- injected
38:01.432 C CAP REQ server-time                    <- not forwarded; proxy ACKs
38:01.738 S CAP txlive ACK :server-time            <- injected
38:01.739 C CAP END                                <- second END, 1 ms later
38:01.739   proxy releases the held burst (second CAP END)
38:02.046 S 001 txlive
```

T4, `nonplus` (TLS):
```
44:15.785 C AUTHENTICATE PLAIN
44:15.788 S AUTHENTICATE Zm9v                      <- the ircd's AUTHENTICATE +, rewritten
44:15.790 C AUTHENTICATE *                         <- 2 ms later
44:15.790 C CAP END
44:16.096 S 906 * :SASL authentication aborted
44:16.097 S 433 * txlive
44:16.098 C NICK txlive_
44:16.412 S 001 txlive_
```

Plaintext `none`:
```
35:08.335 C CAP REQ :… sasl …
35:08.645 S CAP txlive ACK :… sasl …
35:08.647 C CAP END                                <- no AUTHENTICATE line
35:08.962 S 001 txlive
```

TLS `none`: `43:20.132 C AUTHENTICATE PLAIN`, `43:20.439 S AUTHENTICATE +`, `43:20.441 C AUTHENTICATE bGl2…`, `43:20.760 S 900 / 903`, `43:20.762 C CAP END`, `43:21.077 S 001`.

### Notes and isolation

- **Isolation held.** These were the same before and after all runs: the md5 of `group.org.afternet.textual-ng.plist`, `org.afternet.textual-ng{,.dev}.plist` and the shared `Settings.store` (with `-shm` and `-wal`); the md5 of every file under `Application Support/TextualNG` and the group container (15 files); and `defaults export` of the three domains. The three plist md5s also match the first run's baseline.
  - The keychain has no `org.afternet.textual-ng.livetest.credentials` item, before or after.
  - A search of `~/Library` (depth 4) finds nothing named `*textual-ng.livetest*`, and `com.apple.ncprefs` has no entry for it.
- **Cleanup.**
  - **Defaults domain.** The runs created the `.livetest` domain, and it was deleted. `defaults delete` left an empty 42-byte `org.afternet.textual-ng.livetest.plist`. That file was removed and cfprefsd was restarted, and the domain now reads as not found.
  - **LaunchServices.** Both scratch bundles were unregistered: the livetest copy and the `tng-dd` product.
  - **Coverage file.** The Debug app left an empty `default.profraw` in `seance/tmp/formal-spec/`, the directory it was launched from. It was deleted. None was found in `Textual-NG-sasl`, and that tree is clean at 22be3cb1e.
  - No app or proxy process is left, and ports 17000 and 17001 are free.
- **Nick collisions from persistence**, as in the first run.
  - The TLS `none` control's 001 named `pyprox`, the nick of the direct SASL smoke test, which had logged in as the same account.
  - The `nonplus` and `del-opener` runs got a 433 and registered as `txlive_`.
  - This is outside the handshake.
- **Did the real server make these moves on its own?** No, again. A scan of every `ev=s` record in `textual-fix-proxy.jsonl` shows, in all 7 connections, exactly one ircd ACK per forwarded REQ, no ircd `CAP NEW` or `CAP DEL`, and no ircd `AUTHENTICATE` other than `+`.
- **Same server binary as the first run.** The image was reused with `--no-build`. Every 003 in both proxy logs reads `This server was created Tue Nov 10 2026 at 17:40:23 UTC`.
- **Files touched outside the scratch area.** These were found with `find -newer` against the file written at build start.
  - **Textual-NG-sasl.** Only the empty, gitignored `TextualCore/.swiftpm/{xcode,configuration}` directories (Xcode). They were left as they are.
  - **mrlenin-testnet.** The mtime of the empty marker `data/.x3_admin_created_testadmin` changed when `x3-admin-init` ran at bring-up. That file was already untracked before the run. Otherwise only directory mtimes under `.git/modules` changed, from `git status` refreshing the index. No file under the nefarious pack directory is newer.

## Model check (gpu05, 2026-11-10)

**Scripted traces (job 10087): 57 of 60 match, 3 diverge.** `check.py` ran against SpecHandshake v7 with Reauth off and on, and the result was the same both ways.
- `req/split-sasl-first/stray-drop` and `stray-904`: the model stops at the client's `AUTHENTICATE PLAIN` after the first ACK part. This confirms **T1**.
- `sasl/nonplus-challenge`: the whole trace replays, but the model cannot reach a settled end, because a spec client owes a reply to the challenge. This confirms **T4**: the challenge is silently ignored, and the model treats that as a divergence.
- The liveness findings T2 and T3 match the safety check, as expected. They are confirmed from the wire (see "Live checks").

**Live traces (job 10088, both apps): 14 of 16 match.** The 2 divergences are the split-ACK runs, HexDroid H1 and Textual-NG T1.

## Model check of the fix branch (gpu05, 2026-11-11)

- **Scripted scenarios** (`results/textual-sasl-fix-tip.jsonl`, job 10106): 60 of 60 match the model. Before the fix it was 57 of 60.
- **Live traces** (`results/live-textual-fix.jsonl`, job 10107): 7 of 7 match.
- **PR:** the fix is in draft PR rdrake/Textual-NG#1 (https://github.com/rdrake/Textual-NG/pull/1).
