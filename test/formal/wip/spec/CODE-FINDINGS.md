# Findings against the code, from the spec model

Things the spec model turned up about Seance, nefarious2, or the code-derived
model (`test/formal/handshake/Handshake.tla` on the fix branch). Rule and
decision IDs refer to `RULES.md` and `DECISIONS.md`.

## F1. Seance sent AUTHENTICATE before sasl was enabled (D1, S1-1): resolved

sasl-3.1:31 "The client MUST enable the sasl capability before using the
AUTHENTICATE command"; the CN text defines enabling as the server's ACK. Seance
pipelines `CAP REQ :... sasl` and `AUTHENTICATE PLAIN` in one flush. That was the
direct enabler of the missing-opener bug: when the REQ is NAKed, the opener
arrives with sasl not enabled and nefarious2 drops it.
**Resolved** on the fix branch at 2f00d2d: Seance now waits for the sasl ACK
before AUTHENTICATE (Richard's decision).

## F2. Seance relies on a `*` marker on multi-line ACK (D15)

The spec defines `*` only for LS and LIST. nefarious2 sends multi-line ACK to
302 clients with the `*` marker (`ircd/m_cap.c:660-668`, via `send_caplist`
from `cap_req`), and Seance buffers ACK on it. Against a server that splits an
ACK without `*`, Seance would apply each line as a complete ACK.

## F3. `CapEndOnce` in the code model contradicts the spec and nefarious2 (D13)

CN:355 suspends registration on any REQ received before registration
completes, including after an earlier END, so a client owes another END.
nefarious2 does this: `cap_req` calls `auth_cap_start` whenever the client is
still unregistered (`ircd/m_cap.c:710-711`), setting `AR_CAP_PENDING` again.
Not reachable with Seance on nefarious2 today, because nefarious2 does not
send NEW/DEL to unregistered clients (`ircd/m_cap.c:303-306`). A property that
asserts END is sent exactly once is still wrong as a statement about correct
behaviour.

## F4. nefarious2 ACKs sasl after the auth layer goes away (S2-2)

sasl-3.2:30 "Servers MUST NAK any sasl capability request if the
authentication layer is unavailable." `cap_req` never rechecks SASL
availability (`ircd/m_cap.c:715-743`); see `../formal-handshake-review/REVIEW-2.md`
finding 3. Recorded only; not to be filed for now.

## F5. Split ACK attribution depends on in-order replies or the `*` marker (D17)

The spec model found that without an ACK continuation marker a client cannot attribute a split
ACK when it has two REQs outstanding and replies may come out of order. Seance sends several REQ
lines at once (`caps.ts` request splitting) and relies on nefarious2's `*` marker (F2); nefarious2
also answers REQs in order, one line at a time. Against a server that splits ACKs without `*`,
Seance's buffering would need the oldest-REQ rule to stay correct, and that only holds if the
server answers in order.
