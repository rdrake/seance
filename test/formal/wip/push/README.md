# Push model (v0)

This model covers web push across one account's devices: message pushes, read relays, and the notifications each device shows. It was started after a report from the iPhone: opening a message brings up a second "Marked as read" notification. The cause is that nefarious2 relays the read to every subscription, the reader's own included, and under WebKit the worker has to show something for it.

The model is built from the specs and the prior art in `PRIOR-ART.md`.

Files:
- `PRIOR-ART.md`: how other chat apps and the browsers handle this, and the candidate rules R1-R10.
- `RULES.md`: the rules the model checks, with sources.
- `DECISIONS.md`: readings D1-D6 and open questions Q1-Q5.
- `model/SpecPush.tla`: the model.
- `model/make-configs.py`: the configs.
- `model/mutants/make-mutants.py`: the mutants.

Every module parses with SANY. **Nothing has been model checked yet.** TLC runs on gpu05.

## Server and client choices (constants)

| Constant | Today | Candidate |
| --- | --- | --- |
| `RelayTo` | `"all"` | `"others"` (R1) |
| `Identity` | `"conn"` | `"device"` (D1) |
| `OutPer` | `"account"` | `"sub"` (R2) |
| `StrictRelay` | `"send"` | `"skip"` (R3) |
| `MergeTime` | `"last"` | `"newest"` (D3, R10) |

## Configs and expected results

All configs use `CHECK_DEADLOCK FALSE` and have two devices, `d1` (Chrome) and `d2` (WebKit).

TLC stops at the first violation, so each rule a config is expected to break has a config of its own, `<config>__<Rule>`. The base config checks only the rules expected to hold there.

| Config | Run | Constants | Expected to fail |
| --- | --- | --- | --- |
| `Today` | limited | nefarious2 and Seance as they are | `RuleNoSelfRelay`, `RuleNoOwnReadStub`, `RuleCloseOnlyRead`, `RuleRelayWherePushed` (it relays to everyone) |
| `R1Conn` | limited | R1, bound to the connection | the same four: Mark read's throwaway connection, D3, and the account-wide gate |
| `R1Dev` | limited | R1 by device id, `MergeTime = "newest"` | `RuleRelayWherePushed` (R1 without R2) |
| `R1DevLate` | limited | `R1Dev` with `d2` subscribing late | `RuleRelayWherePushed` |
| `R1R2Late` | limited | `R1DevLate` + R2 | none |
| `R1R2R3` | limited | R1 + R2 + R3 | none |
| `R1DevLossy3` | limited | `R1Dev`, lossy, 3 messages | `RuleRelayWherePushed` (R1 without R2) |
| `Reference` | **comprehensive, not now** | 3 devices, 2 conversations, 4 messages, lossy | none |

## Witnesses (each should report a violation, showing the situation is reachable)

| Config | Shows |
| --- | --- |
| `Today__W_OwnReadStub` | the report: the reader's own "Marked as read" |
| `Today__W_ClosedUnread` | a relay closing a card that holds an unread message (D3) |
| `R1Dev__W_OtherReadStub` | under R1, a read on the Mac still puts a stub on the phone |
| `R1DevLate__W_RelayNoCard` | a relay to a device never pushed the conversation |
| `R1R2R3__W_StaleCard` | under R3, a read card left on a closed phone with no relay coming |
| `R1Dev__W_StaleCard` | Q4: reachable (v0 run, 39a7be2e5): a WebKit card can go stale even without R3 |

## Mutants (expected to fail; not yet run)

| Mutant | Base | Change | Should break |
| --- | --- | --- | --- |
| `MU_SilentRelay` | `R1DevLossy3` | the WebKit worker shows nothing for a relay | `RuleNeverRevoked` |
| `MU_CloseAll` | `R1Dev` | a relay closes every card of its conversation | `RuleCloseOnlyRead` |
| `MU_AlertRead` | `R1Dev` | an alert for a message known to be read | `RuleNoAlertForRead` |
| `MU_RelayAll` | `R1Dev` | the server relays to the reader as well | `RuleNoSelfRelay` |
| `MU_NoSubGate` | `R1R2Late` | the per-subscription gate is ignored | `RuleRelayWherePushed` |
| `MU_OpenNoSweep` | `R1Dev` | the opening app sweeps only stubs | `RuleOpenClean` |
