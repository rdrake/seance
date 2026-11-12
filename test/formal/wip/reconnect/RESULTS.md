# Results: reconnect policy and IRCv3 STS

Model at this commit. Seance at `4f5a4bd12`, and evilnet `develop` at `ef782edf1` leaves the modelled code unchanged. The STS spec is at `9ff58d13`. TLC ran with `-workers 1` and a 6-minute cap per run. The raw lines are in `model/results.summary`: 74 runs, every verdict matching its expectation.

## Limited configs

Every positive config checks every property below, except where the table notes otherwise:

- Invariants: `TypeOK`, `SessionStaysSecure`, `UpgradeOncePerSession`, `RuleCapFloor`, `RuleSpacing`, `RuleThrottleWait`, `NoStorm` and `ReconnectsWithin`.
- Action properties: `RuleNoPlainDialWithPolicy`, `RulePolicyPort`, `RuleUpgradeToPort`, `RulePortIgnoredOnSecure`, `RuleIgnoreWithoutPort`, `RuleUpgradeWhenPort`, `RuleNothingAfterUpgrade`, `UpgradeBeforeRegistration`, `RuleUpgradeNoPenalty`, `RulePolicyOnlyFromSecure`, `RuleSecureNoDurKeeps`, `RuleResetExpiry`, `RuleDurationZero`, `RuleIgnoreDel`, `RuleRescheduleOnClose`, `RuleDisconnectFinal` and `RuleAskRestarts`.

| Config | Result | Distinct states | Time |
| --- | --- | ---: | ---: |
| Upgrade | pass | 2,369,023 | 45 s |
| UpgradeSasl | pass | 2,369,023 | 46 s |
| Secure | pass | 2,600,969 | 50 s |
| Schedule | pass | 1,534,470 | 22 s |
| Two | pass | 459,773 | 12 s |
| TwoIp (all but `ReconnectsWithin`) | pass | 69,085 | 2 s |
| TwoIpNoCount | pass | 49,479 | 2 s |
| LockoutTwoIp | **fails `ReconnectsWithin`** as expected (F5) | 63,160 | 1 s |
| SeanceRetry | **fails `RuleNoPlainDialWithPolicy`** (F1) | 260 | <1 s |
| SeanceAfterCaps | **fails `UpgradeBeforeRegistration`** (F2) | 10 | <1 s |
| SeanceAfterCapsSasl | **fails `RuleNothingAfterUpgrade`** (F2) | 10 | <1 s |
| SeanceReschedule | **fails `RuleRescheduleOnClose`** (F4, the reload) | 347 | 1 s |
| SeanceRescheduleExpired | **fails `RuleRescheduleOnClose`** (F3) | 6,899 | 1 s |
| SeanceAfterCapsSaslEnd | pass (with SASL the flush holds no `CAP END`) | 2,369,023 | 27 s |
| SeanceRestUpgrade | pass (every switch on, every other property) | 3,103,334 | 52 s |
| SeanceRestUpgradeSasl | pass | 3,103,334 | 51 s |
| SeanceRestSecure | pass | 2,993,033 | 50 s |
| SeanceRestSchedule | pass | 1,534,470 | 20 s |
| SeanceRestTwo | pass | 412,919 | 10 s |
| SeanceRestTwoIpNoCount | pass | 49,479 | 2 s |
| CPHeld (all ConnectPath properties) | pass | 1,191,064 | 13 s |
| CPNotHeld | pass | 17,292 | 1 s |

The ConnectPath properties are:

- `CPTypeOK`, `BackgroundLeavesRoom`, `UserLinesParsed`, `AutojoinOnce` and `AutojoinBounded`;
- the action properties `RuleNothingBefore001`, `AutojoinNotEarly` and `NoAutojoinAfterClose`.

## Witnesses: 27 of 27 reached

StsReconnect has 21 witnesses:

- `W_UpgradeRegistered`, `W_PolicyDial`, `W_ExpiredPlain`, `W_DurZero`, `W_NewDur`;
- `W_PortChange` (1.7M states, 21 s);
- `W_NoFallback`, `W_UpgradeFailsSecure`, `W_Throttled`, `W_QuickThenHold`, `W_StableAtOnce`;
- `W_CapWait`, `W_IpRefused`, `W_CancelWait`, `W_Reschedule`, `W_RescheduleExpired`;
- `W_TwoNets`, `W_SavedUpgrade`, `W_Poke`, `W_UpgradeByNew`, `W_Reconnected`.

ConnectPath has 6 witnesses: `W_CPBatchJoin`, `W_CPTimerJoin`, `W_CPDeadline`, `W_CPDeferred`, `W_CPBgWaited` and `W_CPClosedWaiting`.

Every witness except `W_PortChange` is reached in at most 3 s.

## Mutants: 25 of 25 caught

| Mutant | Config | Caught by |
| --- | --- | --- |
| PlainFallback | Secure | RuleNoPlainDialWithPolicy |
| UpgradeLoop | Upgrade | SessionStaysSecure |
| StorePlainDur | Two | RulePolicyOnlyFromSecure |
| PortOnSecure | Upgrade | RulePortIgnoredOnSecure |
| IgnorePort | Upgrade | RuleUpgradeWhenPort |
| UpgradeOnDur | Two | RuleIgnoreWithoutPort |
| IgnoreZero | Secure | RuleDurationZero |
| NoReset | Secure | RuleResetExpiry |
| NoRescheduleClose | Secure | RuleRescheduleOnClose |
| DelRemoves | Upgrade | RuleIgnoreDel |
| PolicyKeepsPort | Two | RulePolicyPort |
| UpgradeBackoff | Upgrade | RuleUpgradeNoPenalty |
| NoHold | Schedule | RuleSpacing |
| NoHoldStorm | Schedule | NoStorm |
| CapLow | Schedule | RuleCapFloor |
| NoThrottleWait | Schedule | RuleThrottleWait |
| DisconnectRetry | Secure | RuleDisconnectFinal |
| PokeKeepsAttempt | Schedule | RuleAskRestarts |
| AfterCapsAlways | UpgradeSasl | RuleNothingAfterUpgrade |
| CPNoBudget | CPHeld | BackgroundLeavesRoom |
| CPNoDeadline | CPHeld | AutojoinBounded |
| CPNoCancel | CPHeld | NoAutojoinAfterClose |
| CPDoubleJoin | CPHeld | AutojoinOnce |
| CPPre001 | CPHeld | RuleNothingBefore001 |
| CPJoinEarly | CPHeld | AutojoinNotEarly |

An earlier mutant, PolicySavedPort, made the policy dial use the saved secure port. In every limited config that port equals the policy port, so the mutant could not be told apart from the original. PolicyKeepsPort replaces it: the policy dial switches the scheme but keeps the plain port.

## Trace check against Seance's code

`conformance/results/trace-check-4f5a4bd12.txt` holds the result. Each scenario recorded from Seance's own `IrcClient` and `WsTransport` was run through the model at the real time scale. The *spec* column uses the conforming model, and the *seance* column turns on every `Seance*` switch.

| Scenario | Steps | spec | seance |
| --- | ---: | --- | --- |
| upgrade | 6 | stuck at 2: upgrade sent `CAP REQ`, `CAP END` before QUIT (F2) | follows |
| upgradeSecureFails | 68 | stuck at 3 (F2) | follows |
| durationZero | 21 | follows | follows |
| newDuration | 105 | follows | follows |
| reschedule | 108 | follows | follows |
| rescheduleExpired | 128 | stuck at 124: the drop at 120 s left the expired policy unrescheduled (F3) | follows |
| twoNetworks | 20 | stuck at 17: `n1` retried `ws://` at 11 s under a valid policy (F1) | follows |
| userFinal | 129 | follows | follows |
| throttle | 60 | follows | follows |
| unreached | 211 | follows | follows |
| backoff | 209 | follows | follows |
| poke | 9 | follows | follows |
| lockout | 453 | follows | follows |

Every scenario follows in the Seance mode. In the conforming mode, every scenario sticks exactly where its finding says it should. `lockout` follows in both modes: the model reproduces Seance's 420 s of refused dials, which is the F5 behaviour that `LockoutTwoIp` shows violates `ReconnectsWithin`.

## Findings

These are described in `DECISIONS.md`. `conformance/findings.ts` holds one failing test for each finding except F4, and all four tests fail on `4f5a4bd12`.

- **F1:** the transport's own retry ignores a policy learned since `connect()`. The test sees the retry URL `ws://irc.example.org:8067/`.
- **F2:** an insecure LS carrying `sts=port=` gets `CAP REQ :multi-prefix` and `CAP END` before the upgrade.
- **F3:** a policy that expired during the connection is dropped at the close, so after the drop the policy is `undefined`.
- **F4:** `pagehide` does not reschedule. This one has no test, because it needs `window`.
- **F5:** two networks on one address are locked out by IPcheck, with no connection in 600 s.

## Comprehensive configs (not run)

`Reference`, `RefReal`, `LockoutTwoIpReal`, `TwoIpRealNoCount` and `CPReal`. The README gives the commands.
