# Registration model v0: limited run results

TLC `-workers 1`, model at b15df7089 (the configs bind `NickList <- NL1/NL2`;
TLC configs cannot write a tuple). Each limited config checks the 10 invariants
and 5 properties make-configs.py lists. Reference (comprehensive) is not run yet.

All 7 configs pass, all 9 witnesses are reached (violated, as intended), and all
13 mutants are caught by the property their docstring names.

```
TinyNick: PASS 146 distinct states found
TinyPass: PASS 139 distinct states found
TinyCookie: PASS 678 distinct states found
TinyMeta: PASS 948 distinct states found
TinyTimeout: PASS 129 distinct states found
TinyMetaNick: PASS 5454 distinct states found
TinyMetaCookie: PASS 22911 distinct states found
W_433Then001: Error: Invariant W_433Then001 is violated. 112 distinct states found
W_EndThen433: Error: Invariant W_EndThen433 is violated. 30 distinct states found
W_CookieThen001: Error: Invariant W_CookieThen001 is violated. 560 distinct states found
W_MetaKV: Error: Invariant W_MetaKV is violated. 731 distinct states found
W_EmptyBatch: Error: Invariant W_EmptyBatch is violated. 462 distinct states found
W_MetaAfterEnd: Error: Invariant W_MetaAfterEnd is violated. 68 distinct states found
W_Timeout: Error: Invariant W_Timeout is violated. 5 distinct states found
W_PassRefused: Error: Invariant W_PassRefused is violated. 102 distinct states found
W_Refused464Only: Error: Invariant W_Refused464Only is violated. 92 distinct states found
MU_BatchAfterMotd: Error: Invariant RuleMetaBatch is violated.
MU_BurstBefore001: Error: Invariant RuleBurstAfter001 is violated.
MU_DropPreReg: Error: Invariant RuleMetaCarries is violated.
MU_MetaNick: Error: Invariant RuleMetaStar is violated.
MU_NickOn433: Error: Action property RuleNickIgnoredOn433 is violated.
MU_NoCookieGate: Error: Invariant RuleCookieGate is violated.
MU_NoEmptyBatch: Error: Invariant RuleMetaBatch is violated.
MU_PassLate: Error: Invariant RulePassBeforeLatter is violated.
MU_PongWrong: Error: Invariant RulePongToken is violated.
MU_SilentRefusal: Error: Action property RulePassRefusalSaid is violated.
MU_SpeakAfterError: Error: Action property RuleNothingAfterError is violated.
MU_WelcomeBadPass: Error: Invariant RulePassGate is violated.
MU_WelcomeOnEnd: Error: Invariant RuleWelcomedBy001 is violated.

[exited with code 0]
```
