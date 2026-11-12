# Registration: rules and sources

Sources, pinned:
- **MI**: ircdocs/modern-irc 8f4c3cc, `index.md`, "Connection Registration".
- **MC**: modern-irc 8f4c3cc, `_includes/messages/connection.md`.
- **MA**: modern-irc 8f4c3cc, `_includes/modern-appendix.md`, the numerics.
- **MD**: ircv3-specifications 9ff58d1, `extensions/metadata.md`.
- **CN**: ircv3-specifications 9ff58d1, `extensions/capability-negotiation.md`, via the handshake model (hs, `../spec/`).

Each rule is tagged by its source:
- **MUST** or **SHOULD**: spec text, either IRCv3 or Modern IRC's normative words.
- **convention**: a behaviour that no text requires, which servers implement.

Only MUST and SHOULD rules are `Rule*` properties of every server. A convention is a switch with witnesses, and its rule is checked only for the server type it describes (DECISIONS D2, D4).

| Rule | Side | Tag | Source | Property |
| --- | --- | --- | --- | --- |
| PASS precedes the latter of NICK and USER | client | MUST | MI:103 | `RulePassBeforeLatter` |
| Only the last PASS counts; PASS after registration gets 462 | server | (MC:30, MA:941) | MC:30 | model (D8) |
| A wrong or missing password: 464 SHOULD, ERROR MAY, at least one MUST | server | MUST | MC:32 | `RulePassRefusalSaid` |
| No registration without the right password, where one is required | server | MUST | MC:30, MA:947 | `RulePassGate` |
| A NICK whose nick is in use gets 433 and is ignored | server | SHOULD | MC:53, MA:895 | `RuleNickIgnoredOn433` |
| PING during registration must be answered with a PONG carrying the same token | client | MUST | MC:135, MC:138, MI:115 | `RulePongToken`, `PingsAnswered` |
| A server may send PING during registration and wait for its PONG | server | convention | MI:115 ("some servers") | switch `Cookie`; `RuleCookieGate` for that server |
| A registration that does not complete may be ended | server | convention | (none; MI:113 is about lookups) | switch `Timeout` |
| ERROR reports a fatal error before the connection ends | server | MUST | MC:230-232 | `RuleNothingAfterError` |
| 001 first; the burst follows; MOTD or 422 closes it | server | MUST | MI:117-126 | `RuleBurstAfter001` |
| The client is registered by 001 and takes its nick from it | client | SHOULD | MI:129 | `RuleWelcomedBy001` |
| METADATA during registration only with `before-connect` | client | MAY | MD:90, MD:176 | model (D5) |
| METADATA during registration targets `*`, even after NICK | client | MUST | MD:176 | `RuleMetaStar` |
| With metadata negotiated, a `metadata` batch for the client's own nick in the burst, before 376/422; empty if nothing is set | server | MUST | MD:113, MD:140 | `RuleMetaBatch` |
| That batch holds what the client set before registration | server | (descriptive) | MD:140 | `RuleMetaCarries` (D6) |
| CAP LS suspends registration; CAP END resumes it | both | | MI:101, CN | model (D1) |
| A client with a usable password and a free nick ends up registered (no timeout) | both | liveness | MI:86-111 | `Registers` |
