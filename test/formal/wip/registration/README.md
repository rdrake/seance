# Registration spec model (v0)

This is the rest of connection registration, spec-first, the same way as `../sasl/`. It covers:
- PASS;
- a server's PING cookie;
- 433 during registration;
- a registration timeout;
- metadata set before registration (`draft/metadata-2` `before-connect`), against CAP END and the burst.

Files:
- `RULES.md`: the rules, with sources and tags (MUST / SHOULD / convention).
- `DECISIONS.md`: readings D1-D8 and open questions Q1-Q5.
- `model/SpecReg.tla`: the model.
- `model/make-configs.py`: the configs.
- `model/mutants/make-mutants.py`: the mutants.
- `traces/`: live recordings from nefarious2 and Ergo.

Every file parses with SANY. **Nothing has been model checked yet.**

## Configs

All of them use `CHECK_DEADLOCK FALSE`. The invariants are `TypeOK` and the `Rule*` state invariants. The properties are the three `Rule*` action properties, `PingsAnswered` and `Registers`.

| Config | Run | What it exercises |
| --- | --- | --- |
| `TinyNick` | limited | 433 for n1, then n2; a 433 after CAP END |
| `TinyPass` | limited | PASS needed; client holds none, right or wrong; 464, ERROR or both |
| `TinyCookie` | limited | cookie PING and PONG before 001 |
| `TinyMeta` | limited | before-connect: METADATA * SET or nothing; the burst batch, empty or with the key; SET after CAP END |
| `TinyTimeout` | limited | the only nick is taken; the server ends the registration |
| `TinyMetaNick` | limited | metadata x 433 |
| `TinyMetaCookie` | limited | metadata x cookie |
| `Reference` | **comprehensive, not now** | everything together |

## Witnesses (limited; each should report `Invariant W_x is violated`)

| Witness | Base | Counterexample shows |
| --- | --- | --- |
| `W_433Then001` | TinyNick | 433, then registered |
| `W_EndThen433` | TinyNick | a 433 after the client's CAP END |
| `W_CookieThen001` | TinyCookie | PING, PONG, 001 |
| `W_MetaKV` | TinyMeta | the key in the burst batch |
| `W_EmptyBatch` | TinyMeta | an empty burst batch |
| `W_MetaAfterEnd` | TinyMeta | METADATA sent after CAP END, before 001 |
| `W_Timeout` | TinyTimeout | ERROR with no 001 and no 464 |
| `W_PassRefused` | TinyPass | 464 |
| `W_Refused464Only` | TinyPass | refused with 464 alone, connection left open |
| `W_MetaDropped` | TinyMetaNoBatch | a key acknowledged before 001, then dropped because batch was refused (D9) |

## Mutants (expected results, not yet run)

Each line is: mutant (base config): what it changes → the property expected to catch it.

- `MU_PassLate` (TinyPass): PASS after NICK and USER → `RulePassBeforeLatter`
- `MU_PongWrong` (TinyCookie): PONG with another token → `RulePongToken` (`Registers` fails too)
- `MU_MetaNick` (TinyMetaNick): METADATA aimed at the requested nick before 001 → `RuleMetaStar`
- `MU_NoEmptyBatch` (TinyMeta): no batch when nothing is set → `RuleMetaBatch`
- `MU_BatchAfterMotd` (TinyMeta): batch after 376 → `RuleMetaBatch`
- `MU_DropPreReg` (TinyMeta): batch without the key set before 001 → `RuleMetaCarries`
- `MU_BurstBefore001` (TinyMeta): batch before 001 → `RuleBurstAfter001`
- `MU_NickOn433` (TinyNick): server takes the nick it refused → `RuleNickIgnoredOn433`
- `MU_WelcomeOnEnd` (TinyNick): client counts itself registered at CAP END → `RuleWelcomedBy001`
- `MU_WelcomeBadPass` (TinyPass): 001 without the right password → `RulePassGate`
- `MU_SilentRefusal` (TinyPass): refusal with neither 464 nor ERROR → `RulePassRefusalSaid`
- `MU_NoCookieGate` (TinyCookie): 001 before the PONG → `RuleCookieGate`
- `MU_SpeakAfterError` (TinyTimeout): server answers after ERROR → `RuleNothingAfterError`
- `MU_TrustDropped` (TinyMetaNoBatch): client counts a key as held without batch → `RuleHeldIsKept`

## Commands

Run these from `model/`.

Limited:

    for C in TinyNick TinyPass TinyCookie TinyMeta TinyTimeout TinyMetaNick TinyMetaCookie TinyMetaNoBatch \
             W_433Then001 W_EndThen433 W_CookieThen001 W_MetaKV W_EmptyBatch W_MetaAfterEnd \
             W_Timeout W_PassRefused W_Refused464Only W_MetaDropped; do
      java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config $C.cfg SpecReg.tla
    done

Mutants, from `model/mutants/`:

    for M in MU_*.tla; do M=${M%.tla}
      java -XX:+UseParallelGC -cp $TLA tlc2.TLC -workers 8 -config $M.cfg $M.tla
    done

Comprehensive, later: `Reference.cfg`.
