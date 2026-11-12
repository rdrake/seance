# IRCv3 rules encoded in `model/SpecSasl.tla`

Source: `ircv3/ircv3-specifications` at commit `9ff58d1342af67aff88753388f568542820c4bfe` (2026-08-03), the same checkout as `../spec/RULES.md`.
Files: `extensions/sasl-3.1.md` (S1), `extensions/sasl-3.2.md` (S2), `extensions/capability-negotiation.md` (CN).
The repository has no core numerics document at this commit; the SASL numerics are defined in S1:197-236 (NUM below).

Rule IDs reuse the handshake model's (`../spec/RULES.md`) where the rule is the same; a letter suffix splits a handshake rule that this model encodes in parts; new rules get new numbers.
"hs" means the handshake model; "hs D3" is its decision D3, "D3" alone is a decision in `DECISIONS.md` here.

Each Model cell starts with exactly one encoding word, the primary one:
**guard** (the spec role cannot break it), **prop** (checked as an invariant or property; a guard often backs it),
**switch** (a SHOULD/MAY choice exposed as a CONSTANT), **free** (left nondeterministic because the spec permits it),
or **out** (outside this model; see the header of `SpecSasl.tla`).

## SASL 3.1 (S1)

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| S1-1 | S1:31-32 | MUST | The client enables sasl before using AUTHENTICATE. | prop `RuleClientAuthOnlyEnabled`, over what the client has READ (last ACK vs DEL; hs D1); guard on `CMech`. |
| S1-2 | S1:36-37 | MUST | AUTHENTICATE is used before registration completes, with sasl enabled. | switch `ClientReauth`: FALSE keeps S1 (no opener after 001); TRUE is S2-6a (D7). prop `RuleClientPostReg`. |
| S1-3 | S1:37-39 | RECOMMENDED | CAP END only when SASL is complete or needs aborting. | guard: the model client sends END only with no exchange running. END mid-exchange is the handshake's (hs D16). |
| S1-4 | S1:39-40 | SHOULD | Clients are prepared for timeouts at any time. | free: `SrvTimeout` may end an exchange at any point (before the challenge, between chunks, while waiting), and the client reads its 904 as the end in every exchange state. Not fair (D15). `CGiveUp` is a separate local-abandonment assumption, not this rule (D19). |
| S1-5 | S1:45-48 | — / MAY | If agent association fails, 904 and state unchanged; the client MAY try another mechanism. | free: an opener for a supported mechanism may get 904; the account is unchanged; the client may open again (`MaxAtt`). |
| S1-6 | S1:48-51 | — | Otherwise the server sends the initial response; `AUTHENTICATE +` for client-first. | guard: `SrvChallenge`, a separate step (hs D23). Every mechanism is client-first; server-first is out (D2). |
| S1-7 | S1:56-57 | MAY | The server may intersperse other messages between the AUTHENTICATE lines of a set. | free: challenge chunks go out one per step (`SrvChalLine`); NEW/DEL/901/001 may come between. |
| S1-8 | S1:58-60 | — | Responses are Base64, split into 400-byte chunks, one AUTHENTICATE line each. | prop `RuleClientLineLen` (no client line over 400 bytes). Base64 and byte contents: out (D1). |
| S1-8b | S1:60-63 | must | An empty response is `AUTHENTICATE +`; a last chunk of exactly 400 bytes is followed by `AUTHENTICATE +`. | prop `RuleClientSendsPayload` with `ClientPayloadDone` (v0.1: each line sent is the next line of the reference chunking of the payload the client chose, and a finished response sent all of it). The weak form is `RuleClientFraming` (a finished response ends in a short chunk or `+`). Server side: `RuleVerdictAfterLast` (reassembly), guard `Lines` and prop `RuleSrvChalFramed` for challenges. |
| S1-15 | S1:64 | MAY | The server may limit the total length of a response. | switch `MaxLen`; exceeding it ends the exchange with 904 (v0.1; D6). |
| S1-9 | S1:69-70 | MUST | After a non-empty final server challenge the client still sends an empty response. | prop `RuleClientEmptyFinal` (v0.1: on the lines actually SENT after the final challenge, each must be `+`); `TwoRound` mechanisms have that shape (D2). |
| S1-10 | S1:72-73 | — | `AUTHENTICATE *` aborts; the server sends 906. | prop `Rule906`. The client may abort at any time, also between chunks (`CAbort`). `*` with no exchange: hs D10 (906 or nothing). |
| S1-11 | S1:77-78 | — / MAY | Failure gives 904 or 905; the client MAY retry from `AUTHENTICATE <mechanism>`. | free: failures send 902 or 904 (decision step), 904 (limit, D6), 905 (over-long line); the client may retry. 902/904/905 kept apart (hs D6 folded them). |
| S1-12 | S1:79 | — | Success gives 900 and 903. | prop `SuccAccounting` (one of each per success), in either order (hs D20); the account rides on the 900 (D3). |
| S1-13 | S1:81-82 | MUST | AUTHENTICATE after a successful login is rejected with 907. | prop `Rule907` with `Reauth = "none"`: every AUTHENTICATE line read outside an exchange after a login gets 907 (hs D3, hs D21). |
| S1-14 | S1:84-87 | SHOULD | Registration completing during SASL: abort with 906, register unauthenticated. | guard: the SHOULD branch only (906 now, 001 owed); the other branch is the handshake's `AbortOnReg`. |
| S1-16 | S1:89-90 | — | S1 does not specify AUTHENTICATE in registered state. | switch `ClientReauth` / `Reauth` (S2 specifies it; D7, D8). |
| S1-17 | S1:141 | (example) | Servers may add a source to AUTHENTICATE lines. | out (wire format). |
| S1-18 | S1:240-242 | (errata) | Aborts get 906, not 904. | prop `Rule906`. |

## Numerics (NUM, S1:197-236)

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| NUM-900 | S1:199-201 | — | 900 is sent when the account name is set (by SASL or otherwise); it carries the account. | prop `RuleAccountNotified`: the server's account changes to `a` exactly in a step that sends `900 a`, and a 900 says what the account now is (D3). |
| NUM-901 | S1:203-205 | — | 901 is sent when the account name is unset. | prop `RuleAccountNotified`; sent on logout by other means (`EnvChange`) and on a failed reauth that logs out (D10). |
| NUM-902 | S1:207-209 | — | 902: the account is locked or otherwise unavailable. | free: a failure verdict (D16). |
| NUM-903 | S1:211-213 | — | 903: authentication finished successfully; usually with 900. | prop `SuccAccounting`. |
| NUM-904 | S1:215-217 | — | 904: failure for invalid credentials or other errors not explicitly covered by another numeric. | free: association failure, unsupported mechanism, verdict, timeout, the total-length limit (D6), refused post-registration opener (D8). |
| NUM-905 | S1:219-221 | — | 905: the credentials are valid, but the client's AUTHENTICATE parameter was longer than 400 bytes. | guard: a LONG line in a response gets 905. Credential validity is abstracted away (D6). The model client never sends a LONG line (prop `RuleClientLineLen`), so 905 is reached only through a non-conforming client. |
| NUM-906 | S1:223-225 | — | 906: aborted by `AUTHENTICATE *`. | prop `Rule906`. |
| NUM-907 | S1:227-229 | — | 907: the client tries to initiate SASL after it already finished successfully. | prop `Rule907` (S1 server) and `Rule907NoChange` (a 907 changes no account; S2:64-65). `Reauth = "same"` also sends it at decision time (D9). |
| NUM-908 | S1:231-233 | MAY | 908 may answer an opener naming an unsupported mechanism, listing the supported ones. | switch `Send908`; prop `Rule908` (only for an unsupported mechanism; lists the set supported when that opener was read). 904 comes in a later step, or with `AnyOrder908` before it (D4, R2). |
| NUM-txt | S1:235-236 | — | The final text parameter is not machine-parsed. | out. |

## SASL 3.2 (S2)

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| S2-1 | S2:27-28 | MUST NOT | Do not advertise sasl if the auth layer is unavailable. | guard: `srv.offered` is the auth layer; LS/NEW list sasl only then. TypeOK checks `enabled => offered`. |
| S2-2 | S2:30-31 | MUST | NAK any sasl REQ while the auth layer is unavailable. | prop `RuleNakIfDown`. |
| S2-3 | S2:33-34 | MUST / MAY | A client requiring pre-authentication that cannot obtain sasl disconnects. | out (hs D4). |
| S2-4a | S2:38-39 | SHOULD | Advertise the available mechanisms as the sasl value in CAP LS. | switch `AdvertValue` (also for NEW, CN-26). When a value is sent, the model's policy is that it equals the supported set exactly; `RuleValueIsMechs` checks that policy, which is stronger than any MUST (D18). |
| S2-4b | S2:41-42 | MUST | The value, if present, is a comma-separated list of mechanisms. | out: a syntax rule; the model has no syntax (D18). (v0 wrongly attributed `RuleValueIsMechs` here.) |
| S2-4c | S2:44-46 | MUST | Clients handle a sasl cap with no value. | guard: with no value the client picks among its own mechanisms (D5). Exercised by `TinyNoValue` / `W_NoValueLogin` (v0.1). |
| S2-4d | S2:48-49 | MUST | Clients handle lists naming mechanisms they do not understand. | prop `RuleClientMech` (only implemented mechanisms are opened); `Mechs` includes ones outside `CliMechs`. |
| S2-5 | S2:53-58 | MUST | sasl availability changes are announced with cap-notify. | guard: `EnvChange` sends NEW/DEL in the step that changes `offered`. |
| S2-6a | S2:62-63 | SHOULD | Allow reauthentication, authenticated or not, at any time. | switch `Reauth` ("none" / "full" / "same"); client side `ClientReauth` (D7, D8, D9). |
| S2-6b | S2:63-65 | MUST | If reauthentication is unavailable, send an appropriate error (907 if changing accounts is unsupported). | prop `RuleReauthRefused` (v0.1: under "none", 907 after a login and 904 after 001, no exchange opened, no account change; D8), with `Rule907NoChange`. `RuleOpenerAnswered` stays as a weaker progress check. "same" refuses at the verdict (D9). |
| S2-7 | S2:67-69 | MAY / MUST | The server may disconnect after failed auth, reason first. | prop `RuleFailCloseReason`; `SrvFailClose` only after every owed line (hs D19). |
| S2-8a | S2:73-75 | SHOULD | Pick a mechanism from the CAP LS list, after requesting sasl. | switch `PickListed`; prop `RuleClientMech` (D5). |
| S2-8b | S2:77-78 | MUST | Handle a picked mechanism turning out to be unavailable. | prop `ExchangeEnds` (liveness); witnesses `W_StaleList`, `W_Retry908` (D11). |
| S2-9 | S2:22-23 | — | (intro) sasl-3.2 adds reauthentication if authentication is lost, via cap-notify. | free: logout by other means (901) and DEL/NEW of sasl are environment events; the client may log in again (`W_Relogin`, `W_NewThenAuth`). |

## Capability negotiation (CN), the parts used

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| CN-3 | CN:69-71 | MUST | After CAP LS, registration waits for CAP END. | guard: `SrvRegister` needs END (the rest of the hold is the handshake's). |
| CN-4 | CN:158-160 | MUST | Lists are processed left to right; a value sent twice: last wins. | out (one cap, one value per line). |
| CN-5 | CN:180 | MUST | The server accepts CAP at any time. | guard: REQ is handled before and after 001. |
| CN-8 | CN:270-271 | MAY / MUST NOT | Values only to 302 clients, only in LS and NEW. | prop `RuleValueIsMechs` (ACK/NAK/DEL carry no value). The client is always 302. |
| CN-11 | CN:349 | must | A REQ is accepted or rejected as a whole. | out (sasl alone; hs). |
| CN-15 | CN:387-388 | MUST NOT | A NAK changes nothing. | guard (`SrvReq`). |
| CN-16 | CN:404-405 | MUST | END after registration is ignored. | guard. |
| CN-17 | CN:413-414, 447-448 | MUST ONLY | NEW/DEL only to 302 / cap-notify clients. | guard: only after LS was handled (`srv.lsSeen`). |
| CN-18 | CN:416-418 | SHOULD | After NEW, REQ the caps wanted. | free (`CReq`, bounded by `MaxReq`). |
| CN-25 | CN:420, 440-443 | — | NEW can also update the value of an existing cap. | free: `EnvChange` may send `NEW sasl=<new list>` while sasl is offered; sasl stays enabled (D11). |
| CN-26 | CN:426-428 | SHOULD | NEW lists caps with values, as LS does. | switch `AdvertValue` (same switch as S2-4a). |
| CN-19 | CN:450-452 | MUST | After DEL the client treats the cap as cancelled and unavailable. | prop `RuleClientAuthOnlyEnabled` (no AUTHENTICATE line after a DEL until a new ACK); the client also drops its exchange and its list (D11, D13). |
| CN-20 | CN:452-453 | SHOULD NOT | No `CAP REQ -cap` for DELed caps. | out (no removals). |
| CN-21 | CN:456-457 | MUST | After sending DEL, the server cancels cap-specific behaviour. | prop `DelCancels` (v0.1: no exchange, challenge, owed 903, 908 or 904 survives a DEL) and `RuleDelCancelsOutput` (nothing SASL-specific is sent unprompted while sasl is not enabled); silent, as hs D5. An owed 900 survives (D13, R4). |
| CN-22 | CN:459-460 | MUST | Clients handle any cap being removed gracefully. | prop `ExchangeEnds` and `EnabledAgrees`/`MechListAgrees` at quiet points. |
| CN-23 | CN:475-479 | MUST | CAP LS 302 enables cap-notify implicitly. | guard (assumed; NEW/DEL always sent). |
| CN-24 | CN:491-492 | MUST | With cap-notify the server announces all new and removed caps. | guard for sasl's availability; a change of the mechanism set alone may be silent (switch `SilentChange`, D11). |

## Liveness and design properties

| Name | Spec | Basis |
| --- | --- | --- |
| `ExchangeEnds` | `Spec` | S1:72-79, S2:77-78, CN:459-460: the client's exchange state is eventually left, by a server line (902-907, DEL, ERROR) or by its own give-up or quit. It does not show who ended it (D15). |
| `RuleExitByServerLine` with `ExchangeEnds` | `Spec`, `TinyNoAbandon` | v0.1: with `NoAbandon` (no abort, give-up or quit), the client leaves an exchange only by reading a server line (D15). |
| `OwedEventuallyClears` | `Spec`, `EnvSpec` | v0.1 rename of `OwedSent`: owed obligations (challenge, 900/903, 908/904, 001 after 906) eventually clear, by being sent or by a DEL cancelling them, unless the client quits. It does not show that each line was sent; `SuccAccounting` does that for 900/903. |
| `AccountAgrees`, `EnabledAgrees`, `MechListAgrees` | invariants | design: at a quiet point both ends agree on the account, on sasl, and (without silent changes) on the mechanism list. `MechListAgrees` is live in `TinyNotifyList` (v0.1). |

## Counts (primary encoding word of each rule row above; the liveness and design rows are excluded)

| Section | guard | prop | switch | free | out | total |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | 3 | 8 | 3 | 4 | 1 | 19 |
| NUM | 1 | 5 | 1 | 2 | 1 | 10 |
| S2 | 3 | 5 | 3 | 1 | 2 | 14 |
| CN | 7 | 4 | 1 | 2 | 3 | 17 |
| **all** | **14** | **22** | **8** | **9** | **7** | **60** |
