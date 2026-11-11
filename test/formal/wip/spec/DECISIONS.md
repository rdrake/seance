# Interpretation decisions for the spec model

Places where the spec text leaves a choice, contradicts itself, or is silent.
Each entry quotes the text, says what `model/SpecHandshake.tla` does, and why.
Rule IDs refer to `RULES.md`. Open questions are for Richard to settle.
Revised 2026-11-07 after `SPEC-REVIEW.md`; settled answers are marked **Settled**.

## D1. What "enable the sasl capability" means for the client (S1-1)

> "The client MUST enable the sasl capability before using the AUTHENTICATE command" (S1:31-32)
> "The ACK subcommand is sent by the server to acknowledge a client-sent REQ, and let the client know that their requested capabilities have been enabled." (CN:370-371)
> "a client MUST NOT change capabilities until the last ACK of the set is received" (CN:380-381)

**Model:** the client counts sasl as enabled only once it has received the final ACK line that covers it. `CMech` is guarded on `"sasl" \in cli.enabled`.
**Why:** CN defines enabling as the server's ACK; a REQ alone enables nothing, and a NAK means nothing changed (CN:388). Sending `AUTHENTICATE` right behind an unanswered `CAP REQ :sasl` is therefore a use before enabling.
**Resolved:** reading kept; the spec review found no text against it. Seance used to pipeline `CAP REQ :sasl` with `AUTHENTICATE PLAIN`. Richard chose to have Seance wait for the sasl ACK before AUTHENTICATE (fix branch commit 2f00d2d), so Seance now complies (`CODE-FINDINGS.md` F1).

## D2. AUTHENTICATE after registration (S1-2 vs S2-6)

> "The AUTHENTICATE command MUST be used before registration is complete" (S1:36)
> "Servers SHOULD allow a client, authenticated or otherwise, to reauthenticate by sending a new AUTHENTICATE message at any time." (S2:62-63)

**Settled (scoped out):** SASL after 001 is out of scope: S2 reauthentication, NEW sasl after registration, and 901. Seance does not reauthenticate. The client opens exchanges only before it has seen 001; the server still handles an opener that lands after registration (a race). The model therefore does not check S2-6 client behaviour (SPEC-REVIEW #1).

## D3. 907 versus reauthentication (S1-13 vs S2-6)

> "the server MUST reject it with a 907 numeric" (S1:81-82)
> "Servers SHOULD allow ... reauthenticate ... If reauthentication is not available, an error appropriate to the circumstances MUST be sent (for instance, ERR_SASLALREADY...)" (S2:62-65)

**Model:** switch `Reauth`, server-side only (D2). FALSE (default) = S1 behaviour, 907, which takes precedence over every other opener handling (SPEC-REVIEW #10). TRUE = a fresh exchange; a server that allows some reauthentications and refuses others is not modelled.

## D4. When a client "is unable to obtain the sasl capability" (S2-3)

> "If a client requires pre-authentication and is unable to obtain the sasl capability, then the client MUST disconnect and MAY retry the connection." (S2:33-34)

**Settled:** "unable to obtain" is one of three events, for a client that wants SASL and is not logged in: sasl is absent from the final LS; sasl is DELed before it was ACKed; or a REQ for sasl *alone* is NAKed. A NAK of a multi-cap REQ does not count: REQ is atomic (CN-11), so that NAK says nothing about sasl by itself and the client can retry singly.
**Model:** the client flag `cli.unable` is set on those events and never cleared, so the obligation cannot lapse when sasl later comes back (SPEC-REVIEW #9). `CEnd` is guarded on it; `CQuitOblig` is weakly fair; `RequiredQuits` checks that a disconnect follows. `MaxReq` is now only an exploration bound and no longer changes the predicate (SPEC-REVIEW #5).
**Spec gap:** the rule covers only the *cap*. A required-SASL client whose authentication *fails* (904) is not told to disconnect, so the spec lets it send `CAP END` and register unauthenticated. The model keeps this permissive and reports it with witness `W_RequiredUnauth`, which now requires a 904 to have ended an exchange first.

## D5. DEL of sasl during an exchange (CN-21)

> "Servers MUST cancel any capability-specific behavior for a client after sending the CAP DEL message to the client." (CN:456-457)

**Model:** the server drops its exchange silently. The client, on receiving the DEL, also drops its exchange (CN-19). No numeric is sent.
**Why:** the spec names no numeric for this. Silence is the hardest case for the client.

## D6. Failure numerics

902, 904 and 905 all end the exchange as a failure (S1:207-221). The model uses 904 for all three.

## D7. What a server does with AUTHENTICATE when sasl is not enabled

Mostly silent; it only constrains the client (S1-1). Two exceptions: after a successful login S1-13 requires 907, and S2-6 requires an appropriate error when reauthentication is unavailable.
**Model:** 907 is checked first, so an authenticated client always gets 907. Otherwise, with sasl not enabled the server either drops the line or answers 904 (free). Ghost flag `gh.strayMech` records that it happened.

## D8. Which caps a server may ACK; why it may NAK

> "The capability identifier set must be accepted as a whole, or rejected entirely." (CN:349)

The spec constrains a NAK's form (whole set, no change: CN:388), not its cause, apart from S2-2 (a NAK is required while auth is down).
**Model:** the server may ACK only a set it currently offers (plus cap-notify). It must NAK otherwise. With `ArbitraryNak = TRUE` it may also NAK a set it could ACK, except when every cap in it is already enabled or is cap-notify: CN:345-347 and CN:483 require those to succeed (SPEC-REVIEW #7, #3). A REQ naming a cap that was DELed while the REQ was in flight is therefore NAKed as a whole, so the other caps in the same REQ are NAKed with it.

## D9. Reply order

The spec does not say that ACK/NAK replies come in REQ order (CN:373-388), nor that the parts of one split ACK are adjacent. **Model:** with `ReorderReplies = TRUE` the server answers queued REQs in any order and may answer other REQs, or start other split ACKs, between the parts of a split ACK. With `FALSE` it answers the oldest REQ next and finishes a split ACK before the next answer. NEW/DEL may come between ACK parts either way (CN:416-418). Checks against a client keep `ReorderReplies = TRUE`.

## D10. AUTHENTICATE `*` with no exchange running

> "The server will send a 906 numeric." (S1:72-73)

Without an exchange the spec is silent. **Model:** free: 906 or nothing.

## D11. Timeouts

S1-4 asks the client to be prepared for timeouts "at all times". The model lets the client abort (`CAbort`) and stop waiting for the 906 (`CGiveUp`) at any moment, with messages still in flight. The server may fail an exchange (904) at any moment (`SrvSaslTimeout`). Neither has a duration; weak fairness only guarantees that a client stuck in an exchange eventually gives up.

## D12. Exchange correlation

SASL lines carry no exchange identifier. After a client gives up on an abort and opens a new exchange, a late 906 or 904 from the old exchange is indistinguishable from a reply to the new one. The model keeps this ambiguity (it is in the protocol) and lets the client treat any terminal numeric as ending its current exchange.

## D13. A REQ after END but before registration suspends registration again

> "If a server receives a REQ subcommand while client registration is in progress, it MUST suspend registration until an END subcommand is received." (CN:355-356)

**Model:** a server that receives REQ before registering sets its hold again, even if it had already seen END. A client that sends a REQ before it has seen 001 (for example after a `CAP NEW`) therefore owes another END (`CReq` clears `endSent`).
**Found by TLC:** the first version let the client send END only once. `Terminates` failed: END, then a REQ crossing it, left the server holding registration forever. Witness `W_ReHold` keeps this path visible.
**Consequence for implementations:** a client that sends END once and then REQs before 001 can hang registration on a server that follows CN:355 to the letter. A server that ignores REQ for holding purposes after END is more lenient than the text.

## D14. cap-notify (CN-23)

> "When implicitly enabled via this mechanism, servers MAY list the `cap-notify` capability in `CAP LS` and `CAP LIST` responses. Clients MAY also request the capability with `CAP REQ`, and capable servers MUST accept and `CAP ACK` the request without side effects." (CN:481-483)

**Model:** `cap-notify` is a third cap name that CAP LS 302 enables implicitly. The server may list it in LS, never DELs it, and must ACK any REQ made only of it and already enabled caps (`RuleRedundantAck`). With `ReqCapNotify = TRUE` the client may request it even when unadvertised. It is off in `Small.cfg`, because the extra REQ choices make the state space several times larger, and on in `CapNotify.cfg`.

## D15. ACK continuation has no wire marker

> "If an ACK reply originating from the server is spread across multiple lines, a client MUST NOT change capabilities until the last ACK of the set is received." (CN:380-381)

CN defines the `*` continuation parameter only for LS and LIST (CN:282-288); the ACK format at CN:373-378 has none. **Model:** ACK lines carry no marker (`more` is always FALSE on ACK). The client learns that a set is complete only from its contents: the caps ACKed so far equal the REQ they belong to (D17). nefarious2 sends `*` on multi-line ACKs to 302 clients, an extension Seance relies on (`CODE-FINDINGS.md`).

## D16. "Completed or needs to be aborted" (S1-3)

> "it is RECOMMENDED to only send CAP END when the SASL exchange is completed or needs to be aborted" (S1:37-39)

**Model:** no switch. An END sent mid-exchange is the client choosing to abort it, which the server then handles by S1-14, so the recommendation does not restrict when the model client may send END (SPEC-REVIEW #11). (v2's `RecommendEnd` switch is gone.)

## D17. Attributing ACK and NAK lines: an ambiguity, and the safe client strategies

With no ACK continuation marker (D15) and no reply-order rule (D9), a client with several REQs outstanding cannot always tell which REQ an ACK line answers, or whether it is the whole reply. With overlapping pipelined REQs a prefix has genuinely several readings: `REQ :sasl` and `REQ :sasl a` outstanding, a first line `ACK :sasl` may be the whole reply to the first or the first part of the reply to the second. A client that commits on such a prefix can break CN:380-381; one that waits may wait for ever.

This is a property of the client's choice of REQs, not an inevitable disagreement between conforming peers. Safe strategies (SPEC-REVIEW-3 #3):

- **Serialised REQs**: one REQ outstanding at a time; every ACK line belongs to it.
- **Disjoint outstanding REQs**: an ACK line's caps lie inside exactly one outstanding REQ; collect per REQ until the set is complete. Serialising is the special case of one.
- **NAK membership**: a NAK lists the whole set (CN:349, 384-388), so it equals exactly one outstanding REQ when they are disjoint.
- **In-order complete sets**: if the server answers in REQ order and never interleaves ACK sets, first-in first-out accumulation is sound. Merely starting replies in order is not enough.

First-in first-out matching (v3's client) is not safe on its own: with replies reordered, `REQ :sasl` then `REQ :a` answered `ACK :a`, `ACK :sasl` merges both into one buffer and enables neither (SPEC-REVIEW-3, single-line, no changes).

**Model:** the client keeps its outstanding REQs pairwise disjoint and attributes ACK and NAK lines by their contents (`CReq`, `Owner`). The server may reorder and interleave (D9). Witness of the ambiguity: the mutant that lets the client pipeline overlapping REQs fails `CapsAgree` (README, mutation table).

## D18. A cap DELed while a split ACK is open

CN-14 (CN:380-382) says caps change after the last ACK part; CN-21 (CN:456-457) says a DELed cap's behaviour is cancelled. The spec does not say what a split ACK that is half sent enables when one of its caps is DELed in between. **Model:** the DEL cancels that cap for the pending ACK, on both sides. The server drops it from what the split will enable; the last part still lists the rest of the requested set as asked, so the client's completeness test (caps so far equal the REQ) is unchanged. The client drops the cap from what that REQ will enable if, and only if, the first ACK part arrived before the DEL. On one ordered stream that holds exactly when the server sent the first part before the DEL and the last part after it, so the two ends agree. A DEL before any part is sent makes the REQ un-ACKable (D8: NAK) unless a NEW brings the cap back before the server answers; a DEL after the last part simply removes an enabled cap. `RuleNoSaslAckIfDown` and `RuleSaslNakIfDown` therefore apply to answers (a whole ACK or a split's first part), not to every ACK line: a split's last part may name a cap DELed since its first part. This is a chosen reading, not one the spec supplies (SPEC-REVIEW-4). Witness: `W_DelInSplit`; check: `ProbeDelSplit.cfg`.

## D19. The send boundary

**Model:** a server step that appends a line to `sout` has sent it in the specs' sense. The append is irrevocable, and every "after sending" effect happens in that step: CN-14's enabling with the last ACK part, S2-7's close after the 904 reason. `SrvSend` is transport delivery: it moves sent lines to the client in order, and it may still flush after ERROR has been sent (the connection is closing). Nothing is sent after ERROR (`srv.closed` stops every sending step). The server sends ERROR (`SrvFailClose`) only after every line it owes: 900/903 of an earlier success, the 001 after 906, the LS rest, the last part of an open split ACK. Queued REQs may go unanswered. The client's QUIT is told apart (`srv.peerQuit`): only it excuses owed lines (`OwedSent`).

## D20. Order of 900, 903 and 001

S1:79 (and S1:199-213) says success is 900 and 903; it orders neither against the other, nor against 001. **Model:** a success owes one 900 and one 903 (counters `owe900`, `owe903`, independent of later exchanges); `Srv900` and `Srv903` send them in either order with other output between (`W_903First`, `W_Between`), and registration may complete while either is owed (`W_Welcome903`). A 903 after 001 arrives outside any exchange (`W_LateReply`, D12). `SuccAccounting` checks that every success sends exactly one of each.

## D21. 907 for every AUTHENTICATE line after a successful login

> "If the client attempts to issue the AUTHENTICATE command after already authenticating successfully, the server MUST reject it with a 907 numeric." (S1:81-82)

**Found by trace validation against Ergo** (`ERGO.md`): a client that sent its response and `AUTHENTICATE *` together got 900, 903, then 907 for the `*`. v5 gave 907 only to an opener and let a stray `*` get 906 or nothing (D10), so it rejected that run. The text says "the AUTHENTICATE command", which a response line or `*` is as much as an opener. **Model (v6):** without `Reauth`, any AUTHENTICATE line that reaches the server after a successful login, with no exchange running, gets 907 (`Late907` in `SrvData` and `SrvAbort`; `Rule907` covers all three line kinds). With `Reauth`, D10 still applies to a stray `*`.

## D22. An LS line may carry none of the modelled caps

> "If the client supports CAP version `302`, the server MAY send multiple lines in response to `CAP LS`" (CN:282)

**Found by trace validation against nefarious2** (live, with services): its first LS line held sasl, cap-notify and server-time, and the last line held only caps outside the model. The model's caps are an abstraction (`OtherCaps`), so a line that lists only other caps is a line that lists none of the model's. v6 required both lines to hold some modelled cap (`Splits`). **Model (v7):** the first of two LS lines may hold any part of the offered set, including all of it or none (`LsSplits(S) == SUBSET S`), and the last line lists the rest, possibly empty. `W_LsAllFirst` reaches the all-first case.

## D23. The challenge is a separate step

> "The initial client message specifies the SASL mechanism to be used. (When this is received, the IRCD will attempt to establish an association with a SASL agent.) If this fails, a 904 numeric will be sent" (S1:44-47); "Clients SHOULD be prepared for timeouts at all times during the SASL authentication." (S1:39-40)

**Found by refinement of Seance's code model** (Seance `test/formal/handshake/Handshake.tla`, whose server is nefarious2): the server forwards the opener to services and may time out (904), be aborted by the client (906) or lose the services link before any `AUTHENTICATE +` goes out. v6 sent `AUTHENTICATE +` in the step that read the opener, so nothing could happen in between. **Model (v7):** an opener with the backend up opens the exchange (`srv.sasl = "open"`), and `SrvChallenge` sends `AUTHENTICATE +` in a later step (weakly fair). `SrvSaslTimeout`, `SrvAbort`, `SrvRegister` and a DEL of sasl act on an open exchange as on one awaiting the response (`Active`). With the backend down the opener still gets 904 at once (S1-5). With `Reauth` and a login, the opener still gets its answer in the same step (`RuleAuthedOpenerAnswered`; reauthentication belongs to the wider SASL model). `W_FailBeforeChal` reaches a 904 or 906 before the challenge.

## D24. A response that finds no exchange may be read as an opener

> "There are two forms of the AUTHENTICATE command: initial client message and later messages." (S1:42-43)

**Found by refinement of Seance's code model**, and seen live on nefarious2: after a server timeout, the client's late `AUTHENTICATE <response>` reached a server with no exchange, which took it as a new opener (another `AUTHENTICATE +`, or a 904). SASL lines carry no exchange identifier (D12's ambiguity), so a server cannot tell a late response from an opener naming an odd mechanism. v6 let such a line be ignored only. **Model (v7):** a response that finds no exchange is ignored, or handled as an opener (`SrvData` calls `SrvMech`); after a login without `Reauth` it still gets 907 (D21). This extends D12's ambiguity rather than resolving it (SPEC-REVIEW-7 #2): a client that reads the timeout 904 and retries is in `mech` when the stray `AUTHENTICATE +` arrives, and takes it for its retry's challenge. Nothing in the text forbids that, so the model keeps it; a stray challenge is not always ignored. The model's mechanisms carry no identity, so it does not decide whether a given payload names a supported mechanism (S1:231 and S2:77-78 are out of scope). `W_StrayOpen` reaches the state.

## D25. END before LS is complete, for a client that does not want SASL

> "Upon receiving either a `CAP LS` or `CAP REQ` command during connection registration, the server MUST not complete registration until the client sends a `CAP END` command" (CN:69-71). Nothing requires the client to wait for the LS reply before sending END.

**Found by running irctest through the harness:** its registration helper sends `CAP LS 302`, `NICK`, `USER` and `CAP END` together. v6's client sent END only after reading the whole LS (`cli.lsDone`), so those connections were outside the model. **Model (v7):** a client that does not want SASL may send END at any time after its `CAP LS 302`; one that wants SASL still reads LS first (it needs to know whether sasl is there, S2-3). `W_EarlyEnd` reaches it. Still outside the model client: `CAP REQ` without `CAP LS` ("to blindly request", CN:65), version-less `CAP LS`, removal (`-cap`) and multi-step mechanisms.

## D26. Liveness runs split by environment

This is a checking method, not a reading of the spec. RefLiveness ran to 310.85M distinct states without finishing (job stopped 2026-11-10). **Method:** `hpc/split-env.py --liveness` writes one module per environment, which TLC then checks one at a time: creds × (wantSasl, required) × svcOk, the 12 values Init allows. Each module's spec is `SliceInit /\ [][Next]_vars /\ SrvFair /\ CliFair`, where SliceInit is Init with env pinned. These modules have no VIEW and no symmetry, and every invariant and property of the base config is kept.

**Why it is sound:** env is chosen in Init and never changes. So each behaviour of Spec is a behaviour of exactly one slice, and the slices together have exactly the behaviours of Spec. A temporal property is checked per behaviour. So Spec satisfies it if and only if every slice does. The safety VIEW (SafetyView) is not used here, because a VIEW can merge states that liveness must tell apart.

**Checks** (gpu05, `spec-handshake/v7-split/`):
- Tiny is checked unsplit and as 12 slices. Both must pass, and the slices' initial states must add up to Tiny's.
- Four negative controls on Tiny's slices each drop one WF conjunct: SrvAnswer, Srv903, Srv001 and CQuitOblig. Each must make its property fail (AnswersEventually, OwedSent, Terminates and RequiredQuits) in at least one slice.
- Results: see README.

**Results (2026-11-10, jobs 10089–10093):**
- Tiny unsplit: 20,243,764 distinct states and 48 initial states, no error.
- Tiny's 12 slices: all pass. Their initial states sum to 12 × 4 = 48, and their distinct states sum to exactly 20,243,764.
- Controls: each one fails its property in at least one slice.
  - Without SrvAnswer, AnswersEventually fails in 12 of 12 slices.
  - Without Srv903, OwedSent fails in 2 (creds, wantSasl, svcOk).
  - Without Srv001, Terminates (with OwedSent) fails in 4.
  - Without CQuitOblig, RequiredQuits (with Terminates) fails in 4: required, with no creds or no service.

## D27. A client may answer the challenge with `AUTHENTICATE *` (v7.1)

S1-4 lets a client abort an exchange at any time. Up to v7, though, the model's client answered `AUTHENTICATE +` only with its data: CAbort could fire before the challenge was read, or after the data, but not in answer to the challenge. Real clients abort exactly there. For example, HexDroid will not send PLAIN over plaintext and replies `AUTHENTICATE *` (HEXDROID.md, finding 3, where this was flagged as a model gap rather than a client bug).

**Model:** when a client in `mech` reads the challenge, it either sends its data (`data`) or sends `*` (`abort`). The ghost `gh.abortChal` and witness `W_AbortChal` show the new branch is reachable.

The previous model is kept as `.SpecHandshake-v7.tla.ref`. v7.1 reruns lists a–c (probes, Tiny, mutants and witnesses, with the mutants regenerated) and every recorded trace, in `spec-handshake/v7.1/` and `traces-v7.1/`. The large configs are still running on v7. Their v7.1 reruns follow, as split slices.

**D26 addendum: the finer split (`--offered`, 48 slices).** These slices also pin the initial `srv.offered`, which NEW and DEL change later. Their soundness rests on a different argument from env's "never changes": each behaviour has exactly one initial state, and the 48 slices partition Init. So each behaviour belongs to exactly one slice. The sub-slices of one env overlap in what they reach, so their distinct-state counts sum to more than the parent's (Tiny: about 10–20% more). The checks that do apply are these: the initial states sum to 48, every slice passes, and each drop-fair control fails in some slice. The largest sub-slice is about 56% of its parent. For example, Tiny's env 4 has 3.49M distinct states, against 1.96M for its largest sub-slice.

**Run note.** On the large slices the rate falls from about 7M to about 1M states generated a minute at around 300M distinct states. The liveness passes there take up to an hour each. Later large runs (v7.1) use `-lncheck final` through `TLC_EXTRA`, which defers the liveness check to the end without weakening it, and more memory per job.
