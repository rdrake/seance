# IRCv3 SASL spec model (SpecSasl)

This is an independent TLA+ model of IRCv3 SASL, written only from the spec text. It covers the parts the handshake spec model (`../spec/model/SpecHandshake.tla`) leaves out:
- several mechanisms and the `sasl=` list, 908 and retrying;
- AUTHENTICATE chunking in both directions, and SCRAM-shaped mechanisms;
- 900-908;
- reauthentication after registration and account changes;
- NEW/DEL of sasl and new mechanism lists.

**Status: draft. Only the SANY parser has been run** (the model, and every mutant). No configuration has been model-checked yet, so every "pass", "fail" and "caught by" below is a prediction.

- `RULES.md`: each rule in scope, with file:line and encoding (guard/prop/switch/free/out), and the counts.
- `DECISIONS.md`: interpretation choices D1-D16 and open questions Q1-Q7. Readings shared with the handshake model cite its decisions (hs D3, hs D5, ...).
- `model/SpecSasl.tla`: the model. Its header says what is assumed and out of scope, and where it extends or differs from the handshake model.
- `model/make-configs.py`: writes every `.cfg` and checks it against the module: all 15 constants assigned, every named operator defined, and no temporal formula listed as an invariant. Rerun it after any change to the module.
- `model/mutants/make-mutants.py`: writes the mutants and their configs. Rerun it after any change to the module, then parse each mutant with SANY.

## Overlap with the handshake model's Reauth.cfg and CapNotify.cfg

- **Reauth.** In the handshake model, `Reauth.cfg` turns on a boolean `Reauth` that only the server sees: the client never reauthenticates (hs D2), and accounts are not modelled. Here:
  - `Reauth` is `"none"` (hs `Reauth = FALSE`), `"full"` (hs TRUE, also after 001, with account changes) or `"same"` (D9).
  - The client side is the `ClientReauth` switch.
  - `TinyS1` and `TinyReauth` are the counterparts of the handshake's `TwoAttempts`/`Reauth`.
- **CapNotify.** `CapNotify.cfg` exercises NEW/DEL of caps without values, plus REQs of cap-notify. Here, NEW carries the mechanism list, a NEW can update the list of an offered sasl (D11), and the set may change silently (`SilentChange`). cap-notify REQs, other caps and split ACKs stay with the handshake model. `TinyNotify` is the counterpart.

## Configurations

Every config below is written by `make-configs.py`.
- **Limited** configs are for now. They are small bounds that together reach every feature.
- **Comprehensive** configs are for later, once every model is ready. Do not run them now.

All of them are checked with `CHECK_DEADLOCK FALSE`. The positive configs check:
- the invariants TypeOK, DelCancels, SuccAccounting, RuleClientFraming and the three Agrees invariants;
- the 16 `Rule*` action properties;
- `ExchangeEnds` and `OwedSent` (only `OwedSent` under `EnvSpec`).

| Config | Run | Spec | What it exercises | Bounds and switches |
| --- | --- | --- | --- | --- |
| `TinyMechs` | limited | Spec | Mechanism lists, a mechanism the client does not implement (X), unsupported mechanism → 908 + 904, retry with another mechanism | Mechs P,E,X; client P,E; 1 chunk; 2 openers; no env events; Send908; PickListed off |
| `TinyChunks` | limited | Spec | Chunking: 2-chunk responses, `+` after exactly 400 bytes, the length limit (MaxLen 1 → 904/905), a SCRAM-shaped mechanism (S) with a chunked final challenge and the empty final response, aborts between chunks | Mechs P,S (S two-round); 2 chunks; MaxLen 1; 1 opener |
| `TinyReauth` | limited | Spec | Reauthentication allowed: login after 001, account change a1→a2, a failed reauthentication that logs out (901), logout by other means then login again, 903 before 900 | Reauth "full", ClientReauth; accounts a1,a2; 2 openers; 1 env event |
| `TinyS1` | limited | Spec | S1 server: 907 for every AUTHENTICATE line after login, 904 for an unauthenticated opener after 001 (D8) | as TinyReauth, Reauth "none" |
| `TinyNotify` | limited | Spec | cap-notify: sasl absent then NEW sasl=list, NEW with a new list while offered, DEL mid-exchange, silent mechanism changes (stale lists), 908 | Mechs P,E; 2 openers; 2 REQs; 2 env events; SilentChange; Send908 |
| `TinyEnv` | limited | EnvSpec | As TinyMechs with server fairness only: safety and `OwedSent` | TinyMechs |
| `TinySame` | limited, own list | Spec | Reauth "same": a change of account refused with 907 at the verdict (D9; open question Q4, so kept apart) | as TinyReauth, Reauth "same" |
| `Reference` | **comprehensive, not now** | Spec | Everything together | Mechs P,S,X; 2 chunks; MaxLen 2; 3 openers; 2 REQs; 2 env events; Reauth "full"; every switch on except PickListed |
| `RefSafety` | **comprehensive, not now** | EnvSpec | Reference, safety only, with `VIEW SafetyView` | Reference |
| `RefNone` | **comprehensive, not now** | Spec | Reference with Reauth "none" | Reference |

Every witness config is limited. Each checks one `W_*` invariant, which should FAIL: a counterexample shows the feature is reached.

| Witness | Base | What its counterexample shows |
| --- | --- | --- |
| `W_LoggedIn` | TinyMechs | a login, then 001 |
| `W_Retry908` | TinyMechs | 908 for one mechanism, then success with another |
| `W_MultiChunk` | TinyChunks | the server reassembles a response of two or more lines |
| `W_ExactPlus` | TinyChunks | `+` after an exactly-400-byte chunk |
| `W_Limit` | TinyChunks | the server's length limit ends an exchange |
| `W_TwoRound` | TinyChunks | a SCRAM-shaped success |
| `W_ChalChunked` | TinyChunks | the client reassembles a chunked challenge |
| `W_AbortMid` | TinyChunks | `AUTHENTICATE *` between chunks |
| `W_AccountChange` | TinyReauth | the account moves a1 → a2 by reauthentication |
| `W_PostReg` | TinyReauth | a success after 001 |
| `W_FailLogout` | TinyReauth | a failed reauthentication logs out (901) |
| `W_Relogin` | TinyReauth | 901, then logged in again |
| `W_903First` | TinyReauth | a 903 sent before its 900 |
| `W_Late907` | TinyS1 | 907 after a login |
| `W_PostRegErr` | TinyS1 | an unauthenticated opener after 001 gets 904 |
| `W_NewList` | TinyNotify | NEW sasl=<new list> while sasl is offered |
| `W_NewThenAuth` | TinyNotify | sasl absent at LS, NEW sasl, REQ, login |
| `W_DelMid` | TinyNotify | DEL of sasl during an exchange |
| `W_StaleList` | TinyNotify | an opener of a listed mechanism the server no longer supports |
| `W_Refuse907` | TinySame | a change of account refused with 907 |

### Commands

From `model/`, with `tla2tools.jar` at hand (`TLA` below is its path). Use `-workers` to suit the machine.

Limited (now):

    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinyMechs.cfg  SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinyChunks.cfg SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinyReauth.cfg SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinyS1.cfg     SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinyNotify.cfg SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinyEnv.cfg    SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config TinySame.cfg   SpecSasl.tla

Witnesses (limited; each should report `Invariant W_x is violated`):

    for W in W_LoggedIn W_Retry908 W_MultiChunk W_ExactPlus W_Limit W_TwoRound \
             W_ChalChunked W_AbortMid W_AccountChange W_PostReg W_FailLogout W_Relogin \
             W_903First W_Late907 W_PostRegErr W_NewList W_NewThenAuth W_DelMid \
             W_StaleList W_Refuse907; do
      java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config $W.cfg SpecSasl.tla
    done

Mutants (limited; from `model/mutants/`, after `python3 make-mutants.py`; each should report a violation):

    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config MU_EarlyVerdict.cfg    MU_EarlyVerdict.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config MU_NoPlusAfter400.cfg  MU_NoPlusAfter400.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config MU_Chunk401.cfg        MU_Chunk401.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config MU_KeepAfterDel.cfg    MU_KeepAfterDel.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config MU_SrvKeepAfterDel.cfg MU_SrvKeepAfterDel.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config MU_ChangeOn907.cfg     MU_ChangeOn907.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config MU_No907.cfg           MU_No907.tla

Comprehensive (**later, not now**):

    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config Reference.cfg SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config RefSafety.cfg SpecSasl.tla
    java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config RefNone.cfg   SpecSasl.tla

## Mutants (expected results, not yet run)

| Mutant | Base config | Change | Expected to be caught by |
| --- | --- | --- | --- |
| `MU_EarlyVerdict` | TinyChunks | The server treats an exactly-400-byte chunk as the end of the response, so it can send 900/903 before the last line. | `RuleVerdictAfterLast` |
| `MU_NoPlusAfter400` | TinyChunks | The client sends no `+` after a response that is an exact multiple of 400 bytes (chunking off by one). | `RuleClientFraming` |
| `MU_Chunk401` | TinyChunks | The client sends the last 400-byte chunk and its `+` as one over-long line. | `RuleClientLineLen` |
| `MU_KeepAfterDel` | TinyNotify | The client keeps its exchange after DEL sasl, and keeps sending. | `RuleClientAuthOnlyEnabled` |
| `MU_SrvKeepAfterDel` | TinyNotify | The server keeps the exchange after sending DEL sasl. | `DelCancels` |
| `MU_ChangeOn907` | TinyS1 | The server logs the client out in the step that sends 907. | `Rule907NoChange` (`RuleAccountNotified` also forbids it) |
| `MU_No907` | TinyS1 | An S1 server lets an authenticated client authenticate again. | `Rule907` |

TLC stops at the first violation it finds. A mutant that is caught first by a different property from the one listed still counts as caught; record which property it was. Each unmutated base config is expected to pass.
