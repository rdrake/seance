# HexDroid handshake traces

HexDroid is checked out at `~/workspace/afternet/HexDroid-latest`, upstream `boxlabss/HexDroid` main **b6db496e27120a87dbf7ebf6a6af9ad741928c4d** (detached).
The traces are in `conformance/results/hexdroid-b6db496.jsonl`: 60 runs, one per scenario.
TLC has not been run on them. The model check decides; everything below marked *candidate* is unverified.

## How it is driven

- **Client.** HexDroid's real `IrcClient` (`IrcCore.kt`, with `IrcSession.kt` doing CAP/SASL) runs on the JVM inside a JUnit unit test. The test is
  `~/workspace/afternet/HexDroid-latest/app/src/test/java/com/boxlabs/hexdroid/SpecHandshakeTraceTest.kt`. It is uncommitted, and it is the only file added to that tree; no build file was touched.
  - The JVM route needs no Android runtime. This tree already runs `IrcClient` against sockets in `IrcClientRepliesTest`, and `IrcSession` uses `java.util.Base64`.
  - The test reads a plan file named by `HEXDROID_SPEC_PLAN`, and is skipped when that is unset. It connects one client per plan line, in order, and waits for the server to close each connection.
  - Each client uses nick `hxNNN` and SASL PLAIN with authcid `tester`. The password is `goodpass`, `wrongpass` or none, or SASL is `Disabled`. `isBouncer` is false.
- **Server.** `conformance/spec_server.py` is the mirror of `drive.py`. Each scenario is a small model server: the `srv` state of `SpecHandshake.tla`, with its choice points fixed by the scenario.
  - **REQ answers** are decided when they are sent, against what is offered at that moment. A REQ naming a DELed cap is NAKed whole (D8). A split ACK enables its caps only when its last part is sent (CN-14, D19).
  - **SASL.** An opener moves the exchange to `open`, and the challenge is a later line (D23). `AUTHENTICATE *` gets 906. An opener while sasl is not enabled on the server is dropped, or answered with 904 (D7, per scenario).
  - **Registration.** 001 is sent only after END, while nothing holds registration. A REQ seen after END holds it again (D13). 001 is never sent during an exchange: the server either waits for the exchange to finish or, with `regAbort`, sends 906 first (S1-14).
  - **NEW and DEL** are injected at named moments (`ls1`, `reqN`, `mech`, `end`). The server only DELs a cap that is offered and only NEWs one that is not.
- **Pacing.** Before each line the server waits until the client has been quiet for 0.3 s, and it never sends two lines in one burst.
  - `r` is the number of model lines sent before the client line arrived. HexDroid handles each line and writes its replies before it reads the next one (`IrcCore` read loop, `writeLine`), so this equals what it had read.
  - A run ends 1 s after 001. If 001 is held and nothing is owed, it ends after 8 s of silence; the trace's `hexdroid.stalled` is then true.
- **Trace format.** As `results/testnet-a5911f29.jsonl`: `name`, `env`, `offered`, `obs`, `cli`, `raw`, `dropAt: null`.
  - Server lines go through `drive.model_of`, with `server-time` mapped to `a`. ACK, NAK, NEW and DEL lines whose caps are all outside the model are dropped, and so are REQs with no modelled cap (HexDroid always requests caps outside the model too).
  - The first `CAP LS 302`, `NICK` and `USER` are the model's Init. `AUTHENTICATE <mechanism name>` maps to AUTHMECH, `*` to AUTHSTAR, anything else to AUTHDATA.
  - A two-line LS is kept as two lines, including an LS line with no modelled cap (D22).
  - `raw` holds both directions, each line prefixed `S ` (server) or `C ` (client).
  - `offered` is the scenario's initial set without cap-notify.
  - `env.required` is always false. `env.creds` is whether the password is `goodpass`. `env.svcOk` is false only in `sasl/svc-down`.
  - There is one extra key, `hexdroid`, with `{stalled, notes, tls}`. It is like the `seance` key in `seance-handshake-traces.jsonl`, and check.py ignores it.

**Departure from the brief: TLS.** Over plaintext, HexDroid will not send a PLAIN password. It answers `AUTHENTICATE +` with `AUTHENTICATE *` (`IrcSession.kt:684-692`). So the runs that need AUTHDATA, 900/903 or a password-based 904 use TLS: the Python server has a throwaway self-signed certificate, and the client has `useTls=true, allowInvalidCerts=true`. Only `sasl/plaintext-abort` and `sasl/plaintext-abort-nopass` use plaintext. Each trace says which in `hexdroid.tls`. `useTls` changes CAP/SASL behaviour in two places only: the PLAIN refusal (`IrcSession.kt:685`) and the SCRAM-to-PLAIN downgrade in `chooseMechanism` (`:632`), which never fires here because HexDroid is configured for PLAIN.

## Rerun

On the Mac. It runs Gradle and a JUnit test, never TLC.

```sh
cd ~/workspace/afternet/seance/tmp/formal-spec/conformance
python3 spec_server.py results/hexdroid-b6db496.jsonl            # all 60 scenarios, about 7 min
python3 spec_server.py /tmp/x.jsonl --grep del/ --stall 75       # subset; a long stall shows the client's 60 s watchdog
python3 spec_server.py --list                                    # scenario names
```

`spec_server.py` starts the listener, writes the plan, and runs `./gradlew :app:testDebugUnitTest --tests com.boxlabs.hexdroid.SpecHandshakeTraceTest --rerun` in `--hexdroid DIR` (default `~/workspace/afternet/HexDroid-latest`). The Gradle log goes to a temp directory, whose path is printed. To validate on the cluster, run `check.py results/hexdroid-b6db496.jsonl WORKDIR -j N`.

## Scenarios (60)

- **`ls2/…` (10): LS in two lines.**
  - `sasl{1,2}-a{1,2}-cap-notify{1,2}` puts each modelled cap on the first or the last line, so it includes all on the first and all on the last (D22). The other line carries `message-tags` or `echo-message`.
  - `all-last-filler-first` and `all-first-filler-last`: the other line holds only an invented filler cap.
- **`ls1/…` (15): one LS line.**
  - `sasl{0,1}-cn{0,1}-a{0,1}` lists each modelled cap or not. When sasl is listed, the same LS is also run with SASL disabled on the client (`/client-nosasl`).
  - Also: `ls2/sasl1-a2/client-nosasl`, `ls1/no-model-caps` and `ls1/empty`.
- **`sasl/…` (16): SASL outcomes.** All use the LS `sasl=PLAIN server-time cap-notify …`.
  - `ok` (900 then 903) and `ok-903first`.
  - `bad-password` (904 after the response).
  - `timeout-before-challenge` (904 with no AUTHENTICATE +) and `timeout-after-response` (904 in place of a decision).
  - `svc-down` (svcOk false: 904 to the opener).
  - `908-then-904`, and `908-then-906-on-reg` (908, then nothing until END, then 906 and 001).
  - `nonplus-challenge` (`AUTHENTICATE Zm9vYmFy`, outside the model).
  - `plaintext-abort`, `plaintext-abort-nopass` and `no-password` (TLS, no password): the client aborts.
  - `value-external`: `sasl=EXTERNAL`, which the client will not open.
  - `value-scram-904`: `sasl=SCRAM-SHA-256`. The client switches to SCRAM, and the server fails it after the client-first message.
  - `value-none`: a bare `sasl`.
  - `full-caps-two-reqs`: every cap HexDroid wants, so it sends two REQs. The second has no modelled cap.
- **`req/…` (9): REQ answers.**
  - `nak`, and `nak/client-nosasl`.
  - `split-sasl-first/stray-drop` and `split-sasl-first/stray-904`: ACK `sasl`, then ACK the rest, with no marker (D15).
  - `split-sasl-last`: ACK the rest, then `sasl`.
  - `split-sasl-last/001-between`: the client's END lets the server register between the two ACK parts.
  - `split-other-first`: the first part holds only caps outside the model.
  - `split/client-nosasl`.
  - `full-caps-nak-second`: ACK the first REQ, NAK the second, mid-exchange.
- **`del/…`, `new/…` (10): CAP DEL and CAP NEW.**
  - `del/sasl-between-ls-lines`: DEL sasl before the REQ, between the LS lines.
  - `del/sasl-crossing-req`: DEL after the REQ is read; the REQ is then NAKed.
  - `del/sasl-after-opener`: DEL in place of the challenge.
  - `del/sasl-after-response`: DEL in place of the decision.
  - `del/a-mid-exchange`.
  - `new/sasl-before-ack`: NEW sasl while the first REQ is unanswered.
  - `new/a-mid-exchange`.
  - `new/a-after-end/client-nosasl`, `new/sasl-after-end` and `new/a-after-end/no-cap-notify`: NEW after END and before 001.

## Candidate divergences

The model check decides. Rule IDs are from `RULES.md`. Wire excerpts drop NICK/USER/005/376; `S` is the server, `C` the client.

### 1. SASL started on the first part of a split ACK (CN-14, S1-1, D1, D15, D17)

**Scenarios:** `req/split-sasl-first/stray-drop`, `req/split-sasl-first/stray-904`

```
S CAP hx043 LS :sasl=PLAIN server-time cap-notify message-tags echo-message
C CAP REQ :message-tags server-time echo-message sasl
S CAP hx043 ACK :sasl
C AUTHENTICATE PLAIN
S CAP hx043 ACK :echo-message message-tags server-time
   (nothing more from the client; with stray-904 it gets a 904 and sends CAP END)
```

- **What HexDroid does.** It treats every ACK line as a complete answer. `IrcSession.kt:295` adds the caps to `enabledCaps` line by line, and `:308` decrements `pendingCapReqs` once per ACK line. It therefore opens SASL before the set's last ACK part. In the model, sasl is enabled only once the ACKed caps equal the REQ.
- **Effect.** The server had not enabled sasl yet, so with `stray-drop` the opener is ignored (D7). HexDroid then waits for `AUTHENTICATE +` and never sends CAP END. The recorded run stops at the 8 s stall limit. From the code, the 60 s registration watchdog would then close the socket with no QUIT.

### 2. AUTHENTICATE after 001, from CAP END after a partial ACK (S1-2, out of scope under D2)

This is less a violation than it looks. S2-6 lets a client authenticate at any time, and D2 puts SASL after 001 out of the model's scope, so check.py will most likely reject the trace for scope (`CMech` is guarded by `~cli.welcomed`). The real finding is the per-line ACK handling from candidate 1, which here produces the early END.

**Scenario:** `req/split-sasl-last/001-between`

```
C CAP REQ :message-tags server-time echo-message sasl
S CAP hx046 ACK :echo-message message-tags server-time
C CAP END
S 001 hx046 :Welcome ...
S CAP hx046 ACK :sasl
C AUTHENTICATE PLAIN
S AUTHENTICATE +
C AUTHENTICATE AHRlc3RlcgBnb29kcGFzcw==
```

- **What HexDroid does.** The root cause is the same as in 1. After the first part, `pendingCapReqs` is 0 and sasl is not yet enabled, so `maybeCapEnd` sends END. The last part then starts SASL after 001.
- **Related, probably not divergences.** The same early END appears in `req/split-sasl-last` and `req/split-other-first`, but there the server waits for the exchange before sending 001. The model allows END at any time after LS (S1-3 is only RECOMMENDED), so those two should match.

### 3. `AUTHENTICATE *` in reply to `AUTHENTICATE +` (likely a model gap: S1-4, S1-10)

**Scenarios:** `sasl/plaintext-abort`, `sasl/plaintext-abort-nopass`, `sasl/no-password`

```
C AUTHENTICATE PLAIN
S AUTHENTICATE +
C AUTHENTICATE *
C CAP END
S 906 hx035 :SASL authentication aborted
S 001 hx035 :Welcome ...
```

- **What HexDroid does.** It refuses to send a PLAIN password over plaintext, or with no password, and aborts on reading the challenge.
- **Why the model may reject it.** In `SpecHandshake.tla`, `CHandle("AUTH+")` in state `mech` appends AUTHDATA in the same step. AUTHSTAR with `r` counting the `AUTHENTICATE +` is therefore not a model client move. The spec lets the client abort at any time (S1:39-40, S1:72-73).
- **So:** if check.py rejects these traces, it is most likely the model client that is too narrow, not HexDroid.
- **For contrast:** `sasl/nonplus-challenge` aborts before any `AUTHENTICATE +` (the junk challenge is outside the model), so it should match.

### 4. No CAP END after `CAP DEL sasl` cancels an exchange (CN-19, CN-21/D5, CN-22). Liveness only

**Scenarios:** `del/sasl-after-opener`, `del/sasl-after-response`

```
C AUTHENTICATE PLAIN
S CAP hx052 DEL :sasl
   (client silent; a scratch rerun of del/sasl-after-opener with --stall 75 saw the client close
    the socket at ~60 s, no QUIT, no CAP END; for del/sasl-after-response this is inferred from the code)
```

- **What HexDroid does.** The DEL handler (`IrcSession.kt:275-286`) removes sasl from `enabledCaps` but leaves `saslInProgress` set. `maybeCapEnd` returns while it is set (`:851`). The cancelled exchange keeps negotiation open until the registration watchdog fires.
- **Will check.py see it?** No. It checks safety only, so these traces should match. The stall is in `hexdroid.stalled`.

### 5. REQ after CAP END and before 001, with no second END (CN-13, D13). Liveness only

**Scenarios:** `new/a-after-end/client-nosasl`, `new/sasl-after-end`, `new/a-after-end/no-cap-notify`

```
C CAP REQ :message-tags server-time echo-message
S CAP hx058 ACK :echo-message message-tags server-time
C CAP END
S CAP hx058 NEW :sasl
C CAP REQ :sasl
S CAP hx058 ACK :sasl
C AUTHENTICATE PLAIN ... 900, 903
   (client never sends another CAP END; a server that follows CN:355 holds registration)
```

- **What HexDroid does.** The CAP NEW handler REQs the new caps and never sends END again (`IrcSession.kt:269`: "CAP NEW is post-registration"). That is exactly the D13 hang. In `new/sasl-after-end` it also runs a full SASL exchange after its END.
- **Will check.py see it?** No: it is liveness, and the traces should match.

### Not divergences, noted

- **`new/sasl-before-ack`.** HexDroid sends END once the original REQ is answered while its NEW-triggered REQ is still outstanding (`pendingCapReqs` does not count it). It then authenticates after END. The model permits this.
- **`req/full-caps-nak-second`.** The NAK of the second chunk mid-exchange does not end negotiation early. The guard at `IrcSession.kt:851` works.

## What HexDroid could not be made to do

- **SASL required:** neither `IrcConfig` nor anything else under `app/src/main` has an option for it (grep for require/mandatory near sasl), so `env.required` is always false and S2-3 (`RuleClientRequiredNoEnd`, `RequiredQuits`) is not exercised.
- **Retry after a 904, or another mechanism:** HexDroid never retries (`saslDone` is set on 904-908), so MaxSasl stays 1. It never reauthenticates either, so 907 and `Reauth` are not exercised.
- **Ending negotiation mid-exchange by its own choice:** it only does that after a 908 (`sasl/908-*`) or a local abort.
- **REQ of `cap-notify`:** HexDroid never requests it (CN-23b).
- **"DEL between ACK and AUTHENTICATE" as the client sees it:** HexDroid writes `AUTHENTICATE PLAIN` in the same read-loop step as the ACK. Without a burst, which would make `r` wrong, the earliest point the server can reach is DEL after the opener and before the challenge (`del/sasl-after-opener`).
- **SCRAM-SHA-256 and EXTERNAL exchanges:** these are outside the single-step PLAIN model. `sasl/value-scram-904` only shows the switch to SCRAM and a failure after the first client message.
- **Pre-registration nick:** CAP replies carry the client's nick, not `*`. HexDroid accepts either.

## Model check (gpu05 job 10085, 2026-11-10): 54 of 60 match, 6 diverge

`check.py` against SpecHandshake v7, with Reauth both off and on (the same verdict each time).
Work dir: `/project/def-rdrake/rdrake/formal/traces-v7/work-hexdroid-b6db496/` (`summary.json`).

| Trace | Frontier (where the model stops) | Reading |
| --- | --- | --- |
| `req/split-sasl-first/stray-drop`, `req/split-sasl-first/stray-904` | client, after line 3 (first ACK part): `AUTHENTICATE PLAIN` | **HexDroid divergence (H1).** It enables caps and counts the REQ as answered on every ACK line (`IrcSession.kt` ACK handler, `pendingCapReqs--`). So it opens SASL on the first part of a split ACK, before the whole set is ACKed (CN-14, D15/D17, D1). |
| `req/split-sasl-last/001-between` | client, after 001: `AUTHENTICATE PLAIN` | The same root cause: CAP END after the first part, then the server registers and SASL opens after 001. That is outside the model (D2), so it is H1's consequence, not a separate rule break. |
| `sasl/plaintext-abort`, `sasl/plaintext-abort-nopass`, `sasl/no-password` | client, after `AUTHENTICATE +`: `AUTHENTICATE *` | **Model gap, not a HexDroid bug.** The spec lets a client abort an exchange at any time (S1), but the v7 model client answers the challenge only with data. A model fix is needed: the client may send `*` after a challenge (a new decision). |

The liveness candidates match the safety check, as expected, but the wire shows them directly:
- **H2:** after `CAP DEL sasl` mid-exchange, no CAP END ever comes, and the client closes after about 60 s (`del/sasl-after-opener`, `del/sasl-after-response`).
- **H3:** a `CAP NEW` that lands after CAP END but before 001 gets a REQ and no second END. CN:355 holds registration until that END, so no 001 ever comes (`new/a-after-end/client-nosasl`, `new/sasl-after-end`, `new/a-after-end/no-cap-notify`). After 001 the missing END is correct (CN:403-405).

Not filed anywhere. HexDroid is upstream boxlabss/HexDroid; ask Richard before anything goes there.

## Live checks (testnet a5911f29, 2026-11-10)

H1-H3 were rerun with the **real app and a real server**. The client was the HexDroid b6db496 debug APK (`./gradlew :app:assembleDebug` in `HexDroid-latest`), installed on the `seance-android` emulator and driven with adb and uiautomator. The server was nefarious2 a5911f29 on MrLenin's testnet (Keycloak SASL_LOCAL), with the scratch port override (26667) and the documented workarounds. The Ergo control used the scratch Ergo (`scratchpad/ergo`, 127.0.0.1:16670).

- **Route: the real app for every row.** The JVM `SpecHandshakeTraceTest` was not used.
- **Proxy.** `conformance/inject_proxy.py` sits between the app and the ircd. The emulator reached it at `10.0.2.2:17001`. The proxy terminates TLS with a throwaway self-signed certificate and talks plain TCP to the ircd.
  - It passes every line through except the one move named per scenario, and logs both directions with UTC times.
  - Before writing a line the model sees, it waits until the client has been quiet for 0.3 s.
  - Raw logs: `conformance/results/live/hexdroid-proxy.jsonl`.
- **App configuration.** One throwaway network, "LiveTest": TLS on, "Allow invalid certificates" on, nick `hxlive`, SASL PLAIN as `livetest` (a throwaway Keycloak user, also registered on Ergo), auto-reconnect off. Connections were started from the overflow menu's **Reconnect**.
- **The app appears to pin the certificate on first use.** `IrcConnect.kt:50` mentions a TOFU pin. Connections through a proxy with a different self-signed certificate were dropped by the client right after the TLS connect. All recorded runs therefore use one certificate.
- **Traces:** `conformance/results/live-hexdroid.jsonl`, 7 runs, in the `results/*.jsonl` format (via `drive.model_of`).
  - The extra key is `live: {stalled, notes, tls, release, scenario, app, route}`.
  - The ircd's `ERROR :Closing Link ... (Registration Timeout)` is not put in `obs`, but is kept in `notes`. It comes from the ircd's registration timer, and the model only lets the server send ERROR after a SASL failure (S2-7), so leaving it in would make check.py stop at the ircd's timer instead of at the client.
  - Not checked here: no TLC or check.py was run on the Mac.
  - **`new-before-001` is cut at the proxy's 30 s release, which also leaves out the released 001**, and `stalled` is true. The model server holds again after a REQ that follows END (`HoldOnCap`, D13), so it would never send that 001; keeping it would make the trace stop on the server side for a proxy artefact.
  - Wire times are UTC on 2026-11-11 (local 2026-11-10).

| Finding | Scenario (live) | Verdict | Route |
| --- | --- | --- | --- |
| H1 | `split-ack` | **Confirmed, reproduced with injection.** `AUTHENTICATE PLAIN` 28 ms after the first ACK part, before the rest of the set was ACKed. | real app, nefarious2 |
| H2 | `del-opener`, `del-response` | **Confirmed, reproduced with injection.** No CAP END after `CAP DEL :sasl`, in either variant. In a rerun where the proxy hid the ircd's close, the client closed the socket itself 60.1 s after connecting, with no QUIT (`REGISTRATION_TIMEOUT_MS = 60_000L`, `ConnectionConstants.kt:93`). | real app, nefarious2 |
| H3 | `new-before-001` | **Confirmed, reproduced with injection.** `CAP REQ :server-time` after the NEW, and no second CAP END. The proxy released the held 001 burst after its 30 s timeout. | real app, nefarious2 |
| control | `none` | Happy path: LS(2), REQ, ACK, PLAIN, `+`, data, 900, 903, END, 001. | real app, nefarious2 and Ergo |

**Did the real servers make these moves on their own?** No, in any run.
- **Split ACKs.** nefarious2 and Ergo answered each forwarded REQ with exactly one ACK line, never with a `*` continuation. HexDroid's two REQs (the second is `draft/webpush`) got two separate ACKs, which is not a split.
- **NEW and DEL.** Neither server sent a native `CAP NEW` or `CAP DEL`.
- **Challenges.** Neither server sent a challenge other than `AUTHENTICATE +`.
- **What the H3 proxy did.** It held 001, and it swallowed the client's REQ and answered it itself. nefarious2 sent 001 right after the first END and never saw that REQ, so CN:355's hold was simulated by the proxy and not exercised in the ircd.
- **What the H2 runs leave unshown.** nefarious2 at HEAD never DELs sasl to a registering client (N2), so a live server would not trigger H2 on its own here either.

### Wire (trimmed)

Cap lists are cut to the modelled caps. `…(+n)` marks the n caps left out, and server prefixes and tags are dropped. Raw lines are in the log.

H1, `split-ack`:
```
36:13.716 C CAP REQ :server-time sasl …(+24)
36:13.734 C CAP REQ :draft/webpush
36:14.045 S CAP * ACK :sasl                        <- first part (proxy split the ircd's one ACK)
36:14.073 C AUTHENTICATE PLAIN                     <- before the rest is ACKed
36:14.392 S CAP * ACK :server-time …(+24)          <- second part
36:14.392 S CAP * ACK :draft/webpush
36:14.392 S AUTHENTICATE +
36:14.407 C AUTHENTICATE AGxpdmV0ZXN0AGxpdmVwYXNzMTIz
36:14.725 S 900 / 903
36:14.742 C CAP END
36:15.053 S 001 hxlive
```
The ircd itself had enabled sasl on the whole REQ, so the exchange went on to succeed. The divergence point is the client's `AUTHENTICATE PLAIN` at r = 3, after `ACK :sasl` alone.

H2, `del-opener` (the `del-response` run is the same, with the DEL after `C AUTHENTICATE AGxp…`, and the ircd's 900/903 swallowed):
```
36:46.805 C AUTHENTICATE PLAIN
36:46.806   (ircd AUTHENTICATE + swallowed)
36:47.105 S CAP * DEL :sasl                        <- injected
37:16.931   (ircd 904 "request timed out" swallowed)
37:46.092 S ERROR :Closing Link: * by testnet.example.net (Registration Timeout)
   client: nothing after the opener, no CAP END
```
With the ircd's close hidden (`--mask-close`, a second run):
```
56:20.187 connected
56:20.845 C AUTHENTICATE PLAIN
56:21.147 S CAP hxlive DEL :sasl                   <- injected
57:20.174   (ircd ERROR Registration Timeout swallowed; ircd closed; client socket held open)
57:20.282 client closed the connection (no QUIT, no CAP END), 60.1 s after connect
```

H3, `new-before-001` (`server-time` hidden from the ircd's LS):
```
43:44.660 S 903 * :SASL authentication successful
43:45.073 C CAP END
43:45.077   (ircd 001 hxlive held by the proxy)
43:45.377 S CAP * NEW :server-time                 <- injected
43:45.427 C CAP REQ :server-time                   <- not forwarded; answered by the proxy
43:45.731 S CAP * ACK :server-time                 <- injected
   (30 s: no second CAP END)
44:15.075   proxy releases the held burst (timeout)
44:15.076 S 001 hxlive
```

Controls (`none`): on nefarious2, `REQ … server-time sasl`, `ACK`, `AUTHENTICATE PLAIN`, `+`, data, `900`, `903`, `CAP END`, `001`. Ergo gives the same wire.

### Notes

- **Pre-registration lines outside the model.** HexDroid sends `ISUPPORT` and `METADATA * SUB …` before 001, in the same step as `AUTHENTICATE PLAIN`.
- **The nick in CAP replies varies.** nefarious2 addressed CAP replies to `*` in most runs and to `hxlive` in one, and the injected lines used the nick the ircd had used last. One superseded H3 run, kept in `results/live/superseded-hexdroid-new-before-001-run1.jsonl`, addressed the injected ACK to the not-yet-registered nick because of a proxy bug. It shows the same behaviour.
- **draft/persistence.** On the testnet, 001 sometimes names the persisted nick of the account's earlier session (`livechk` in a smoke test). This is outside the handshake.
- **Cleanup.** The APK was uninstalled from the emulator afterwards, and the emulator was stopped.
