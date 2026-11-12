# Interpretation decisions for the SASL spec model

These are the places where the spec text leaves a choice, contradicts itself, or says nothing. Each entry quotes the text, says what `model/SpecSasl.tla` does, and gives the reason.
Rule IDs refer to `RULES.md`. "hs Dn" is decision Dn of the handshake model (`../spec/DECISIONS.md`); where a reading is the same, this model reuses it and cites it rather than deciding again.
Questions marked **Open** are for Richard to settle; the model's choice stands until then.

Inherited from the handshake model unchanged:
- hs D1 (enabled means a received ACK)
- hs D3 (907 when reauthentication is off)
- hs D5 (DEL cancels silently)
- hs D7 (opener without sasl)
- hs D10 (`*` with no exchange)
- hs D11 (timeouts)
- hs D12 (no exchange correlation)
- hs D19 (send boundary)
- hs D20 (900/903 in either order)
- hs D21 (907 for every AUTHENTICATE line)
- hs D23 (challenge in its own step)
- hs D27 (abort in answer to a challenge)

Extended or changed here: hs D2 (scope, D7), hs D6 (failure numerics, D16), and hs D24 (stray data, D12).

**v0.1** (after an independent review of v0, 16 findings) changed D3, D4, D6, D13, D14 and D15, and added D17 (exploration restrictions R1-R4), D18 (the exact-advertisement policy) and D19 (local abandonment). The README's "v0.1 changes" maps each finding to its change.

## D1. Payloads are counted in chunks, the same way in both directions

> "A set of regular AUTHENTICATE messages transmits a response from client to server or vice versa. ... The response is encoded in Base64 ..., then split to 400-byte chunks, and each chunk is sent as a separate `AUTHENTICATE` command. Empty (zero-length) responses are sent as `AUTHENTICATE +`. If the last chunk was exactly 400 bytes long, it must also be followed by `AUTHENTICATE +` to signal end of response." (S1:55-63)

**Model:** a payload is `[n, full]`. If `n = 0` it is empty. Otherwise it is `n` chunks, and `full` means the last one is exactly 400 bytes. On the wire there are four kinds of line:
- FULL: exactly 400 bytes;
- SHORT: 1 to 399 bytes;
- PLUS: `+`;
- LONG: over 400 bytes.

`Lines(p)` gives the lines of a payload:
- `<<PLUS>>` when it is empty;
- n FULL, then PLUS, when the last chunk is exactly 400 bytes;
- n-1 FULL, then SHORT, otherwise.

Both sides reassemble: a FULL line means more is coming, and SHORT or PLUS ends the payload. "vice versa" makes the rule apply to server challenges too.

**Why:** the Base64 content and exact byte counts carry no control state; only line boundaries and the 400-byte edge do.

## D2. Mechanism shapes

> "If the chosen mechanism is client-first, the server sends an empty response (`AUTHENTICATE +`...)." (S1:50-51)
> "If the mechanism finishes with the server sending a non-empty challenge (such as in SCRAM), clients MUST still send an empty response." (S1:69-70)

**Model:** every mechanism is client-first. A mechanism outside `TwoRound` (PLAIN- or EXTERNAL-shaped) runs `+`, then the response, then the verdict. A `TwoRound` mechanism runs `+`, then a response, then a non-empty final challenge (possibly in chunks), then an empty response, then the verdict. This is the smallest shape that includes S1:69-70 and server-side chunking. Server-first mechanisms, where the initial response is not empty (S1:48-49), are out of scope.

## D3. The account changes with the 900; 900 and 903 may come in either order

> "`900` aka `RPL_LOGGEDIN` is sent when the user's account name is set (whether by SASL or otherwise)." (S1:199)
> "`901` aka `RPL_LOGGEDOUT` is sent when the user's account name is unset" (S1:203)
> "If authentication is successful, a 900 and 903 numeric will be sent." (S1:79)

**Model:** the server's `account` changes only in the step that sends `900 <account>` or `901`, so each line reports the state that took effect with it (hs D19's send boundary).

A success either:
- sends `900 a` now and owes the 903; or
- sends 903 now and owes `900 a`, in which case the account changes when that 900 goes out.

This keeps hs D20's freedom of order (`W_903First`). `RuleAccountNotified` checks both directions: no silent account change, and no 900 or 901 that misreports the account.

**v0.1:** "the account changes in the same step as its 900" is a choice the text does not impose. S1:199 ties the 900 to the change, not to the same instant. It is now labelled restriction **R1** (D17). With switch `AcctEarly`, a 903-first success may set the account at the verdict while its 900 is still owed (`W_AcctEarly`). `RuleAccountNotified` then also accepts an account change whose 900 is owed in that same step.

## D4. 908, and the 904 after it

> "`908` aka `RPL_SASLMECHS` MAY be sent in reply to an `AUTHENTICATE` command which requests an unsupported mechanism." (S1:231)
> "If this fails, a 904 numeric will be sent and the session state remains unchanged; the client MAY try another mechanism." (S1:46-48)

The text never says whether an opener that names an unsupported mechanism also gets 904, nor in which order.

**Model:**
- An unsupported mechanism always ends the exchange with 904, read as a failed association (S1:46-48).
- With `Send908`, the 908 comes first. It lists the supported set (`Rule908`), and the 904 is owed and sent in a later step (hs v4 convention: no two numerics in one step).
- **v0.1:** "908 before 904" is restriction **R2** (D17): S1:231 orders nothing. With switch `AnyOrder908`, the 904 may come first, with the 908 owed after it. That 908 lists the set the opener met (`srv.l908`; `W_Late908`). The client reads a 908 outside an exchange as list information only.
- The client does not treat 908 as terminal. It replaces its mechanism list with the 908's and waits for the 904.
- The client may then retry with another mechanism (`W_Retry908`).

**Open (Q1):** may a server send 908 alone, with no 904? If it may, a client that waits for 904 waits for ever. Should a conforming client therefore treat 908 as the end of the exchange?

## D5. Choosing a mechanism

> "Clients SHOULD pick a mechanism present in the `CAP LS` reply" (S2:73-74); "Clients MUST handle the case when there is no value" (S2:44-46); "... one or more mechanisms they do not understand." (S2:48-49)

**Model:** the client opens only mechanisms it implements (`CliMechs`; `RuleClientMech`).

With `PickListed`, if its list has a value naming one of its own mechanisms, it picks from that list. Otherwise it picks any of its own:
- when there is no value;
- when the list names none of them;
- when `PickListed = FALSE`, which is how a mechanism outside the list, and so 908, is reached in `TinyMechs`.

"Present in the CAP LS reply" is read as "in the client's latest list", which includes a NEW or 908 list (D11).

## D6. 905 is per line; the total-length limit has no numeric

> "The server MAY place a limit on the total length of a response." (S1:64)
> "`905` ... the client-sent `AUTHENTICATE` command was too long (i.e. the parameter longer than 400 bytes)." (S1:219)

The two are different limits. Only the per-line one has a named numeric.

S1:219 also says "when credentials are valid". The model does not track whether the credentials are valid at the moment a line is too long, so that condition is abstracted away. An over-long line gets 905 whatever the credentials would have been.

**Model (v0.1):**
- A LONG line inside a response gets 905.
- A response that grows past `MaxLen` chunks, each line legal, ends the exchange with **904 only**: "other errors not explicitly mentioned" (S1:215). v0 also allowed 905 there as "the nearest named meaning". That reused 905 without its defined condition, so v0.1 drops it.

The model client never sends a LONG line (`RuleClientLineLen`). The spec's 905 is therefore reached only through a non-conforming client, such as the mutant `MU_Chunk401`.

**Open (Q2):** is 904 what S1:64's limit should produce? Or does the spec mean 905 to cover it too?

## D7. Client SASL after 001 (extends hs D2)

> "The AUTHENTICATE command MUST be used before registration is complete" (S1:36)
> "This document does not specify use of the AUTHENTICATE command in registered (person) state." (S1:89-90)
> "Servers SHOULD allow a client, authenticated or otherwise, to reauthenticate by sending a new `AUTHENTICATE` message at any time." (S2:62-63)

sasl-3.2 says it "updates" sasl-3.1 (S2:4-5). S1:89-90 leaves the registered state open, and S2:62-63 fills it.

**Model:** with switch `ClientReauth = TRUE`, the client may open an exchange after a login and after 001; with FALSE it keeps S1:36 (`RuleClientPostReg`). The handshake model scoped all of this out (hs D2). Here it is in scope.

## D8. A server that does not offer reauthentication (`Reauth = "none"`)

> "If reauthentication is not available, an error appropriate to the circumstances MUST be sent (for instance, `ERR_SASLALREADY` is appropriate if changing accounts is not supported)." (S2:63-65)

**Model:** this is hs D3's "Reauth FALSE":
- After a successful login, every AUTHENTICATE line that finds no exchange gets 907 (S1-13, hs D21).
- An unauthenticated client that opens after 001 gets 904: 907 would claim a login that never happened, and 904 is the catch-all failure (S1:215). `W_PostRegErr` reaches this.
- The server never stays silent (`RuleOpenerAnswered`, a progress check).
- **v0.1:** `RuleReauthRefused` checks the error itself. Under "none", an opener read with sasl enabled after a login gets 907, and after 001 without a login gets 904. The exchange does not open, and the account does not change. `RuleOpenerAnswered` accepted any output at all.

**Open (Q3):** is 904 the "appropriate error" for an unauthenticated client after registration, or should a server that cannot authenticate in registered state stop offering sasl after 001?

## D9. `Reauth = "same"`: reauthentication without changing account

S2:65 names 907 for "changing accounts is not supported". S1:227 defines 907 as the reply to an attempt "to initiate SASL authentication after it has already finished successfully". The opener does not name the account; only services know it, after the response.

**Model:** a third server value, `"same"`. Reauthentication runs normally. If services would log the client into a different account from the current one, the verdict is 907 and the account does not change (`Rule907NoChange`, `W_Refuse907`).

So this 907 comes at decision time, not as the reply to the opener. That is a reading S1:227's word "initiate" does not obviously support. It is kept to its own config (`TinySame`, in its own list), not mixed into the default limited runs.

**Open (Q4):** must a server that does not support account changes refuse at the opener with 907, before knowing the account? Or may it run the exchange and refuse at the end? If at the end, is 907 or 904 the right numeric?

## D10. A failed reauthentication and the existing login

> "If this fails, a 904 numeric will be sent and the session state remains unchanged" (S1:46-47), said of association failure. Nothing is said about a failed reauthentication after the exchange has run.

**Model:** a failed reauthentication (with `Reauth` other than "none") ends in one of two ways:
- the account is unchanged, with 902 or 904; or
- the client is logged out: 901 now and 904 owed (`W_FailLogout`).

Both are allowed. A client must therefore not assume its account survives a failed reauthentication, and must follow 900/901.

**Open (Q5):** does a failed reauthentication keep the old login?

## D11. What the client may assume about a mechanism list it got earlier

> "The NEW subcommand can also update the value of an existing capability." (CN:420), with the example `NEW :sasl=PLAIN` followed by `NEW :sasl=PLAIN,EXTERNAL` (CN:442-443).
> "the server MUST notify the client about all new capabilities and about existing capabilities that are no longer available" (CN:491-492)
> "Clients MUST handle the case when a mechanism they picked from the list turns out to be not available." (S2:77-78)

**Model:**
- The client's list is the newest of: the LS value, a NEW value, or a 908 list.
- A NEW of sasl while sasl is already offered is a value update. sasl stays enabled, and no new REQ is needed (`W_NewList`).
- A NEW without a value leaves the client with no list. A DEL voids the list.
- CN:491-492 obliges notification of caps appearing and disappearing, not of value changes. So with `SilentChange` the server's supported set may change with no NEW at all. A listed mechanism can then turn out to be unsupported (`W_StaleList`), which is the case S2:77-78 asks clients to handle.
- `MechListAgrees` (the client's list equals the server's set at quiet points) is checked only without `SilentChange`.
- An exchange already running is not affected by a list change: its association already exists.

In short, an earlier list is a hint, not a promise. A client may open a listed mechanism, but must handle 904 (with or without 908) and retry.

**Open (Q6):** must a server that changes its mechanism set send `NEW sasl=<list>` to cap-notify clients? CN:420 says "can", and CN:491-492 does not cover values. And does a value-update NEW leave the cap enabled, as the model assumes?

## D12. Lines that find no response (changes hs D24)

> "There are two forms of the AUTHENTICATE command: initial client message and later messages." (S1:42-43)

**Model:**
- An `AUTHENTICATE <mechanism>` line that arrives while an exchange is collecting a response is, on the wire, a data line. It is read as a short chunk, since a mechanism name is not exactly 400 bytes.
- A data line that arrives with no response being collected is ignored, or gets 907 after a login without reauthentication (hs D21). This includes a line arriving before the server's challenge has been fully sent.
- `*` with no exchange gets 906 or nothing (hs D10).

hs D24 also let a stray response open a new exchange. This model drops that branch, to keep the reassembly monitor (`RuleVerdictAfterLast`) exact. The handshake model still covers it.

## D13. DEL of sasl: the exchange, owed lines and the login

> "Servers MUST cancel any capability-specific behavior for a client after sending the `CAP DEL` message to the client." (CN:456-457)

**Model (v0.1; v0 kept every owed line, which CN:456-457 does not allow):**
- As hs D5, the exchange is dropped silently on both sides (`DelCancels`, `W_DelMid`), together with any challenge chunks not yet sent.
- **SASL-specific owed output is cancelled at the DEL:** the 903 of a decided success, the 908, and the 904 owed after a 908 or a 901. These are sasl-cap behaviour, and "having decided the exchange earlier" is no exception CN states. `DelCancels` now covers these obligations. `RuleDelCancelsOutput` checks that nothing SASL-specific (902-908, challenge lines) is sent while sasl is not enabled, except in reply to a line the server reads (hs D7, D21). `SuccAccounting` counts a 903 cancelled in a DEL step.
- **An owed 900 survives (restriction R4, D17).** S1:199 defines 900 as account notification "whether by SASL or otherwise". The account change itself was decided before the DEL, and the 900 reports account state, not the progress of a SASL exchange. Leaving it unsent would leave the client's view of its account wrong. This is the one exception, and it is a reading, not text.
- The login survives the DEL: an account is not sasl-cap behaviour.
- A client may therefore see a 900 with no 903 after a DEL. It must take its account from 900/901, and treat the exchange as ended by the DEL.

**Open (Q7):** may a server log the client out (901) because sasl was DELed? And may it send the owed 900, as here, or must that be cancelled too? S2:22-23 speaks of "reauthentication if authentication is lost via the cap-notify capability", which could be read either way.

## D14. Bound: the server reads AUTHENTICATE lines only once owed lines are out

This is not a reading of the spec but a bound on the model, stated here so it is not mistaken for one.

**Model:** while a 900, 903, 908, or a 904 owed after 908 or 901 is still unsent, the server leaves the next AUTHENTICATE line unread (`SRecv`'s guard). This is restriction **R3** (D17).

v0 said this "drops no behaviour of the lines themselves". That understated it. It removes every interleaving in which a new exchange (its opener, challenge, abort or verdict) overlaps owed output of the previous one. With reauthentication, account changes and DEL, those interleavings matter: for example, a reauth verdict and its 900 racing an owed 900 of the previous login. Those runs are **not explored** here. The handshake model (hs D20, `M2Owe`) covers the single-mechanism, no-account case. Relaxing R3 needs per-exchange owed queues and is left for a later version.

## D15. What "an exchange ends" means, and under which fairness (rewritten in v0.1)

**Model:**
- `ExchangeEnds`: once the client is in an exchange (opener sent, sending, waiting, or aborting), its exchange state is eventually left. It may be left by reading 902-907, a DEL of sasl, or ERROR; by its own give-up (`CGiveUp`, D19); or by quitting.
- 908 is not an ending (D4); 900 alone is not one (D3).
- It is checked under `Spec`, which has two fairness parts:
  - SrvFair: the server reads, delivers, challenges, decides, and sends what it owes.
  - CliFair: the client reads, and finishes sending a response it started.
- Neither side has fairness on timing out or aborting. **That does not exclude them.** v0 claimed that the property shows "the exchange ends because the server answers". It does not: aborts, give-ups and quits are still possible, and `ExchangeEnds` accepts them. It is only eventual exit from the client's exchange state.
- **Server-driven completion** is a separate scenario. Switch `NoAbandon` disables `CAbort`, `CGiveUp`, the abort branch of answering a challenge, and `CQuit`. `RuleExitByServerLine` checks that the client then leaves an exchange only by reading a server line, and config `TinyNoAbandon` checks `ExchangeEnds` under it. Even there, hs D12 remains: SASL lines carry no exchange identifier, so "this exchange's" verdict is the next terminal numeric. Without aborts and give-ups no stale terminal is produced in the model, but the property does not track exchange identity.
- `OwedEventuallyClears` (v0's `OwedSent`, renamed; see the README) is checked under `Spec` and `EnvSpec`. It says only that obligations eventually clear, by being sent or by a DEL cancelling them (D13). It does not show that each owed line was sent; `SuccAccounting` does that for 900/903, as a safety invariant.

## D16. 902 (extends hs D6)

> "`902` ... is sent when the SASL authentication fails because the account is currently locked out, held, or otherwise administratively made unavailable." (S1:207)

**Model:** 902 is a failure verdict that services may give instead of 904. The client treats both as the end of the exchange, and may retry. hs D6 folded 902 and 905 into 904. This model keeps them apart (D6 for 905).

## D17. Exploration restrictions R1-R4 (v0.1)

These are choices the spec text does **not** impose. They narrow the server behaviours this model explores. Each is also listed in the module header. A pass under them says nothing about the interleavings they remove.

| | Restriction | Spec lines that do not impose it | Relaxed by |
| --- | --- | --- | --- |
| R1 | The account changes in the step that sends its 900 or 901. | S1:79, S1:199-205 | switch `AcctEarly` (903-first success sets the account at the verdict, 900 owed) |
| R2 | After an unsupported mechanism, 908 comes before 904. | S1:46-48, S1:231 | switch `AnyOrder908` (904 first, 908 owed) |
| R3 | Read barrier: no AUTHENTICATE line is read while 900/903/908/904 of the last opener are owed. | S1:79, S2:62-63 | not relaxed (D14) |
| R4 | A DEL cancels SASL-specific owed output but not an owed 900. | CN:456-457 vs S1:199 | not a switch; the reading is D13, open as Q7 |

The limited configs turn on `AnyOrder908` (`TinyMechs`) and `AcctEarly` (`TinyReauth`, `TinySame`), so both orders are explored now. R3 is the restriction with the largest cost in coverage.

## D18. The exact-advertisement policy (v0.1)

> "Servers SHOULD advertise the available SASL authentication mechanisms in the value of the `sasl` client capability in `CAP LS`." (S2:38-39)
> "The value, if present, MUST be a comma (`,`) separated list of SASL authentication mechanisms." (S2:41-42)

S2:41-42's MUST is about syntax. The model has no syntax, so that rule is **out**.

v0 attributed `RuleValueIsMechs` (a value equals the supported set exactly) to S2:41-42. That is stronger than the MUST, and is not what it says.

**Model:** the model server follows a **policy**: when it sends a value (switch `AdvertValue`, S2:38-39's SHOULD, extended to NEW by CN:426-428), the value is exactly the supported set at that moment. `RuleValueIsMechs` checks that policy. It is not a spec MUST: a server that lists a subset, or a superset with stale entries, breaks the policy, not S2:41-42. Clients must cope with a list that differs from what is supported anyway (S2:77-78, D11).

## D19. Local abandonment of an abort (`CGiveUp`, v0.1)

S1:39-40 asks clients to be "prepared for timeouts at all times". In the model that is the client reading `SrvTimeout`'s 904 in every exchange state: before the challenge, between chunks, and while waiting. Client abort is a separate rule (S1:72-73, `CAbort`).

`CGiveUp` is neither of these. It is an **explicit local-abandonment assumption**: a client that has sent `*` stops waiting for its 906, and may open a new exchange. The spec does not describe this. It is kept because real clients time out locally.

Its consequence is hs D12's: the abandoned exchange's 906 (or another of its replies) can arrive later and end the next exchange early. `ExchangeEnds` accepts give-ups. The `NoAbandon` scenario (D15) turns `CGiveUp` off.
