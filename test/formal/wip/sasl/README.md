# IRCv3 SASL spec model (SpecSasl)

This is an independent TLA+ model of IRCv3 SASL, written only from the spec text. It covers the parts the handshake spec model (`../spec/model/SpecHandshake.tla`) leaves out:
- several mechanisms and the `sasl=` list, 908 and retrying;
- AUTHENTICATE chunking in both directions, and SCRAM-shaped mechanisms;
- 900-908;
- reauthentication after registration and account changes;
- NEW/DEL of sasl and new mechanism lists.

**Status: v0.1 draft. Only the SANY parser has been run** (the model, and every mutant). No configuration has been model-checked yet, so every "pass", "fail" and "caught by" below is a prediction.

- `RULES.md`: each rule in scope, with file:line and encoding (guard/prop/switch/free/out), and the counts.
- `DECISIONS.md`: interpretation choices D1-D19, the exploration restrictions R1-R4 (D17), and open questions Q1-Q7. Readings shared with the handshake model cite its decisions (hs D3, hs D5, ...).
- `model/SpecSasl.tla`: the model. Its header says what is assumed and out of scope, where it extends or differs from the handshake model, and which exploration restrictions apply.
- `model/make-configs.py`: the single source of every `.cfg`. It checks each config against the module: all 18 constants assigned, every named operator defined, and no temporal formula listed as an invariant. Rerun it after any change to the module.
- `model/mutants/make-mutants.py`: the single source of the mutants and their configs. Each replacement must match exactly once. Rerun it after any change to the module or the configs, then parse each mutant with SANY.

## v0.1 changes

v0.1 answers an independent review of v0 (16 findings).

| # | Finding | Change |
| --- | --- | --- |
| 1 | DEL left SASL-specific owed output alive | DEL now cancels the owed 903, 908 and 904. An owed 900 survives as account notification (D13, R4). `DelCancels` covers the owed output, new `RuleDelCancelsOutput` covers what is sent, and `SuccAccounting` counts 903s cancelled by a DEL. New mutant `MU_DelKeepOwed`. |
| 2 | The total-length limit could send 905 | The limit now gives 904 only. 905 stays for the over-long line. The paraphrase now includes "credentials are valid", and that condition is noted as abstracted away (D6). |
| 3 | Timeout preparedness was cited as abort | S1-4 now means the client reads `SrvTimeout`'s 904 in every state. `CAbort` is filed under S1-10. `CGiveUp` is an explicit local-abandonment assumption, with its stale-reply consequence (D19). |
| 4 | The syntax MUST was conflated with the advertisement SHOULD | S2-4b (comma syntax) is now out. `RuleValueIsMechs` is labelled as the model's exact-advertisement policy under S2:38-39 (D18). |
| 5 | Three choices restrict legal behaviour | These are now labelled restrictions R1-R4 in the header and D17. R1 is relaxed by `AcctEarly` (`W_AcctEarly`) and R2 by `AnyOrder908` (`W_Late908`). R3, the read barrier, is not relaxed; D14 now states what it removes. |
| 6 | No config without a sasl value | New `TinyNoValue` (`AdvertValue = FALSE`) and witness `W_NoValueLogin`. |
| 7 | `MechListAgrees` was vacuous where lists change | New `TinyNotifyList`: two mechanisms, two env events, `SilentChange = FALSE`. `W_NewList` now runs on it. |
| 8 | The empty-final check looked at the plan, not the wire | `RuleClientEmptyFinal` now checks the lines actually sent after the final challenge. New mutant `MU_FinalShort`. |
| 9 | Framing checked termination, not the payload | New `RuleClientSendsPayload` and `ClientPayloadDone`: each sent line must match the reference chunking `Lines(p)` of the chosen payload `cli.pay`. `RuleClientFraming` is kept as the weak form. New mutant `MU_ExactShort`. |
| 10 | "Opener answered" did not check the error | New `RuleReauthRefused`: 907 or 904, no exchange, no account change. New mutant `MU_PostRegWrongErr`. |
| 11 | `W_AbortMid` could fire before the first chunk | It now requires at least one chunk sent and one still unsent. |
| 12 | `W_MultiChunk` could count a rejected response | It now requires FULL then SHORT accepted into `decide`, on new config `TinyChunks2` (MaxLen 2). `W_ExactPlus` also requires `decide`. |
| 13 | `W_NewThenAuth` did not need a login after the NEW | It is now an ordered monitor: LS without sasl, then NEW, REQ, ACK, opener, 903. |
| 14 | `W_NewList` did not need the list to change | It now requires a valued NEW that differs from the client's list and is installed. |
| 15 | The liveness explanation was wrong | `ExchangeEnds` is now documented as eventual exit only (D15). New `NoAbandon` switch, config `TinyNoAbandon` and `RuleExitByServerLine` give server-driven completion. |
| 16 | `OwedSent` promised more than it checks | Renamed `OwedEventuallyClears`, with the weaker meaning documented. Obligations are not tracked one by one: `SuccAccounting` already covers 900/903 as safety, and DEL cancellation is now explicit. |

## Overlap with the handshake model's Reauth.cfg and CapNotify.cfg

- **Reauth.** In the handshake model, `Reauth.cfg` turns on a boolean `Reauth` that only the server sees: the client never reauthenticates (hs D2), and accounts are not modelled. Here:
  - `Reauth` is `"none"` (hs `Reauth = FALSE`), `"full"` (hs TRUE, also after 001, with account changes) or `"same"` (D9).
  - The client side is the `ClientReauth` switch.
  - `TinyS1` and `TinyReauth` are the counterparts of the handshake's `TwoAttempts`/`Reauth`.
- **CapNotify.** `CapNotify.cfg` exercises NEW/DEL of caps without values, plus REQs of cap-notify. Here, NEW carries the mechanism list, a NEW can update the list of an offered sasl (D11), and the set may change silently (`SilentChange`). cap-notify REQs, other caps and split ACKs stay with the handshake model. `TinyNotify` and `TinyNotifyList` are the counterparts.

## Configurations

Every config below is written by `make-configs.py`.
- **Limited** configs are for now. They are small bounds that together reach every feature.
- **Comprehensive** configs are for later, once every model is ready. Do not run them now.

All of them are checked with `CHECK_DEADLOCK FALSE`. The positive configs check:
- the invariants TypeOK, DelCancels, SuccAccounting, RuleClientFraming, ClientPayloadDone and the three Agrees invariants;
- the 20 `Rule*` action properties;
- `ExchangeEnds` and `OwedEventuallyClears` (only `OwedEventuallyClears` under `EnvSpec`).

The v0.1 switches default to FALSE except where the table says otherwise: `AnyOrder908`, `AcctEarly`, `NoAbandon`.

| Config | Run | Spec | What it exercises | Bounds and switches |
| --- | --- | --- | --- | --- |
| `TinyMechs` | limited | Spec | Mechanism lists, a mechanism the client does not implement (X), unsupported mechanism → 908 and 904 in either order, retry with another mechanism | Mechs P,E,X; client P,E; 1 chunk; 2 openers; no env events; Send908; AnyOrder908; PickListed off |
| `TinyNoValue` | limited (v0.1) | Spec | sasl advertised with no value (S2:44-46); the client picks among its own mechanisms; 908 may then supply a list | as TinyMechs, AdvertValue off, PickListed on, AnyOrder908 off |
| `TinyChunks` | limited | Spec | Chunking: `+` after exactly 400 bytes, the length limit (MaxLen 1 → 904), a SCRAM-shaped mechanism (S) with a chunked final challenge and the empty final response, aborts between chunks | Mechs P,S (S two-round); 2 chunks; MaxLen 1; 1 opener |
| `TinyChunks2` | limited (v0.1) | Spec | As TinyChunks, but FULL+SHORT and FULL+FULL+`+` responses are accepted | MaxLen 2 |
| `TinyReauth` | limited | Spec | Reauthentication allowed: login after 001, account change a1→a2, a failed reauthentication that logs out (901), logout by other means then login again, 903 before 900, the account set before its late 900 | Reauth "full", ClientReauth, AcctEarly; accounts a1,a2; 2 openers; 1 env event |
| `TinyS1` | limited | Spec | S1 server: 907 for every AUTHENTICATE line after login, 904 for an unauthenticated opener after 001 (D8, `RuleReauthRefused`) | as TinyReauth, Reauth "none", AcctEarly off |
| `TinyNotify` | limited | Spec | cap-notify: sasl absent then NEW sasl=list, DEL mid-exchange (and its cancelled owed output), silent mechanism changes (stale lists), 908 | Mechs P,E; 2 openers; 2 REQs; 2 env events; SilentChange; Send908 |
| `TinyNotifyList` | limited (v0.1) | Spec | List updates by NEW only, so `MechListAgrees` is live | as TinyNotify, SilentChange off, Send908 off |
| `TinyNoAbandon` | limited (v0.1) | Spec | Server-driven completion: no abort, give-up or quit; `ExchangeEnds` with `RuleExitByServerLine` | as TinyMechs, NoAbandon |
| `TinyEnv` | limited | EnvSpec | As TinyMechs with server fairness only: safety and `OwedEventuallyClears` | TinyMechs |
| `TinySame` | limited, own list | Spec | Reauth "same": a change of account refused with 907 at the verdict (D9; open question Q4, so kept apart) | as TinyReauth, Reauth "same" |
| `Reference` | **comprehensive, not now** | Spec | Everything together | Mechs P,S,X; 2 chunks; MaxLen 2; 3 openers; 2 REQs; 2 env events; Reauth "full"; every switch on except PickListed and NoAbandon |
| `RefSafety` | **comprehensive, not now** | EnvSpec | Reference, safety only, with `VIEW SafetyView` | Reference |
| `RefNone` | **comprehensive, not now** | Spec | Reference with Reauth "none" | Reference |

Every witness config is limited. Each checks one `W_*` invariant, which should FAIL: a counterexample shows the feature is reached.

| Witness | Base | What its counterexample shows |
| --- | --- | --- |
| `W_LoggedIn` | TinyMechs | a login, then 001 |
| `W_Retry908` | TinyMechs | 908 for one mechanism, then success with another |
| `W_Late908` | TinyMechs | v0.1: 904 first, its 908 after it (R2 relaxed) |
| `W_NoValueLogin` | TinyNoValue | v0.1: sasl with no value in LS, then a login |
| `W_MultiChunk` | TinyChunks2 | v0.1: FULL then SHORT accepted as one response (moved to `decide`) |
| `W_ExactPlus` | TinyChunks | `+` after an exactly-400-byte chunk, accepted |
| `W_Limit` | TinyChunks | the server's length limit ends an exchange |
| `W_TwoRound` | TinyChunks | a SCRAM-shaped success |
| `W_ChalChunked` | TinyChunks | the client reassembles a chunked challenge |
| `W_AbortMid` | TinyChunks | v0.1: `*` after at least one chunk, with chunks still unsent |
| `W_AccountChange` | TinyReauth | the account moves a1 → a2 by reauthentication |
| `W_PostReg` | TinyReauth | a success after 001 |
| `W_FailLogout` | TinyReauth | a failed reauthentication logs out (901) |
| `W_Relogin` | TinyReauth | 901, then logged in again |
| `W_903First` | TinyReauth | a 903 sent before its 900 |
| `W_AcctEarly` | TinyReauth | v0.1: the account set while its 900 is still owed (R1 relaxed) |
| `W_Late907` | TinyS1 | 907 after a login |
| `W_PostRegErr` | TinyS1 | an unauthenticated opener after 001 gets 904 |
| `W_NewList` | TinyNotifyList | v0.1: a valued NEW changes and replaces the client's list |
| `W_NewThenAuth` | TinyNotify | v0.1: LS without sasl, then NEW, REQ, ACK, opener, 903, in that order |
| `W_DelMid` | TinyNotify | DEL of sasl during an exchange |
| `W_StaleList` | TinyNotify | an opener of a listed mechanism the server no longer supports |
| `W_Refuse907` | TinySame | a change of account refused with 907 |

### Commands

From `model/`, with `tla2tools.jar` at hand (`TLA` below is its path). Use `-workers` to suit the machine.

Limited (now):

    for C in TinyMechs TinyNoValue TinyChunks TinyChunks2 TinyReauth TinyS1 \
             TinyNotify TinyNotifyList TinyNoAbandon TinyEnv; do
      java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config $C.cfg SpecSasl.tla
    done
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinySame.cfg SpecSasl.tla   # own list (Q4)

Witnesses (limited; each should report `Invariant W_x is violated`):

    for W in W_LoggedIn W_Retry908 W_Late908 W_NoValueLogin W_MultiChunk W_ExactPlus \
             W_Limit W_TwoRound W_ChalChunked W_AbortMid W_AccountChange W_PostReg \
             W_FailLogout W_Relogin W_903First W_AcctEarly W_Late907 W_PostRegErr \
             W_NewList W_NewThenAuth W_DelMid W_StaleList W_Refuse907; do
      java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config $W.cfg SpecSasl.tla
    done

Mutants (limited; from `model/mutants/`, after `python3 make-mutants.py`; each should report a violation):

    for M in MU_EarlyVerdict MU_NoPlusAfter400 MU_Chunk401 MU_FinalShort MU_ExactShort \
             MU_KeepAfterDel MU_SrvKeepAfterDel MU_DelKeepOwed MU_ChangeOn907 MU_No907 \
             MU_PostRegWrongErr; do
      java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config $M.cfg $M.tla
    done

Comprehensive (**later, not now**):

    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config Reference.cfg SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config RefSafety.cfg SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config RefNone.cfg   SpecSasl.tla

## Mutants (expected results, not yet run)

| Mutant | Base config | Change | Expected to be caught by |
| --- | --- | --- | --- |
| `MU_EarlyVerdict` | TinyChunks | The server treats an exactly-400-byte chunk as the end of the response, so it can send 900/903 before the last line. | `RuleVerdictAfterLast` |
| `MU_NoPlusAfter400` | TinyChunks | The client sends no `+` after a response that is an exact multiple of 400 bytes (chunking off by one). | `RuleClientFraming` (also `RuleClientSendsPayload`) |
| `MU_Chunk401` | TinyChunks | The client sends the last 400-byte chunk and its `+` as one over-long line. | `RuleClientLineLen` (also `RuleClientSendsPayload`) |
| `MU_FinalShort` (v0.1) | TinyChunks | The client sends SHORT where the empty final response `+` is due. | `RuleClientEmptyFinal` (also `RuleClientSendsPayload`). `RuleClientFraming` and v0's plan-based check would pass. |
| `MU_ExactShort` (v0.1) | TinyChunks | The client ends an exact-400 payload with SHORT instead of `+`. | `RuleClientSendsPayload`. `RuleClientFraming` would pass. |
| `MU_KeepAfterDel` | TinyNotify | The client keeps its exchange after DEL sasl, and keeps sending. | `RuleClientAuthOnlyEnabled` |
| `MU_SrvKeepAfterDel` | TinyNotify | The server keeps the exchange after sending DEL sasl. | `DelCancels` |
| `MU_DelKeepOwed` (v0.1) | TinyNotify | The server's DEL leaves an owed 903 alive. | `DelCancels` (also `RuleDelCancelsOutput`) |
| `MU_ChangeOn907` | TinyS1 | The server logs the client out in the step that sends 907. | `Rule907NoChange` (`RuleAccountNotified` also forbids it) |
| `MU_No907` | TinyS1 | An S1 server lets an authenticated client authenticate again. | `Rule907` (also `RuleReauthRefused`) |
| `MU_PostRegWrongErr` (v0.1) | TinyS1 | An S1 server answers an unauthenticated opener after 001 with 906 instead of an error. | `RuleReauthRefused`. `RuleOpenerAnswered` would pass. |

TLC stops at the first violation it finds. A mutant that is caught first by a different property from the one listed still counts as caught; record which property it was. Each unmutated base config is expected to pass.
