# Ergo against the spec model (trace validation)

Ergo `~/workspace/afternet/ergo` at 079720e8 (version 2.20.0-unreleased) (2026-11-01), unmodified, built with Go 1.27 and run
locally on 127.0.0.1:16670 (plain TCP) with `conformance/ergo-test.yaml`. That config is
`default.yaml` with the listeners replaced and fake lag and login throttling off. A test account was
registered through NickServ (password `goodpass`; `wrongpass` for failures). The 2026-11-10 runs
use the spec model v6 (D21); see "Model change" below.

## Method

- `conformance/drive.py` plays client schedules that the spec model's client allows and records
  every server line. A schedule combines:
  - REQs of disjoint cap sets: `sasl`, `server-time` (the model's `a`) and `cap-notify`, either
    pipelined or waiting for each answer;
  - SASL PLAIN with the right or wrong password, an abort before `AUTHENTICATE +` or right after the
    response, and a second attempt;
  - CAP END after negotiation, pipelined with the first REQ, or in the middle of an exchange;
  - a REQ after END.
- Each recorded run is reduced to the model's vocabulary: LS/ACK/NAK/NEW/DEL with the three caps,
  `AUTHENTICATE +`, 900/903/904/906/907, 001, ERROR. 902 and 905 fold into 904 (D6), and every
  other line is dropped.
- `conformance/check.py` writes, per run, a module that EXTENDS `SpecHandshake`:
  - Init is pinned to the run's environment.
  - Next is constrained so that every line the model server sends is the next observed line.
  - Every model client line is the next recorded line, sent after the client has read exactly the
    lines it had read on the wire.
  - TLC then looks for a state where the whole run is reproduced and no fair server action is still
    enabled, so the server owes nothing more. Reaching it means the run is a behaviour of the model.
- Every run is checked with `Reauth` FALSE and TRUE, with every other switch at its most permissive
  value.
- Controls: three tampered copies of a real run (903 removed; 001 moved before the ACK; ACK naming
  the wrong cap) are rejected.

## Results

105 schedules were run.

| Pass | Matched | Diverged | Cause of divergences |
| --- | --- | --- | --- |
| 1 (model v5, harness v1) | 75 | 30 | 18 harness, 12 model |
| 2 (model v5, harness v2) | 93 | 12 | 12 model |
| 3 (model v6, harness v2) | **105** | **0** | |

Every run matches with `Reauth = FALSE`. The 12 runs that end in 907 do not match with
`Reauth = TRUE`, which is consistent with Ergo being a server that answers 907 and does not allow
reauthentication.

### Divergences and their classification

1. **Model too strict (fixed in v6, D21), 12 runs, `*/abort-late.good/*`.**
   - The client sent its response and `AUTHENTICATE *` together.
   - Ergo answered 900, 903, then 907 for the `*`.
   - S1:81-82 says any AUTHENTICATE after a successful login MUST get 907, and `AUTHENTICATE *` is
     one. v5 gave 907 only to an opener and let that `*` get 906 or nothing.
   - v6 gives 907 to every AUTHENTICATE line after a login when reauth is off (`Late907`), and
     `Rule907` checks all three line kinds.
2. **Harness error (fixed), 18 runs, `*/*/midexchange`.**
   - The model client answers `AUTHENTICATE +` in the step that reads it.
   - The first harness waited for the server to go quiet first, so it had already read 001.
   - The harness now sends the response the moment it reads `AUTHENTICATE +`.

No run showed an Ergo deviation from the IRCv3 text within the model's scope.

### What Ergo chose among the spec's options (seen on the wire, matching the code reading)

- **One answer per REQ, in REQ order.** ACKs are one line in every run (`MultiLine` not exercised
  for ACK).
- **LS is two lines with `*`,** and cap-notify is listed (`LsCapNotify`).
- **900 and 903 are adjacent,** 900 first.
- **907 and no reauthentication** (`Reauth = FALSE`). The 907 also covers `*` and response lines
  (D21).
- **Registration completes during an exchange without a 906** (`AbortOnReg = FALSE`). The exchange
  finishes after 001 (`*/good/midexchange`: ..., AUTH+, 001, 900, 903). Measured strictly, this
  goes against S1-14 (S1:84-87, SHOULD abort with 906 and register without an account): class (b).
  nefarious2 goes against it the other way, holding registration until the exchange ends
  (NEFARIOUS.md N5).
- **`*` mid-exchange gets 906,** and a new opener after it gets a fresh `AUTHENTICATE +`.
- **END is acted on at once.** A REQ pipelined behind END is answered after 001, so D13's re-hold
  never arises on Ergo.

## Not exercised on Ergo

- **NEW/DEL before registration:** Ergo sends none (only on rehash, and only to registered
  clients). So DEL during a split or an exchange, D18, and CN-24 for negotiating clients are
  untested here.
- **An unavailable SASL backend** (`svcOk = FALSE`, S2-2): services are built in.
- **SASL timeouts:** Ergo has no SASL timeout, only the registration timeout.
- **Split ACKs and reordered replies:** Ergo never produces them.
- **Reauthentication and a failed-then-good second attempt:** the model client does neither (the
  model's credentials are fixed per behaviour).
- **WebSocket:** the listener is configured on :16671, but every run used plain TCP. The lines are
  the same.

## Code-reading findings, measured strictly against the IRCv3 text

The spec repository defines no RFC 2119 keywords. Upper-case MUST/SHOULD/MAY are taken as
normative; lower-case "must" and plain prose are descriptive. Our D-entries are not the spec.
Classes:

- (a) breaks a MUST
- (b) goes against a SHOULD
- (c) a choice the spec leaves open, which differs from our D-entry reading
- (d) not a deviation

Drafts for the (a) items are in `ergo-issues/`, each marked "Not for filing". Nothing was opened
on ergochat/ergo.

| # | Ergo does (079720e8) | Spec sentence (level) | Verified | Class | Existing issues |
| --- | --- | --- | --- | --- | --- |
| 1 | No NEW/DEL to connections still registering (handlers.go:884, client_lookup_set.go:252) | cap-notify "MUST be implicitly enabled" by `CAP LS 302`; "When enabled, the server MUST notify the client about all new capabilities and about existing capabilities that are no longer available" (CN:477-478, 491-493, MUST). NEW "may be sent at any time" (CN:416). No exception for registration. | code only | (a) | none |
| 2 | Rehash can turn off account-registration, chathistory, metadata, relaymsg, webpush with no DEL (config.go:1632-1855, 1990-2023) | same CN:491-493 (MUST) | code only | (a) | none |
| 3 | After DEL the cap stays in `session.capabilities` (server.go:892-904). For sasl, AUTHENTICATE then gets 906, so that behaviour does stop. | "Servers MUST cancel any capability-specific behavior for a client after sending the CAP DEL message" (CN:456-457, MUST) | code only | (a) for languages and multiline; (d) for sasl | none |
| 4 | REQ applied (handlers.go:790-791) before the ACK is queued, even when the ACK is split | "If an ACK reply ... is spread across multiple lines ... a server MUST NOT change the capabilities of the client until the last ACK of the set has been sent" (CN:380-382, MUST, multi-line ACKs only) | code only | (a) literally, multi-line ACKs only; not observable on the wire | #2411 (closed, related path) |
| 5 | A pre-registration REQ naming the advertised `ergo.chat/nope` gets ERROR and a disconnect (handlers.go:779-788) | "The capability identifier set must be accepted as a whole, or rejected entirely" (CN:349, lower-case, descriptive). Nothing requires a server to answer rather than disconnect. | **live**: `ERROR :Requesting the ergo.chat/nope client capability is forbidden` | (d), deliberate | #511, #521 (closed: a deliberate trap for clients that REQ every cap, killing only during registration) |
| 6 | Adds applied, then removes: `REQ :-server-time server-time` leaves it disabled (handlers.go:790-791) | "The list of capabilities MUST be parsed and processed from left to right ... If a capability with values is sent multiple times, the last one received takes priority" (CN:157-159, MUST on the server; the "send once" is a client SHOULD) | **live**: ACK `:-server-time server-time`, then `CAP LIST :` (empty) | (a) | #1201 (open, adjacent: ACK echoes the raw REQ) |
| 7 | AUTHENTICATE while authentication is disabled gets 906 "SASL authentication aborted" (handlers.go:207) | 906 "is sent when the SASL authentication is aborted because the client sent an AUTHENTICATE command with `*`" (S1:223, descriptive), and S1:72-73 (descriptive). S2-2's NAK of the REQ is done (MUST, met). The client's AUTHENTICATE without sasl enabled breaks S1:31 (client MUST). The reply to it is unspecified. | **live**: `CAP * NAK sasl`, then `906 * :SASL authentication aborted` | (c): the spec is silent; our D7 reading is silence or 904, and Ergo's 906 contradicts only the numeric's description | none |

Items 1-4 were not reproduced: Ergo sends NEW/DEL only on rehash, and the harness does not rehash.

## nefarious2 (dev container, side by side)

- The `nefarious-dev` container on :6667 has no services linked, so it does not offer sasl.
  Of the 105 schedules only those without sasl are legal for the model client.
- Both plain-cap schedules match. The third was refused by nefarious2's reconnect throttle.
- Every sasl schedule REQs a cap the server never listed, which the model client never does, so
  those runs are not model behaviours.
- They do reproduce `CODE-FINDINGS.md` F4 live, in a stronger form: nefarious2 ACKs `CAP REQ :sasl`
  with sasl not advertised at all (S2:30-31). F4 is recorded, not filed.
- A full comparison needs the fake-services setup that `live_server.py` (Seance
  `test/formal/handshake/`) used.

## Files

- `conformance/drive.py`, `conformance/check.py`, `conformance/ergo-test.yaml`
- `conformance/results/ergo-079720e8.jsonl`: recorded runs, including raw lines
- `conformance/results/ergo-079720e8.summary.json`: per-run verdicts
- `conformance/results/nefarious-dev.jsonl`

Run:

```
python3 conformance/drive.py 127.0.0.1 16670 runs.jsonl
python3 conformance/check.py runs.jsonl WORKDIR -j 6
```
