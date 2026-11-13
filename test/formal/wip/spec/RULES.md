# IRCv3 rules encoded in `model/SpecHandshake.tla`

Source: `ircv3/ircv3-specifications` at commit `9ff58d1342af67aff88753388f568542820c4bfe` (2026-08-03), cloned to `specs-src/`.
Files: `extensions/capability-negotiation.md` (CN), `extensions/sasl-3.1.md` (S1), `extensions/sasl-3.2.md` (S2).

Each rule has an ID, the spec line, the requirement level, and how the model handles it:
**guard** (the spec role cannot break it), **prop** (checked as a property),
**switch** (a SHOULD/MAY choice exposed as a CONSTANT), **free** (left nondeterministic because the spec permits it),
or **out** (outside the model's scope; see the header of `SpecHandshake.tla`).

## Capability negotiation (CN)

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| CN-1 | CN:62 | SHOULD | On connect the client sends `CAP LS [version]` or `CAP REQ`. | guard: client opens with `CAP LS 302`. Blind REQ: out. |
| CN-2 | CN:67 | MUST | Then the client sends NICK and USER. | guard (Init). |
| CN-3 | CN:69-71 | MUST | After `CAP LS` or `CAP REQ` during registration, the server does not complete registration until `CAP END`. | guard on `SrvRegister`; prop `RuleNoWelcomeInHold`. |
| CN-4 | CN:158-160 | MUST | Cap lists are processed left to right; a value sent twice: last wins; trailing whitespace ignored. | out (lists are sets; no values). |
| CN-5 | CN:180 | MUST | The server accepts `CAP` at any time, including after registration. | guard: server handles CAP in every state; client may REQ after 001. |
| CN-6 | CN:199-200 | MUST | `CAP LS` during registration suspends it until END. | as CN-3 (`hold`). |
| CN-7 | CN:204 | MUST | With no caps available, LS carries an empty parameter. | free (an empty LS is reachable). |
| CN-8 | CN:226, 270-271 | MUST NOT | 302 features (values, multiline, NEW/DEL) only to 302 clients; values only in LS/NEW. | out: the client always sends 302; values are not modelled. |
| CN-9 | CN:282-286 | MAY / MUST | The server MAY split LS over lines; all but the last carry `*`; a 302 client MUST handle this. | switch `MultiLine`; the two lines are sent in separate steps, NEW/DEL may come between, the final line omits caps DELed since; the client is done at the final line. |
| CN-10 | CN:346-347 | MUST | Requesting an already enabled cap counts as success. | guard: a REQ made only of enabled caps (or cap-notify) is ACKed; prop `RuleRedundantAck` (D8). |
| CN-11 | CN:349 | must | The requested set is accepted as a whole or rejected entirely. | guard: one ACK or NAK per REQ, over the whole set; prop `RuleAckWhole` (a REQ leaves the inbox only with exactly one NAK of its caps or one ACK of them or of a first part; a split closes only with an ACK) with `AnswersEventually`. |
| CN-12 | CN:351-353 | SHOULD | The client keeps each REQ short enough for a single ACK/NAK, else sends several REQs. | free: the client may send several REQs; `MaxReq` is an exploration bound, not a spec limit. |
| CN-13 | CN:355-356 | MUST | REQ during registration suspends it until END. | as CN-3, including a REQ after an earlier END (D13). |
| CN-14 | CN:380-381 | MUST NOT | Multiline ACK: the client changes caps only on the last line; the server only after sending the last line. | guard: client collects per REQ (D17); server enables in the step that sends the last part (D19); prop `RuleAckCommitsLast`. switch `MultiLine`. No ACK continuation marker (D15); other output may come between parts (D9); DEL in between: D18. |
| CN-15 | CN:387-388 | MUST NOT | After a NAK the server changes no caps. | guard; prop `RuleNakNoChange`. |
| CN-16 | CN:404-405 | MUST | END after registration is ignored. | guard. |
| CN-17 | CN:413-414, 447-448 | MUST ONLY | NEW/DEL only to 302 or cap-notify clients. | guard: NEW/DEL only after the server has handled `CAP LS 302` (`srv.lsSeen`). |
| CN-18 | CN:417-418 | SHOULD | After NEW the client REQs the caps it wants. | free (client may REQ any available cap). |
| CN-19 | CN:451-452 | MUST | After DEL the client treats the caps as cancelled and unavailable. | guard (client removes them from `avail` and `enabled`). |
| CN-20 | CN:452-453 | SHOULD NOT | The client does not REQ `-cap` for DELed caps. | out (no removals). |
| CN-21 | CN:456-457 | MUST | After sending DEL the server cancels all behaviour specific to that cap. | guard: DEL removes it from `enabled`; DEL of sasl cancels an exchange in progress (D5). |
| CN-22 | CN:459-460 | MUST | Clients handle the server removing any cap gracefully. | partly: `CapsAgree` across DELs (including during a split ACK, D18) and `Terminates` under `Spec` only; "gracefully" has no fuller formal reading here. |
| CN-23 | CN:475-479 | MUST | `CAP LS 302` enables cap-notify implicitly; the server must not disable it. | guard (NEW/DEL always sent; cap-notify never DELed). |
| CN-23b | CN:481-485 | MAY / MUST | The server MAY list cap-notify in LS; the client MAY REQ it; a capable server MUST ACK it without side effects. | guard: LS may include it; REQ of it is always ACKed; switch `ReqCapNotify` (D14). |
| CN-24 | CN:491-492 | MUST | With cap-notify, the server notifies all new and removed caps. | guard: every change in `offered` sends NEW or DEL in the same step. |
| DEP-1 | LR:31; multiline, event-playback | MUST | `labeled-response` "depends on the `batch` capability which MUST be negotiated to use labeled responses"; `draft/multiline` requires `batch`; `draft/event-playback` only shapes `chathistory` batches. A client uses a dependent cap only while its dependency is enabled. | prop: `RuleDepNeedsDep` (client), with `OtherCaps = {"a", "b"}` and "a" depending on "b" (D28). |

## SASL 3.1 (S1)

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| S1-1 | S1:31-32 | MUST | The client enables the sasl cap before using AUTHENTICATE. | guard on `CMech`; prop `RuleClientAuthOnlyEnabled`. "Enabled" = in the client's ACKed set (D1). |
| S1-2 | S1:36-37 | MUST | AUTHENTICATE is used before registration completes and with sasl enabled. | guard: the client does not open an exchange after 001. SASL after 001 is out of scope (D2). |
| S1-3 | S1:37-38 | RECOMMENDED | Send CAP END only when SASL has completed or needs aborting. | free: END allowed at any time after LS; an END mid-exchange is an abort (D16). |
| S1-4 | S1:39-40 | SHOULD | Clients are prepared for timeouts at any time during SASL. | `CAbort` / `CGiveUp` enabled at any time, with no in-flight gating; weakly fair. |
| S1-5 | S1:45-48 | — / MAY | If agent association fails, 904 and state unchanged; the client MAY try another mechanism. | `env.svcOk = FALSE` → 904; the client may retry (`MaxSasl`). |
| S1-6 | S1:48-50 | — | Otherwise the server sends the initial response (`AUTHENTICATE +` for client-first). | guard. |
| S1-7 | S1:56-57 | MAY | The server may intersperse other messages between AUTHENTICATE lines. | free (single ordered stream). |
| S1-8 | S1:58-63 | must | Base64, 400-byte chunks, `+` after an exact-400 final chunk. | out (one abstract AUTHDATA line). |
| S1-9 | S1:69-70 | MUST | After a non-empty final server challenge, the client still sends an empty response. | out (PLAIN only). |
| S1-10 | S1:72-75 | — | Client `*` aborts; the server sends 906. | guard. |
| S1-11 | S1:77-79 | — / MAY | Failure → 904 or 905; the client MAY retry from `AUTHENTICATE <mech>`. | guard; 902/905 folded into 904 (D6). |
| S1-12 | S1:79 | — | Success → 900 and 903. | guard: a success owes one 900 and one 903, sent in either order in later steps (counters independent of later exchanges); invariant `SuccAccounting`, prop `OwedSent`. 001 may come between (D20). |
| S1-13 | S1:81-82 | MUST | AUTHENTICATE after a successful login is rejected with 907. | guard when `Reauth = FALSE`: every AUTHENTICATE line after a successful login (opener, response or `*`) gets 907, checked first; prop `Rule907` requires it (D3, D7, D21). |
| S1-14 | S1:84-87 | SHOULD | If registration completes during SASL, the server aborts it with 906 and registers unauthenticated. | switch `AbortOnReg`; 906 and the 001 are separate steps (`Srv001`). |

## SASL 3.2 (S2)

| ID | Line | Level | Rule (paraphrased) | Model |
| --- | --- | --- | --- | --- |
| S2-1 | S2:27-28 | MUST NOT | Do not advertise sasl if the auth layer is unavailable. | guard; prop `RuleSaslAdvertOnlyIfUp`. |
| S2-2 | S2:30-31 | MUST | NAK any sasl REQ if the auth layer is unavailable. | guard (sasl not offered → NAK); props `RuleSaslNakIfDown` (an answer to a sasl REQ while down is a NAK) and `RuleNoSaslAckIfDown`, both on answers (D18). |
| S2-3 | S2:33-34 | MUST / MAY | A client that requires pre-authentication and cannot obtain the sasl cap disconnects; it may retry. | guard on `CEnd`; weakly fair `CQuitOblig`; props `RuleClientRequiredNoEnd`, `RequiredQuits`. "Cannot obtain" is event-based and sticky (D4). |
| S2-4 | S2:38-46 | SHOULD / MUST | Mechanism list in the sasl value; clients handle no value / unknown mechanisms. | out (no values). |
| S2-5 | S2:53-58 | MUST | sasl availability changes go out through cap-notify. | guard (availability flips with NEW/DEL in the same step). |
| S2-6 | S2:62-65 | SHOULD / MUST | Allow reauthentication at any time; if not, send a suitable error such as 907. | server: switch `Reauth` (D3). Client reauthentication: out (D2). |
| S2-7 | S2:67-69 | MAY / MUST | The server may disconnect after failed auth but sends the reason first. | `SrvFailClose`, only after every owed line (D19); prop `RuleFailCloseReason`. |
| S2-8 | S2:73-78 | SHOULD / MUST | Pick an advertised mechanism; handle it turning out to be unavailable. | out (one mechanism). |

## Not encoded (noted by the spec review)

Server reply identifiers (CN:167-168), numeric CAP version comparison and
retained versions (CN:233-243), empty LIST replies (CN:321-322), opaque and
case-sensitive cap names (CN:497-499), value updates by NEW and values on NEW
(CN:420, 426-428), the comma-separated mechanism list (S2:41-42), and unknown
mechanisms (S2:48-49). These are wire-format or value obligations outside the
control-state model; they need separate checks before claiming conformance.
