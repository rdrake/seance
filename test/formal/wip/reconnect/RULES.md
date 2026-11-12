# Rules encoded in `model/StsReconnect.tla` and `model/ConnectPath.tla`

Source for the IRCv3 rules: `ircv3/ircv3-specifications` at commit `9ff58d1342af67aff88753388f568542820c4bfe` (2026-08-03), the same checkout as `../spec/RULES.md` and `../sasl/RULES.md`.
Files: `extensions/sts.md` (STS), `extensions/capability-negotiation.md` (CN). `STS:53` is line 53 of `sts.md`.

Seance's own rules (the reconnect schedule, the server's throttles, the restore wait) are not in any IRCv3 document. They come from Seance's design notes and code at the branch base `4f5a4bd12` (evilnet `develop` at `ef782edf1` changes none of the files below): `docs/resources/irc-layer.md` (IL), `client/js/irc/transport.ts` (TR), `client/js/irc/client.ts` (CL), `client/js/irc/sts.ts` (ST), `client/js/irc/persistence.ts` (PE), `client/js/irc/fakelag.ts` (FL), `client/js/irc/manager.ts` (MG). They are the "SC" rules: the model checks that the design holds together, not that it is the only right one.

Each Model cell starts with one encoding word:
**guard** (the model client cannot break it), **prop** (checked as an invariant or action property), **switch** (a choice exposed as a CONSTANT; the `Seance*` switches reproduce Seance where it departs from the spec), **free** (left nondeterministic because the spec permits it), or **out** (outside the model; see the module header).

## STS (sts.md)

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| STS-1 | STS:25 | MUST | For the policy's duration the client connects only securely, on the port the value gives. | prop `RuleNoPlainDialWithPolicy` (every dial: plain only when no valid policy), `RulePolicyPort` (a dial a policy upgraded goes to the policy's port). |
| STS-2 | STS:27 | MUST | Sufficient certificate verification. | out (D2): a secure dial either opens or fails; why it fails is one of the env's reasons. |
| STS-3 | STS:33,35 | MUST | Value syntax; unknown keys ignored; keys at most once. | out (D3): the value is abstracted to its parts (port, duration, preload). Covered by `test/irc/sts.ts` "parseStsValue". |
| STS-4 | STS:39-43 | MUST | `port` is required on an insecure connection, `duration` on a secure one; a policy missing its required part is treated as absent. | guard: `ReadLS` / `SrvNew` act only on `port` over plain and only on `duration` over TLS. prop `RuleIgnoreWithoutPort` (plain, no port: the client registers there) and `RuleSecureNoDurKeeps` (TLS, no duration: the store is unchanged). |
| STS-5 | STS:45, 69, 75, 87 | MUST | Each part is respected only on its own connection type: `port` ignored over TLS, `duration` and `preload` ignored over plain. | prop `RulePolicyOnlyFromSecure` (the store changes only by a secure LS/NEW, a secure close, or a reload's reschedule), `RulePortIgnoredOnSecure` (no upgrade from a TLS connection). |
| STS-6 | STS:51 | MUST | On seeing an upgrade policy over plain, first establish a secure connection and confirm the persistence policy there. | guard: nothing is stored from a plain connection (`RulePolicyOnlyFromSecure`). The ordering "close, then dial" is STS-12. |
| STS-7 | STS:53 | MUST | Once a persistence policy is verified, only secure connections to that host until it expires; refuse to connect if no secure connection can be made. | prop `RuleNoPlainDialWithPolicy` over every dial, including the transport's automatic retries and other networks on the same host (D6). prop `NoPlainFallback` (a failed secure dial under a valid policy is never followed by a plain dial). switch `SeanceRetry` (D6, finding F1). |
| STS-8 | STS:55 | SHOULD | Upgraded but no persistence policy: keep using the secure connection for that session. | prop `SessionStaysSecure` (after an upgrade, every dial of that session is secure; a session ends at a reload, D9) and `UpgradeOncePerSession`. |
| STS-9 | STS:57 | MUST NOT | Never `CAP REQ sts`. | out (D3): caps.ts:108 `NEVER_REQUEST`; covered by its tests. |
| STS-10 | STS:59 | MUST | A new `sts` value by `CAP NEW` on a secure connection is stored or updates the policy. | guard: env action `SrvNew` on a registered secure connection applies the duration; prop `RuleResetExpiry` covers LS and NEW alike. |
| STS-11 | STS:61 | MUST | `CAP DEL sts` is ignored. | prop `RuleIgnoreDel` (a DEL changes neither the store nor the connection). |
| STS-12 | STS:67 | MUST | Not connected securely: close the insecure connection and reconnect securely on the stated port. | prop `RuleUpgradeToPort` (the next dial is TLS on the advertised port), `RuleNothingAfterUpgrade` (after reading the upgrade policy, nothing but QUIT goes out on the plain socket; D7, a reading), `UpgradeBeforeRegistration` (no `CAP END` on a plain socket after the upgrade policy was read: CN:69-74 then keeps the server from registering us there). switch `SeanceStsAfterCaps` (finding F2). |
| STS-13 | STS:73, 77 | MUST | `duration` is the seconds until expiry; the expiry is reset each time a valid policy with `duration` is received on a secure connection. | prop `RuleResetExpiry`: a secure LS/NEW with duration d > 0 leaves the policy at the connection's port with expiry now + d. |
| STS-14 | STS:79 | MAY | `duration=0` removes the policy. | prop `RuleDurationZero`: a secure LS/NEW with duration 0 leaves no policy. |
| STS-15 | STS:81 | MAY / MUST | After expiry the client may still connect securely; it must still respect upgrade policies. | free: after expiry the conforming client dials what its options say (a saved TLS network stays TLS). prop `RuleUpgradeToPort` holds whether or not a policy is valid. |
| STS-16 | STS:85-93 | OPTIONAL | `preload` on a secure connection: consent to preload lists. | free: stored with the policy, ignored over plain (STS-5). Preload lists themselves: out (Seance has none, D3). |
| STS-17 | STS:97-107 | SHOULD | SNI and per-hostname policies (server side). | out (server). The client keys the store by host name; one host in the model (D4). |
| STS-18 | STS:111-113 | MUST | When closing a connection, reschedule the expiry to close time + the duration last advertised, also when the expiry passed during the connection. | prop `RuleRescheduleOnClose` (every close of an opened TLS connection whose server advertised a duration, including a page unload) and `PolicyStoredAfterClose`. switch `SeanceReschedule` (D8, findings F3 and F4). |
| STS-19 | STS:147-151 | non-normative | Rescheduling while connected. | out (Seance does not; D8). |
| STS-20 | STS:153-157 | non-normative | No immediate user recourse to bypass a failure insecurely. | guard: the model's user can connect and disconnect but not edit the endpoint (D10). |
| STS-21 | STS:159-167 | non-normative | User-declared policies; policy deletion. | out. |
| STS-22 | STS:189-195 | non-normative | One policy covers every port of a hostname. | guard: one store entry per host; every network on the host reads it (D4, D6). |

## Capability negotiation (CN) that STS relies on

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| CN-1 | CN:69-74, 199-200 | MUST | LS during registration suspends it until `CAP END`. | guard: a plain connection that saw an upgrade policy and sent no `CAP END` is never registered by the server (`UpgradeBeforeRegistration`). |
| CN-2 | CN:229-231, 264-266 | — | `302` implies cap-notify: NEW and DEL may arrive at any time. | guard: env actions `SrvNew` and `SrvDel` on registered connections. |
| CN-3 | CN:270-271 | MAY | Values only in LS and NEW. | guard: only LS and NEW carry the `sts` value. |
| CN-4 | CN:282-288 | MUST | A multiline LS ends at the line without `*`; process them together. | out (D3): one LS step. Seance's `checkSts` waits for the last line (CL:1162); `test/irc/sts.ts`. |
| CN-5 | CN:420 | — | NEW can update the value of an existing capability. | guard: `SrvNew` carries the server's current advertisement. |
| CN-6 | CN:450-453 | MUST | After DEL the client treats the caps as gone. | free for sts: STS-11 overrides it for the policy. |

## Seance's reconnect design (SC)

| ID | Source | Rule (paraphrased) | Model |
| --- | --- | --- | --- |
| SC-1 | TR:180-191, IL:35 | Anyone who asks (a click, the foreground poke, `/connect`) restarts the schedule: the attempt counter goes to 0 and the dial is now. | guard `Connect`, `Poke`. prop `RuleAskRestarts`. |
| SC-2 | TR:537-543 | Automatic retries back off ×2 from the first delay to the cap, jitter in [3/4, 1]. | guard `Closes`. prop `RuleCapFloor`: a wait at the cap is above the IP window. |
| SC-3 | TR:446-474 | A connection that stayed up `Stable`, or a socket lost under a probe, is retried at once with the schedule restarted. | guard `Closes` (probe: out, D11). Witness `W_StableAtOnce`. |
| SC-4 | TR:488-500, IL:35 | A dial that failed before opening is retried after the quick delays, then after `Unreached` + jitter, a long wait above the IP window, until a socket opens. | prop `RuleSpacing` (quick retries spent: wait > `Window`). prop `NoStorm` (any `Len(Quick)+3` dials of a network span more than `Window`). |
| SC-5 | TR:193-199, 487-494; IL:35 | The server's `ERROR … throttled` makes the next retry wait what it names (here `Throttle`), held against the poke. | prop `RuleThrottleWait`. |
| SC-6 | IL:35, TR:16-19 | nefarious2's IPcheck refuses the n-th connection from an address when each gap is within the window; a refusal renews it. | guard: env `ip` (chain of dials across every network on the host, refused at `IpLimit`). |
| SC-7 | TR:201-203, MG:450-466 | The foreground poke leaves a long wait alone. | guard `Poke` needs `~hold`. |
| SC-8 | CL:902-929, TR:381-389 | A user disconnect closes without a retry and cancels a pending one. | prop `RuleDisconnectFinal` (no dial while the user does not want the network). |
| SC-9 | CL:1149-1206 | The STS upgrade is not a failure: a fresh transport, attempt 0, dialled at once; tried once per connection. | prop `RuleUpgradeNoPenalty`, `UpgradeOncePerSession`. |
| SC-10 | CL:1128-1140, MG:183-190 | A connect applies a valid policy first and saves the upgrade with the network. | guard `ApplyPolicy`. prop `RulePolicyPort`. |
| SC-11 | — (goal) | While the user wants a network and the network is up and quiet, it reconnects within a bound. | prop `ReconnectsWithin` (bounded response, D12). |
| SC-12 | IL:51 | Nothing but registration before 001. | `ConnectPath`: prop `RuleNothingBefore001`. |
| SC-13 | IL:55, FL:53-68, 157-160 | Every line after 001 costs 2 s + bytes/120 of fake lag; the server stops parsing past 10 s ahead; background work goes only while the clock is under 4 s, so three of the user's lines always fit. | `ConnectPath`: props `BackgroundLeavesRoom`, `UserLinesParsed`. |
| SC-14 | PE:57-62, 105-155, 157-160 | After STATUS ON the autojoin waits for the restoration batch, or 2 s (0.75 s after the last sign of one), never past 8 s; the close cancels it. | `ConnectPath`: props `AutojoinOnce`, `AutojoinBounded`, `NoAutojoinAfterClose`, `AutojoinNotEarly`. |

## Counts

- STS rules: 22. prop 12 (STS-1, 4, 5, 7, 8, 11, 12, 13, 14, 18 and, through them, 10 and 22 as guards with props), guard 4, free 2, out 6 (2, 3, 9, 17, 19, 21) — counting each row once by its first word: prop 10, guard 4, free 2, out 6.
- CN rules: 6. guard 4, free 1, out 1.
- SC rules: 14. Every one has a prop or guard; three (SC-12 to SC-14) live in `ConnectPath`.
