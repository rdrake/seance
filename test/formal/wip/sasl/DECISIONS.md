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

## D4. 908, and the 904 after it

> "`908` aka `RPL_SASLMECHS` MAY be sent in reply to an `AUTHENTICATE` command which requests an unsupported mechanism." (S1:231)
> "If this fails, a 904 numeric will be sent and the session state remains unchanged; the client MAY try another mechanism." (S1:46-48)

The text never says whether an opener that names an unsupported mechanism also gets 904, nor in which order.

**Model:**
- An unsupported mechanism always ends the exchange with 904, read as a failed association (S1:46-48).
- With `Send908`, the 908 comes first. It lists the supported set (`Rule908`), and the 904 is owed and sent in a later step (hs v4 convention: no two numerics in one step).
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

**Model:**
- A LONG line inside a response gets 905.
- A response that grows past `MaxLen` chunks ends the exchange with 904 or 905 (free): 904 is "other errors" (S1:215), and 905 is the nearest named meaning.

The model client never sends a LONG line (`RuleClientLineLen`). The spec's 905 is therefore reached only through `MaxLen`, or through a non-conforming client such as the mutant `MU_Chunk401`.

**Open (Q2):** which numeric should a server send when S1:64's limit is exceeded?

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
- The server never stays silent (`RuleOpenerAnswered`).

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

**Model:**
- As hs D5, the exchange is dropped silently on both sides (`DelCancels`, `W_DelMid`), together with any challenge chunks not yet sent.
- Lines already owed for a decided exchange (900, 903, the 904 after 908 or 901) are still sent. The verdict was reached before the DEL, and 900 reports the account "whether by SASL or otherwise" (S1:199).
- The login survives the DEL: an account is not sasl-cap behaviour.

**Open (Q7):** may a server log the client out (901) because sasl was DELed? S2:22-23 speaks of "reauthentication if authentication is lost via the cap-notify capability", which could be read either way.

## D14. Bound: the server reads AUTHENTICATE lines only once owed lines are out

This is not a reading of the spec but a bound on the model, stated here so it is not mistaken for one.

**Model:** while a 900, 903, or a 904 owed after 908 or 901 is still unsent, the server leaves the next AUTHENTICATE line unread (`SRecv`'s guard). This delays reads and drops no behaviour of the lines themselves. But a new exchange can no longer overlap an owed 903; that overlap is hs D20 / `M2Owe` territory and the handshake model checks it.

## D15. What "an exchange ends" means, and under which fairness

**Model:**
- `ExchangeEnds`: once the client is in an exchange (opener sent, sending, waiting, or aborting), it eventually leaves it. It may do so by reading 902-907, by a DEL of sasl, or by the connection closing.
- 908 is not an ending (D4); 900 alone is not one (D3).
- It is checked under `Spec`, which has two fairness parts:
  - SrvFair: the server reads, delivers, challenges, decides, and sends what it owes.
  - CliFair: the client reads, and finishes sending a response it started.
- Neither side has fairness on timing out or aborting. So the property says that the exchange ends because the server answers, not because someone gives up.
- `OwedSent` is also checked under `EnvSpec` (server fairness only).

## D16. 902 (extends hs D6)

> "`902` ... is sent when the SASL authentication fails because the account is currently locked out, held, or otherwise administratively made unavailable." (S1:207)

**Model:** 902 is a failure verdict that services may give instead of 904. The client treats both as the end of the exchange, and may retry. hs D6 folded 902 and 905 into 904. This model keeps them apart (D6 for 905).
