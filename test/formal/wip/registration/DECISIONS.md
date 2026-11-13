# Registration: interpretation decisions

## D1. Scope, and what is abstracted
Capability negotiation and SASL belong to the handshake model (`../spec/`, hs). Here they are one flag: CAP LS suspends registration and CAP END resumes it (MI:101, CN). hs D13 covers a REQ after END, which re-suspends registration; that case is not modelled here.

Also not modelled:
- 002-005, LUSERS and umodes, which are folded into the burst;
- ident and DNS lookups;
- 431, 432 and 436 during registration;
- NICK changes after 001;
- PING sent by the client (MC:137 "should not");
- 451 for commands other than METADATA.

## D2. The PING cookie is a server convention
MI:115 says only that "some servers" send a PING and wait for the PONG. The token is opaque (MC:133, MC:140). `Cookie` describes such a server: it sends one PING while registration is open, and holds 001 until the PONG with that token arrives (`RuleCookieGate`). A PONG with the wrong token is ignored. The client side applies to every server: answer every PING with its token (MC:135, MC:138; `RulePongToken`, `PingsAnswered`).

## D3. 433 during registration
The nicks in use (`Taken`) are fixed for the run. The server answers a taken nick with 433 and ignores the NICK (MC:53). The client then sends the next nick in its list. With none left, it stays unregistered until the server ends the connection (D4). A 433 can arrive after CAP END, because the client pipelines; the client must not count itself registered until 001 (`RuleWelcomedBy001`, `W_EndThen433`).

## D4. The registration timeout is a server convention
No text requires a timeout. MI:113 asks for timeouts on lookups. `Timeout` describes a server that may end an incomplete registration, including one refused with 464 alone (D8). It sends ERROR and then nothing (MC:230; `RuleNothingAfterError`). The traces record each server's value.

## D5. Metadata before registration
The client enables metadata whenever `before-connect` is advertised (`Meta`), and before 001 targets `*` (MD:176 MUST). The spec does not say what a server does with these cases, so the model reads them as follows:
- a METADATA during registration aimed at another target gets `FAIL`;
- a METADATA during registration without `before-connect` gets `FAIL`;
- 761 with target `*` answers an accepted SET (MD example 711-730).

Without the metadata cap, the recorded servers differ: one answers `421`, the other accepts the SET (and sends no batch, the cap not being negotiated). The model folds "advertised" and "enabled" into `Meta`, so it does not cover this case.

## D6. The burst
`001`, then (with metadata) `BATCH +` / the keys / `BATCH -` targeting the client's own nick, then `376`. MD:113 and MD:140 make the batch a MUST, empty if nothing is set. MD:140's "clients receive their current metadata (... plus any metadata set by the client during connection registration via before-connect)" is descriptive. It is read as required: a key the server acknowledged before 001 is in the batch (`RuleMetaCarries`).

## D7. METADATA after CAP END, before 001
This is still registration (MD:176). The server may have completed registration before reading the line. In that case the key is set afterwards (761 with the nick) and is not in the burst. The client cannot tell which happened until the 761 arrives. The model allows both orders (`W_MetaAfterEnd`).

## D8. PASS
- Only the last PASS counts (MC:30).
- The model client holds at most one password and sends it before NICK and USER (MI:90-93). Sending it any later would strand the client: MI:103 forbids PASS after the latter of NICK and USER, and the model client sends CAP END only once its PASS is out.
- The server checks the password when registration would complete.
- 464 alone leaves the connection open and unregistered (`refused`), until the server ends it (D4).

## D9. Metadata without batch (nefarious2)
draft/metadata-2 requires batch, but nefarious2 grants the metadata cap without it for before-connect (ibutsu, 2026-11-12): a METADATA SET during registration is answered with 761 `*` whether or not batch is negotiated yet, and if batch is not negotiated by the end of registration, the server drops what was set. The metadata spec allows either negotiation order.

Batch is negotiated state. With metadata the client may ask for batch (`REQB`) before or after its SET, only before CAP END, or never. The server answers each request with one line, ACK, or with `NoBatch` possibly NAK. Completing registration without batch drops the pre-registration key (`srv.pre`) and sends no metadata batch (`RuleDropWithoutBatch`, `RuleNoMetaBatchWithoutBatch`); the burst rules of D6 apply only with batch. The client counts a key acknowledged before 001 as held only if batch was ACKed by then (`RuleHeldIsKept`).

Witnesses: `W_MetaDropped` (a key acknowledged, then removed), `W_MetaBeforeBatch` (761 `*` before the batch ACK, and the key kept). Mutants: `MU_TrustDropped` (the client trusts any acknowledged key, as Seance did before evilnet/seance#299) and `MU_KeepWithoutBatch` (the server keeps it).

## Open questions (to settle from traces)
- **Q1.** METADATA aimed at a target other than `*` before registration: refused, or accepted? The spec is silent; the model reads refused (D5). **Observed (traces/):** both servers refuse it with `FAIL METADATA` (one `INVALID_TARGET`, the other `KEY_NO_PERMISSION`). The model's reading stands; settled.
- **Q2.** METADATA after CAP END and before 001: is it in the burst? This is server-dependent (D7). The traces show each server's behaviour. **Observed:** both branches occur. One server reads the SET before completing registration (`761` with target `*`, key in the burst); the other completes registration first (`761` with the nick, after the burst). Settled as server-dependent, as D7 models.
- **Q3.** Does each server send a cookie PING, and does it hold 001 until the PONG (D2)? **Observed:** neither recorded server sends a PING during registration on the ports recorded; 001 follows CAP END without one. The cookie stays a switch with nothing observed against it.
- **Q4.** Each server's registration timeout, and what it sends (D4). **Observed:** both end an incomplete registration after 60 s with `ERROR` and close the connection (D4).
- **Q5.** After 464, does each server close the connection (D8)? This needs a server that requires a password. **Observed:** on the server recorded with a connection password, a wrong one gets `464` then `ERROR` and the close; the right one registers. Settled for that server; the model keeps the other branches (MC:32 allows 464 alone or ERROR alone).
