# Push model v0: limited run results

These are from TLC `-workers 4` in the cloud, on the model at 00f3c9499. All 31 runs match their expectations. `Reference`, the comprehensive config, waits for gpu05.

## Configs expected to pass

| Config | Distinct states | Time |
| --- | ---: | ---: |
| Today | 134,667 | 3 s |
| R1Conn | 80,221 | 2 s |
| R1Dev | 35,038 | 1 s |
| R1DevLate | 54,156 | 2 s |
| R1DevLossy3 | 1,505,690 | 29 s |
| R1R2Late | 50,123 | 1 s |
| R1R2R3 | 22,505 | 1 s |

## Configs expected to fail

| Config | Fails | States |
| --- | --- | ---: |
| Today__RuleCloseOnlyRead | RuleCloseOnlyRead | 3,448 |
| Today__RuleNoOwnReadStub | RuleNoOwnReadStub | 246 |
| Today__RuleNoSelfRelay | RuleNoSelfRelay | 30 |
| Today__RuleRelayWherePushed | RuleRelayWherePushed | 17,111 |
| R1Conn__RuleCloseOnlyRead | RuleCloseOnlyRead | 3,781 |
| R1Conn__RuleNoOwnReadStub | RuleNoOwnReadStub | 297 |
| R1Conn__RuleNoSelfRelay | RuleNoSelfRelay | 59 |
| R1Conn__RuleRelayWherePushed | RuleRelayWherePushed | 18,160 |
| R1Dev__RuleRelayWherePushed | RuleRelayWherePushed | 11,187 |
| R1DevLate__RuleRelayWherePushed | RuleRelayWherePushed | 134 |
| R1DevLossy3__RuleRelayWherePushed | RuleRelayWherePushed | 69,731 |

## Witnesses (all reached)

| Witness | States |
| --- | ---: |
| Today__W_OwnReadStub | 228 |
| Today__W_ClosedUnread | 1,321 |
| R1Dev__W_OtherReadStub | 137 |
| R1Dev__W_StaleCard | 2,226 |
| R1DevLate__W_RelayNoCard | 120 |
| R1R2R3__W_StaleCard | 163 |

## Mutants (each caught by its named rule)

| Mutant | Caught by | States |
| --- | --- | ---: |
| MU_AlertRead | RuleNoAlertForRead | 120 |
| MU_CloseAll | RuleCloseOnlyRead | 1,575 |
| MU_NoSubGate | RuleRelayWherePushed | 106 |
| MU_OpenNoSweep | RuleOpenClean | 529 |
| MU_RelayAll | RuleNoSelfRelay | 31 |
| MU_SilentRelay | RuleNeverRevoked | 763,003 (10 s) |

## What this says

- **Today's servers and client relay a read to the reader** (`Today__RuleNoSelfRelay`). On WebKit the reader then shows its own "Marked as read" (`Today__RuleNoOwnReadStub`, `W_OwnReadStub`). This is the report from the iPhone.
- **R1 bound to the connection is not enough** (`R1Conn__RuleNoSelfRelay`, `R1Conn__RuleNoOwnReadStub`). A Mark read made with the app closed goes over the worker's throwaway connection, which registered no subscription (D1). Naming the device (`Identity = "device"`) passes both rules (`R1Dev`).
- **Seance's merged card carries the time of the push that arrived last** (D3). With out-of-order delivery, a relay can close a card that still holds an unread message (`Today__RuleCloseOnlyRead`, `W_ClosedUnread`). Carrying the newest message's time passes (`R1Dev`).
- **Without R2, relays reach subscriptions that never had the push** (every `__RuleRelayWherePushed`). `R1R2Late` passes.
- **A WebKit card can go stale with or without R3** (`R1Dev__W_StaleCard`, `R1R2R3__W_StaleCard`). R3 makes it the rule rather than the exception (DECISIONS Q4, Q5).
