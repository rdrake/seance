---------------------------- MODULE MU_SrvKeepAfterDel ----------------------------
(***************************************************************************)
(* IRCv3 SASL as the SPECIFICATIONS describe it, for the parts the        *)
(* handshake spec model (../../spec/model/SpecHandshake.tla) leaves out:  *)
(* several mechanisms and the sasl= mechanism list, 908, AUTHENTICATE     *)
(* payload chunking, multi-step (SCRAM-shaped) mechanisms, the numerics   *)
(* 900-908, reauthentication and account changes (sasl-3.2), and cap      *)
(* values that change (NEW with a new list, DEL during an exchange).      *)
(* Written only from ircv3-specifications @ 9ff58d1 (see ../RULES.md for  *)
(* the rule list and ../DECISIONS.md for interpretation choices).  No     *)
(* implementation's behaviour is modelled here.                           *)
(*                                                                         *)
(* ASSUMED (proved by the handshake model, not re-checked here):          *)
(*  - CAP 302 negotiation works: the client sends CAP LS 302 and is       *)
(*    implicitly cap-notify (CN:229-231, CN:475-479); LS is ONE line;     *)
(*    split LS / split ACK, reply reordering, other caps, cap-notify REQs *)
(*    and the registration hold details are the handshake model's.        *)
(*  - The client REQs sasl ALONE and has at most one REQ outstanding      *)
(*    (the serialised strategy of handshake D17), so ACK/NAK attribution  *)
(*    is trivial.  The client REQs only before its END or after 001, so   *)
(*    handshake D13's re-hold cannot arise.                               *)
(*  - The client follows S1:37-39's recommendation: it sends CAP END only *)
(*    with no exchange running.  END mid-exchange (S1-14 with the         *)
(*    AbortOnReg switch) is the handshake model's; here the server always *)
(*    takes S1-14's SHOULD branch (906, then 001) if it ever registers    *)
(*    with an exchange running.                                           *)
(*  - The send boundary is handshake D19: a server step that appends to   *)
(*    sout has sent that line; SrvSend is delivery.                       *)
(*                                                                         *)
(* EXTENDS the handshake model:                                           *)
(*  - Reauth is three-valued ("none" = handshake Reauth FALSE, S1 907;    *)
(*    "full" = handshake Reauth TRUE, but also after 001 and with the     *)
(*    account able to change; "same" = reauth allowed but a change of     *)
(*    account refused with 907, D9 here).  The CLIENT may reauthenticate  *)
(*    (ClientReauth), which the handshake model scoped out (handshake D2).*)
(*  - Accounts are values: 900 carries the account, 901 unsets it, and    *)
(*    the server's account changes exactly in the step that sends the     *)
(*    900 or 901 (D3).  The handshake model has a login flag only.        *)
(*  - 900 and 903 may come in either order (handshake D20), but here the  *)
(*    account changes with the 900, so a 903-first success owes a 900     *)
(*    that carries the account.                                           *)
(*  - 902/904/905 are distinct (handshake D6 folded them into 904).       *)
(* DIFFERS deliberately from the handshake model:                         *)
(*  - A data line that finds no exchange is ignored (or gets 907, handshake *)
(*    D21); handshake D24's "read it as an opener" branch is not repeated *)
(*    here (D12 here).  An AUTHENTICATE <mech> line that arrives during an *)
(*    exchange is a data line on the wire and is read as a short chunk.   *)
(*  - BOUND: the server reads no AUTHENTICATE line while a 900, 903 or a  *)
(*    904 that follows a 908 is still owed (SRecv's guard).  This only    *)
(*    delays reads; handshake D20/M2Owe covers owed lines that overlap a  *)
(*    later exchange.                                                     *)
(*                                                                         *)
(* OUT OF SCOPE: server-first mechanisms (every mechanism here is client- *)
(* first, S1:50-51); the Base64 content and the bytes of a payload (sizes *)
(* are counted in 400-byte chunks); CAP LIST, 410, CAP versions, "-cap"   *)
(* removals; the required-SASL disconnect (S2-3, handshake D4); multi-cap *)
(* REQs; the 001 hold beyond "after END".                                 *)
(*                                                                         *)
(* Chunks (S1:58-63): a payload is [n, full]: n = 0 is empty ("+"); else  *)
(* n chunks, the last exactly 400 bytes if full.  On the wire: FULL is an *)
(* exactly-400-byte line, SHORT a 1..399-byte line, PLUS is "+", LONG a   *)
(* line over 400 bytes (never sent by the model client; S1:219 905).      *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Mechs,          \* mechanism names a server may support, e.g. {"P", "S", "X"}
    CliMechs,       \* mechanisms the client implements (S2:48-49: lists may name others)
    TwoRound,       \* SCRAM-shaped mechanisms (subset of Mechs): response, then a
                    \* non-empty final server challenge, then an empty response (S1-9)
    Accounts,       \* accounts services may log the client into, e.g. {"a1", "a2"}
    MaxChunks,      \* largest payload, in chunks (exploration bound)
    MaxLen,         \* server's response limit in chunks (S1:64 MAY); > MaxChunks = none
    MaxAtt,         \* openers the client may send (exploration bound; S1:48 MAY retry)
    MaxReq,         \* REQs the client may send (exploration bound)
    MaxEnv,         \* environment events: NEW/DEL of sasl, list changes, logouts
    Reauth,         \* server: "none" | "full" | "same" (S2-6; D8, D9)
    ClientReauth,   \* client may authenticate after a login and after 001 (S2:62-63; D7)
    AdvertValue,    \* server lists mechanisms as the sasl value (S2:38-39 SHOULD)
    Send908,        \* server MAY send 908 for an unsupported mechanism (S1:231; D4)
    PickListed,     \* client picks from the advertised list when it can (S2:73 SHOULD)
    SilentChange    \* the mechanism set may change without a NEW (D11)

ASSUME Reauth \in {"none", "full", "same"}
ASSUME CliMechs \subseteq Mechs /\ TwoRound \subseteq Mechs
ASSUME MaxChunks \in 1..3 /\ MaxLen \in 1..4

\* Messages have one shape so that TLC compares like with like.
\*   m: mechanism of an opener; L/hv: the sasl value (mechanism list, and
\*   whether there is a value at all); a: account of a 900; on: sasl listed in LS.
Msg(t) == [t |-> t, m |-> "", L |-> {}, hv |-> FALSE, a |-> "", on |-> FALSE]
M(t) == Msg(t)
MechMsg(mech) == [Msg("AUTHMECH") EXCEPT !.m = mech]
AccMsg(t, acc) == [Msg(t) EXCEPT !.a = acc]
ListMsg(t, S) == [Msg(t) EXCEPT !.L = S, !.hv = TRUE]
\* LS / NEW / DEL about sasl; the value is sent only with AdvertValue (S2:38).
CapMsg(t, on, S) == [t |-> t, m |-> "", L |-> IF AdvertValue /\ on THEN S ELSE {},
                     hv |-> AdvertValue /\ on, a |-> "", on |-> on]

NoVal == [hv |-> FALSE, L |-> {}]
MechSets == (SUBSET Mechs) \ {{}}

Data == {"FULL", "SHORT", "PLUS", "LONG"}
Term == {"SHORT", "PLUS"}                  \* lines that end a response
AuthLine(t) == t \in Data \cup {"AUTHMECH", "STAR"}

Payloads == {p \in [n : 0..MaxChunks, full : BOOLEAN] : p.n = 0 => ~p.full}
Empty == [n |-> 0, full |-> FALSE]
NonEmpty == Payloads \ {Empty}
Fulls(k) == [i \in 1..k |-> "FULL"]
\* S1:58-63: 400-byte chunks; "+" after a final chunk of exactly 400 bytes;
\* an empty response is "+".
Lines(p) == IF p.n = 0 THEN <<"PLUS">>
            ELSE IF p.full THEN Fulls(p.n) \o <<"PLUS">>
            ELSE Fulls(p.n - 1) \o <<"SHORT">>
\* The client's chunker, written out separately so a mutant can break it alone.
CliLines(p) == IF p.n = 0 THEN <<"PLUS">>
               ELSE IF p.full THEN Fulls(p.n) \o <<"PLUS">>   \* cli-exact
               ELSE Fulls(p.n - 1) \o <<"SHORT">>             \* cli-short

Rounds(mech) == IF mech \in TwoRound THEN 2 ELSE 1
Active == {"open", "resp", "decide"}

VARIABLES
    c2s,   \* client -> server, one ordered stream
    s2c,   \* server -> client, delivered and not yet read
    sout,  \* server lines sent (handshake D19) and not yet delivered
    srv,   \* server state for this connection
    cli,   \* client state
    gm,    \* ghost monitors read by Rule* properties (never by a guard)
    gw     \* ghost witness flags (never read by a guard or a Rule*)

vars == <<c2s, s2c, sout, srv, cli, gm, gw>>

Init ==
    /\ c2s = <<M("CAPLS")>>                 \* CAP LS 302; NICK/USER assumed
    /\ s2c = <<>>
    /\ sout = <<>>
    /\ \E up \in BOOLEAN, S \in MechSets :
         srv = [offered |-> up, supp |-> S, enabled |-> FALSE, lsSeen |-> FALSE,
                endSeen |-> FALSE, reg |-> FALSE, owe001 |-> FALSE,
                sasl |-> "idle", mech |-> "", round |-> 0, got |-> 0, cout |-> <<>>,
                account |-> "", succeeded |-> FALSE, succN |-> 0,
                owe900 |-> "", owe903 |-> FALSE, owe904 |-> FALSE,
                failed |-> FALSE, closed |-> FALSE, peerQuit |-> FALSE, envN |-> 0]
    /\ cli = [lsDone |-> FALSE, avail |-> FALSE, known |-> NoVal, enabled |-> FALSE,
              reqOut |-> FALSE, reqs |-> 0,
              sasl |-> "idle", mech |-> "", round |-> 0, cin |-> 0, out |-> <<>>,
              att |-> 0, account |-> "", endSent |-> FALSE, welcomed |-> FALSE,
              quit |-> FALSE, closed |-> FALSE]
    /\ gm = [en |-> FALSE, cliLast |-> "none", srvLast |-> "none",
             sTerm |-> FALSE, sResp |-> 0, n900 |-> 0, n903 |-> 0]
    /\ gw = [mech908 |-> "", okMech |-> "", multi |-> FALSE, exactPlus |-> FALSE,
             limit |-> FALSE, twoRound |-> FALSE, chalChunk |-> FALSE,
             abortMid |-> FALSE, acctChange |-> FALSE, postReg |-> FALSE,
             failLogout |-> FALSE, out901 |-> FALSE, relogin |-> FALSE,
             refuse907 |-> FALSE, late907 |-> FALSE, postRegErr |-> FALSE,
             newList |-> FALSE, newSasl |-> FALSE, delMid |-> FALSE, stale |-> FALSE]

-----------------------------------------------------------------------------
(* Server: handlers for one client line.  Each fixes srv' and sout'.      *)

SrvLS ==
    /\ sout' = Append(sout, CapMsg("LS", srv.offered, srv.supp))   \* S2-4, CN:270-271
    /\ srv' = [srv EXCEPT !.lsSeen = TRUE]

\* sasl alone (assumed above); ACK only while the auth layer is up (S2-2).
SrvReq ==
    IF srv.offered
    THEN sout' = Append(sout, M("ACK")) /\ srv' = [srv EXCEPT !.enabled = TRUE]
    ELSE sout' = Append(sout, M("NAK")) /\ srv' = srv                 \* S2-2, CN-15

SrvEnd == sout' = sout /\ srv' = [srv EXCEPT !.endSeen = TRUE]      \* CN-16 after 001

\* Handshake D21: without reauth, every AUTHENTICATE line after a successful
\* login that finds no exchange gets 907.
Late907 == srv.succeeded /\ Reauth = "none" /\ srv.sasl \notin Active

\* S1:64: no numeric is named for the total-length limit; 904 or 905 (D6).
LimitFail ==
    /\ \E n \in {"904", "905"} : sout' = Append(sout, M(n))
    /\ srv' = [srv EXCEPT !.sasl = "idle", !.got = 0, !.cout = <<>>, !.failed = TRUE]

\* One line of a client response (S1:55-63).  Reassembly: FULL lines are
\* collected; SHORT or PLUS ends the response.  Data outside a response
\* (or before the server's challenge has been fully sent) is ignored (D12),
\* or gets 907 (Late907).
SrvChunk(t) ==
    IF Late907
    THEN sout' = Append(sout, M("907")) /\ srv' = srv                 \* S1-13, hs D21
    ELSE IF srv.sasl # "resp" \/ srv.cout # <<>>
    THEN sout' = sout /\ srv' = srv                                   \* D12
    ELSE IF t = "LONG"                                                \* S1:219
    THEN /\ sout' = Append(sout, M("905"))
         /\ srv' = [srv EXCEPT !.sasl = "idle", !.got = 0, !.cout = <<>>, !.failed = TRUE]
    ELSE IF t = "FULL"
    THEN IF srv.got + 1 > MaxLen THEN LimitFail
         ELSE sout' = sout /\ srv' = [srv EXCEPT !.got = @ + 1]       \* more to come
    ELSE IF t = "SHORT" /\ srv.got + 1 > MaxLen
    THEN LimitFail
    ELSE sout' = sout /\ srv' = [srv EXCEPT !.sasl = "decide", !.got = 0]  \* complete

\* An opener (S1:45-51, S2-6).  Checked in this order: an exchange running
\* (then the line is data, D12); 907 after a login without reauth (S1-13,
\* hs D3); sasl not enabled (hs D7: drop or 904); after 001 without reauth
\* support (S2:63-65, D8: 904); an unsupported mechanism (904, or 908 now
\* and 904 later, D4); else association may fail (904, S1:45-48) or the
\* exchange opens and the challenge follows in a later step (hs D23).
SrvMech(mech) ==
    IF srv.sasl \in Active
    THEN SrvChunk("SHORT")
    ELSE IF srv.succeeded /\ Reauth = "none"
    THEN sout' = Append(sout, M("907")) /\ srv' = srv  \* opener-907
    ELSE IF ~srv.enabled
    THEN \/ sout' = sout /\ srv' = srv
         \/ sout' = Append(sout, M("904")) /\ srv' = [srv EXCEPT !.failed = TRUE]
    ELSE IF srv.reg /\ Reauth = "none"
    THEN sout' = Append(sout, M("904")) /\ srv' = [srv EXCEPT !.failed = TRUE]
    ELSE IF mech \notin srv.supp
    THEN \/ sout' = Append(sout, M("904")) /\ srv' = [srv EXCEPT !.failed = TRUE]
         \/ /\ Send908
            /\ sout' = Append(sout, ListMsg("908", srv.supp))         \* S1:231
            /\ srv' = [srv EXCEPT !.failed = TRUE, !.owe904 = TRUE]
    ELSE \/ sout' = Append(sout, M("904")) /\ srv' = [srv EXCEPT !.failed = TRUE]
         \/ /\ sout' = sout
            /\ srv' = [srv EXCEPT !.sasl = "open", !.mech = mech, !.round = 1,
                                  !.got = 0, !.cout = <<>>]

SrvAbort ==
    IF Late907 THEN sout' = Append(sout, M("907")) /\ srv' = srv      \* hs D21
    ELSE IF srv.sasl \in Active
    THEN /\ sout' = Append(sout, M("906"))                            \* S1-10
         /\ srv' = [srv EXCEPT !.sasl = "idle", !.got = 0, !.cout = <<>>]
    ELSE srv' = srv /\ sout' \in {sout, Append(sout, M("906"))}       \* hs D10

\* BOUND (header): AUTHENTICATE lines wait while a success's or a 908's
\* lines are owed.
SuccOwed == srv.owe900 # "" \/ srv.owe903 \/ srv.owe904

SRecv ==
    /\ c2s # <<>> /\ ~srv.closed
    /\ ~(AuthLine(Head(c2s).t) /\ SuccOwed)
    /\ c2s' = Tail(c2s)
    /\ LET m == Head(c2s) IN
       CASE m.t = "CAPLS"    -> SrvLS
         [] m.t = "REQ"      -> SrvReq
         [] m.t = "END"      -> SrvEnd
         [] m.t = "AUTHMECH" -> SrvMech(m.m)
         [] m.t \in Data     -> SrvChunk(m.t)
         [] m.t = "STAR"     -> SrvAbort
         [] m.t = "QUIT"     -> sout' = sout
                                /\ srv' = [srv EXCEPT !.closed = TRUE, !.peerQuit = TRUE]
    /\ UNCHANGED <<s2c, cli>>

(* Server: internal steps. *)

SrvSend ==
    /\ sout # <<>>
    /\ s2c' = Append(s2c, Head(sout))
    /\ sout' = Tail(sout)
    /\ UNCHANGED <<c2s, srv, cli>>

\* The empty initial response of a client-first mechanism (S1:50-51),
\* in its own step (handshake D23).
SrvChallenge ==
    /\ ~srv.closed /\ srv.sasl = "open"
    /\ sout' = Append(sout, M("PLUS"))
    /\ srv' = [srv EXCEPT !.sasl = "resp", !.got = 0]
    /\ UNCHANGED <<c2s, s2c, cli>>

\* A non-empty challenge goes out one chunk per step (S1:55-63); other
\* lines may come between (S1:56-57).
SrvChalLine ==
    /\ ~srv.closed /\ srv.cout # <<>>
    /\ sout' = Append(sout, M(Head(srv.cout)))
    /\ srv' = [srv EXCEPT !.cout = Tail(@)]
    /\ UNCHANGED <<c2s, s2c, cli>>

\* Services act on a complete response.  Not the last round: a non-empty
\* (final, S1:69-70) challenge.  Last round: success with some account
\* (900 now and 903 owed, or 903 now and 900 owed, hs D20, D3), a refused
\* change of account under "same" (907, D9), failure (902 or 904,
\* S1:207-217), or (after an earlier login, with reauth) failure that also
\* logs out: 901 now and 904 owed (D10).
SrvDecide ==
    /\ ~srv.closed /\ srv.sasl = "decide"
    /\ IF srv.round < Rounds(srv.mech)
       THEN \E p \in NonEmpty :
              /\ sout' = sout
              /\ srv' = [srv EXCEPT !.sasl = "resp", !.round = @ + 1, !.got = 0,
                                    !.cout = Lines(p)]
       ELSE LET idle == [srv EXCEPT !.sasl = "idle", !.got = 0] IN
            \/ \E a \in Accounts :
                 IF Reauth = "same" /\ srv.account \notin {"", a}
                 THEN sout' = Append(sout, M("907")) /\ srv' = idle   \* decide-907
                 ELSE \/ /\ sout' = Append(sout, AccMsg("900", a))
                         /\ srv' = [idle EXCEPT !.account = a, !.owe903 = TRUE,
                                      !.succeeded = TRUE, !.succN = @ + 1]
                      \/ /\ sout' = Append(sout, M("903"))
                         /\ srv' = [idle EXCEPT !.owe900 = a,
                                      !.succeeded = TRUE, !.succN = @ + 1]
            \/ \E n \in {"902", "904"} :
                 sout' = Append(sout, M(n)) /\ srv' = [idle EXCEPT !.failed = TRUE]
            \/ /\ srv.account # "" /\ Reauth # "none"
               /\ sout' = Append(sout, AccMsg("901", ""))
               /\ srv' = [idle EXCEPT !.account = "", !.failed = TRUE, !.owe904 = TRUE]
    /\ UNCHANGED <<c2s, s2c, cli>>

\* The account changes in the step that sends 900 (D3).
Srv900 ==
    /\ ~srv.closed /\ srv.owe900 # ""
    /\ sout' = Append(sout, AccMsg("900", srv.owe900))
    /\ srv' = [srv EXCEPT !.account = srv.owe900, !.owe900 = ""]
    /\ UNCHANGED <<c2s, s2c, cli>>

Srv903 ==
    /\ ~srv.closed /\ srv.owe903
    /\ sout' = Append(sout, M("903"))
    /\ srv' = [srv EXCEPT !.owe903 = FALSE]
    /\ UNCHANGED <<c2s, s2c, cli>>

\* The 904 after a 908 (D4) or after a 901 (D10), in a later step.
Srv904 ==
    /\ ~srv.closed /\ srv.owe904
    /\ sout' = Append(sout, M("904"))
    /\ srv' = [srv EXCEPT !.owe904 = FALSE]
    /\ UNCHANGED <<c2s, s2c, cli>>

\* The server gives up at any time (S1:39-40, hs D11).
SrvTimeout ==
    /\ ~srv.closed /\ srv.sasl \in Active
    /\ sout' = Append(sout, M("904"))
    /\ srv' = [srv EXCEPT !.sasl = "idle", !.got = 0, !.cout = <<>>, !.failed = TRUE]
    /\ UNCHANGED <<c2s, s2c, cli>>

\* After END (CN-3).  With an exchange running: S1-14's SHOULD, 906 now and
\* 001 later (the handshake model has the other branch).
SrvRegister ==
    /\ ~srv.closed /\ ~srv.reg /\ srv.endSeen
    /\ IF srv.sasl \in Active
       THEN /\ sout' = Append(sout, M("906"))
            /\ srv' = [srv EXCEPT !.reg = TRUE, !.owe001 = TRUE, !.sasl = "idle",
                                  !.got = 0, !.cout = <<>>]
       ELSE sout' = Append(sout, M("001")) /\ srv' = [srv EXCEPT !.reg = TRUE]
    /\ UNCHANGED <<c2s, s2c, cli>>

Srv001 ==
    /\ ~srv.closed /\ srv.owe001
    /\ sout' = Append(sout, M("001"))
    /\ srv' = [srv EXCEPT !.owe001 = FALSE]
    /\ UNCHANGED <<c2s, s2c, cli>>

Owed == SuccOwed \/ srv.owe001 \/ srv.cout # <<>>

\* S2-7: MAY disconnect after a failed authentication, reason already sent;
\* every owed line goes first (hs D19).
SrvFailClose ==
    /\ ~srv.closed /\ srv.failed /\ ~Owed
    /\ sout' = Append(sout, M("ERROR"))
    /\ srv' = [srv EXCEPT !.closed = TRUE]
    /\ UNCHANGED <<c2s, s2c, cli>>

\* Environment (bounded by MaxEnv), after LS was handled (CN-17):
\*  - DEL sasl: the auth layer goes; the exchange is cancelled silently
\*    (CN-21, hs D5); owed lines of a decided exchange stay owed (D13);
\*  - NEW sasl with a list (S2:53-58, S2:103-108);
\*  - NEW sasl with a new list while offered: a value update (CN:420,
\*    CN:442-443; D11); sasl stays enabled;
\*  - SilentChange: the set changes with no NEW (D11);
\*  - logout by other means: 901 (S1:203-205; "authentication lost", S2:22).
EnvChange ==
    /\ ~srv.closed /\ srv.lsSeen /\ srv.envN < MaxEnv
    /\ \/ /\ srv.offered
          /\ sout' = Append(sout, CapMsg("DEL", FALSE, {}))
          /\ srv' = [srv EXCEPT !.offered = FALSE, !.enabled = FALSE, !.envN = @ + 1,
                       !.got = @]
       \/ /\ ~srv.offered
          /\ \E S \in MechSets :
               /\ sout' = Append(sout, CapMsg("NEW", TRUE, S))
               /\ srv' = [srv EXCEPT !.offered = TRUE, !.supp = S, !.envN = @ + 1]
       \/ /\ srv.offered /\ AdvertValue
          /\ \E S \in MechSets \ {srv.supp} :
               /\ sout' = Append(sout, CapMsg("NEW", TRUE, S))
               /\ srv' = [srv EXCEPT !.supp = S, !.envN = @ + 1]
       \/ /\ SilentChange
          /\ \E S \in MechSets \ {srv.supp} :
               sout' = sout /\ srv' = [srv EXCEPT !.supp = S, !.envN = @ + 1]
       \/ /\ srv.account # "" /\ srv.owe900 = ""
          /\ sout' = Append(sout, AccMsg("901", ""))
          /\ srv' = [srv EXCEPT !.account = "", !.envN = @ + 1]
    /\ UNCHANGED <<c2s, s2c, cli>>

-----------------------------------------------------------------------------
(* Client. *)

InExchange == cli.sasl \in {"mech", "resp", "wait", "abort"}
EndEx == [cli EXCEPT !.sasl = "idle", !.out = <<>>, !.cin = 0]
Known(m) == [hv |-> m.hv, L |-> m.L]

\* A challenge line.  FULL: more to come.  SHORT or PLUS: the challenge is
\* complete; the client answers with a payload (the final challenge of a
\* TwoRound mechanism with an empty one, S1-9) or aborts (S1-4, hs D27).
CData(t) ==
    IF cli.sasl \notin {"mech", "wait"}
    THEN c2s' = c2s /\ cli' = cli
    ELSE IF t = "FULL"
    THEN c2s' = c2s /\ cli' = [cli EXCEPT !.cin = @ + 1]
    ELSE LET r == cli.round + 1 IN
         \/ /\ c2s' = c2s
            /\ \E p \in (IF cli.mech \in TwoRound /\ r = 2 THEN {Empty} ELSE Payloads) :
                 cli' = [cli EXCEPT !.sasl = "resp", !.round = r, !.cin = 0,
                                    !.out = CliLines(p)]
         \/ /\ c2s' = Append(c2s, M("STAR"))
            /\ cli' = [cli EXCEPT !.sasl = "abort", !.round = r, !.cin = 0, !.out = <<>>]

CHandle(m) ==
    CASE m.t = "LS" ->
           c2s' = c2s /\ cli' = [cli EXCEPT !.lsDone = TRUE, !.avail = m.on,
                                   !.known = IF m.on THEN Known(m) ELSE NoVal]
      [] m.t = "ACK" -> c2s' = c2s /\ cli' = [cli EXCEPT !.enabled = TRUE, !.reqOut = FALSE]
      [] m.t = "NAK" -> c2s' = c2s /\ cli' = [cli EXCEPT !.reqOut = FALSE]
      \* D11: the newest value is the client's list; a NEW with no value
      \* leaves it with none.
      [] m.t = "NEW" -> c2s' = c2s /\ cli' = [cli EXCEPT !.avail = TRUE, !.known = Known(m)]
      \* CN-19, hs D5: sasl is cancelled and unavailable, the exchange is
      \* over, and the old list says nothing any more (D11).
      [] m.t = "DEL" ->
           c2s' = c2s /\ cli' = [cli EXCEPT !.avail = FALSE, !.enabled = FALSE, !.known = NoVal,
                                   !.sasl = IF InExchange THEN "idle" ELSE @, !.out = IF InExchange THEN <<>> ELSE @,
                                   !.cin = 0]
      [] m.t \in {"FULL", "SHORT", "PLUS"} -> CData(m.t)
      [] m.t = "900" -> c2s' = c2s /\ cli' = [cli EXCEPT !.account = m.a]
      [] m.t = "901" -> c2s' = c2s /\ cli' = [cli EXCEPT !.account = ""]
      \* Terminal numerics end the current exchange (hs D12: no correlation).
      [] m.t \in {"902", "903", "904", "905", "906", "907"} ->
           c2s' = c2s /\ cli' = IF InExchange THEN EndEx ELSE cli
      \* D4: 908 is not terminal; its list replaces the client's.
      [] m.t = "908" -> c2s' = c2s /\ cli' = [cli EXCEPT !.known = Known(m)]
      [] m.t = "001" -> c2s' = c2s /\ cli' = [cli EXCEPT !.welcomed = TRUE]
      [] m.t = "ERROR" -> c2s' = c2s /\ cli' = [cli EXCEPT !.closed = TRUE]

CLive == ~cli.quit /\ ~cli.closed

CRecv ==
    /\ s2c # <<>> /\ CLive
    /\ s2c' = Tail(s2c)
    /\ CHandle(Head(s2c))
    /\ UNCHANGED <<sout, srv>>

\* One line of the response per step, so other lines (DEL, timeouts, 001)
\* can come between chunks.
CSend ==
    /\ CLive /\ cli.sasl = "resp" /\ cli.out # <<>>
    /\ c2s' = Append(c2s, M(Head(cli.out)))
    /\ cli' = [cli EXCEPT !.out = Tail(@),
                          !.sasl = IF Tail(cli.out) = <<>> THEN "wait" ELSE @]
    /\ UNCHANGED <<s2c, sout, srv>>

\* sasl alone, one REQ at a time, before END or after 001 (header).
CReq ==
    /\ CLive /\ cli.lsDone /\ cli.avail /\ ~cli.enabled /\ ~cli.reqOut
    /\ cli.reqs < MaxReq /\ (~cli.endSent \/ cli.welcomed)
    /\ c2s' = Append(c2s, M("REQ"))
    /\ cli' = [cli EXCEPT !.reqOut = TRUE, !.reqs = @ + 1]
    /\ UNCHANGED <<s2c, sout, srv>>

\* S2:73 SHOULD: pick from the advertised list when it names a mechanism
\* the client implements (S2:48-49: it may name others); else any of the
\* client's own (S2:44-46: no value; D5).
Listed == cli.known.hv /\ CliMechs \cap cli.known.L # {}
Pick == IF PickListed /\ Listed THEN CliMechs \cap cli.known.L ELSE CliMechs

CMech ==
    /\ CLive /\ cli.enabled                                \* S1-1
    /\ cli.sasl = "idle" /\ cli.att < MaxAtt
    /\ IF cli.welcomed THEN ClientReauth ELSE ~cli.endSent \* S1-2 / S2-6 (D7)
    /\ cli.account = "" \/ ClientReauth
    /\ \E mech \in Pick :
         /\ c2s' = Append(c2s, MechMsg(mech))
         /\ cli' = [cli EXCEPT !.sasl = "mech", !.mech = mech, !.round = 0,
                               !.cin = 0, !.out = <<>>, !.att = @ + 1]
    /\ UNCHANGED <<s2c, sout, srv>>

\* S1-4: abort at any time during an exchange, also between chunks.
CAbort ==
    /\ CLive /\ cli.sasl \in {"mech", "resp", "wait"}
    /\ c2s' = Append(c2s, M("STAR"))
    /\ cli' = [cli EXCEPT !.sasl = "abort", !.out = <<>>]
    /\ UNCHANGED <<s2c, sout, srv>>

CGiveUp ==
    /\ CLive /\ cli.sasl = "abort"
    /\ cli' = EndEx
    /\ UNCHANGED <<c2s, s2c, sout, srv>>

\* S1:37-39 followed: END only with no exchange and no REQ running.
CEnd ==
    /\ CLive /\ cli.lsDone /\ ~cli.endSent /\ cli.sasl = "idle" /\ ~cli.reqOut
    /\ c2s' = Append(c2s, M("END"))
    /\ cli' = [cli EXCEPT !.endSent = TRUE]
    /\ UNCHANGED <<s2c, sout, srv>>

CQuit ==
    /\ CLive
    /\ c2s' = Append(c2s, M("QUIT"))
    /\ cli' = [cli EXCEPT !.quit = TRUE]
    /\ UNCHANGED <<s2c, sout, srv>>

-----------------------------------------------------------------------------
(* Ghosts.  Every step updates gm and gw from what it did on the wire.    *)

NewOut == IF Len(sout') > Len(sout) THEN SubSeq(sout', Len(sout) + 1, Len(sout')) ELSE <<>>
NewC2S == IF Len(c2s') > Len(c2s) THEN SubSeq(c2s', Len(c2s) + 1, Len(c2s')) ELSE <<>>
Has(seq, t) == \E i \in 1..Len(seq) : seq[i].t = t
Count(seq, t) == Cardinality({i \in 1..Len(seq) : seq[i].t = t})
\* The server read a line this step / the client read a line this step.
SCons == c2s # <<>> /\ c2s' = Tail(c2s)
CCons == s2c # <<>> /\ s2c' = Tail(s2c)
LastData(seq, old) ==
    LET D == {i \in 1..Len(seq) : seq[i].t \in Data}
    IN IF D = {} THEN old ELSE seq[CHOOSE i \in D : \A j \in D : j <= i].t

GNext ==
    LET sin == IF SCons THEN Head(c2s) ELSE Msg("none")
        cin == IF CCons THEN Head(s2c) ELSE Msg("none")
        opened == srv.sasl \notin Active /\ srv'.sasl = "open"
        \* a line the server read inside its exchange, as data
        \* (only while collecting a response, as SrvChunk does)
        sdata == SCons /\ srv.sasl = "resp" /\ srv.cout = <<>>
                 /\ (sin.t \in Data \/ sin.t = "AUTHMECH")
        sterm == sin.t \in Term \/ sin.t = "AUTHMECH"
        succ == srv'.succN > srv.succN
    IN
    /\ gm' = [en |-> IF CCons /\ cin.t = "ACK" THEN TRUE
                     ELSE IF CCons /\ cin.t = "DEL" THEN FALSE ELSE gm.en,
              cliLast |-> LastData(NewC2S, gm.cliLast),
              srvLast |-> LastData(NewOut, gm.srvLast),
              sTerm |-> IF opened THEN FALSE ELSE IF sdata THEN sterm ELSE gm.sTerm,
              sResp |-> IF opened THEN 0
                        ELSE IF sdata /\ sterm /\ gm.sResp < 3 THEN gm.sResp + 1
                        ELSE gm.sResp,
              n900 |-> gm.n900 + Count(NewOut, "900"),
              n903 |-> gm.n903 + Count(NewOut, "903")]
    /\ gw' = [mech908 |-> IF CCons /\ cin.t = "908" /\ InExchange THEN cli.mech ELSE gw.mech908,
              okMech |-> IF CCons /\ cin.t = "903" /\ InExchange /\ gw.mech908 # ""
                         THEN cli.mech ELSE gw.okMech,
              multi |-> gw.multi \/ (SCons /\ sin.t \in Term /\ srv.sasl = "resp" /\ srv.got >= 1),
              exactPlus |-> gw.exactPlus \/ (SCons /\ sin.t = "PLUS" /\ srv.sasl = "resp" /\ srv.got >= 1),
              limit |-> gw.limit \/ (SCons /\ sin.t \in {"FULL", "SHORT"} /\ srv.sasl = "resp"
                                     /\ srv'.sasl = "idle"),
              twoRound |-> gw.twoRound \/ (succ /\ srv.mech \in TwoRound),
              chalChunk |-> gw.chalChunk \/ (CCons /\ cin.t \in Term
                                             /\ cli.sasl \in {"mech", "wait"} /\ cli.cin >= 1),
              abortMid |-> gw.abortMid \/ (Has(NewC2S, "STAR") /\ cli.out # <<>>),
              acctChange |-> gw.acctChange \/ (srv.account # "" /\ srv'.account \notin {"", srv.account}),
              postReg |-> gw.postReg \/ (succ /\ srv.reg),
              failLogout |-> gw.failLogout \/ (Has(NewOut, "901") /\ srv.sasl = "decide"),
              out901 |-> gw.out901 \/ Has(NewOut, "901"),
              relogin |-> gw.relogin \/ (gw.out901 /\ srv.account = "" /\ srv'.account # ""),
              refuse907 |-> gw.refuse907 \/ (Has(NewOut, "907") /\ srv.sasl = "decide"),
              late907 |-> gw.late907 \/ (Has(NewOut, "907") /\ srv.succeeded /\ Reauth = "none"),
              postRegErr |-> gw.postRegErr \/ (SCons /\ sin.t = "AUTHMECH" /\ srv.reg
                                               /\ srv.enabled /\ ~srv.succeeded
                                               /\ Reauth = "none" /\ Has(NewOut, "904")),
              newList |-> gw.newList \/ (CCons /\ cin.t = "NEW" /\ cli.avail),
              newSasl |-> gw.newSasl \/ (CCons /\ cin.t = "NEW" /\ ~cli.avail),
              delMid |-> gw.delMid \/ (CCons /\ cin.t = "DEL" /\ InExchange),
              stale |-> gw.stale \/ (SCons /\ sin.t = "AUTHMECH" /\ srv.sasl \notin Active
                                     /\ srv.enabled /\ sin.m \notin srv.supp
                                     /\ cli.known.hv /\ sin.m \in cli.known.L)]

G(A) == A /\ GNext

Next ==
    \/ G(SRecv) \/ G(SrvSend) \/ G(SrvChallenge) \/ G(SrvChalLine) \/ G(SrvDecide)
    \/ G(Srv900) \/ G(Srv903) \/ G(Srv904) \/ G(SrvTimeout) \/ G(SrvRegister)
    \/ G(Srv001) \/ G(SrvFailClose) \/ G(EnvChange)
    \/ G(CRecv) \/ G(CSend) \/ G(CReq) \/ G(CMech) \/ G(CAbort) \/ G(CGiveUp)
    \/ G(CEnd) \/ G(CQuit)

\* SrvFair: the server and the network make progress (lines read and
\* delivered, challenges finished, services answer, owed lines sent).
\* CliFair: the client reads, and finishes sending a response it started.
\* No fairness on timeouts or aborts on either side, so ExchangeEnds says
\* the exchange ends because the SERVER answers, not because someone gives up.
SrvFair ==
    /\ WF_vars(G(SRecv)) /\ WF_vars(G(SrvSend)) /\ WF_vars(G(SrvChallenge))
    /\ WF_vars(G(SrvChalLine)) /\ WF_vars(G(SrvDecide)) /\ WF_vars(G(Srv900))
    /\ WF_vars(G(Srv903)) /\ WF_vars(G(Srv904)) /\ WF_vars(G(SrvRegister))
    /\ WF_vars(G(Srv001))
CliFair == WF_vars(G(CRecv)) /\ WF_vars(G(CSend))

Spec == Init /\ [][Next]_vars /\ SrvFair /\ CliFair
EnvSpec == Init /\ [][Next]_vars /\ SrvFair

-----------------------------------------------------------------------------
(* Rule properties.  Server rules look at what a step sends (NewOut) or   *)
(* reads (SCons); client rules at what it writes (NewC2S).  They are      *)
(* monitors for code models mapped onto these variables, so several      *)
(* mirror a guard.                                                        *)

TypeOK ==
    /\ srv.sasl \in {"idle"} \cup Active
    /\ srv.offered \in BOOLEAN /\ srv.supp \in MechSets
    /\ srv.enabled => srv.offered                                  \* S2-1, S2-2
    /\ srv.account \in {""} \cup Accounts /\ srv.owe900 \in {""} \cup Accounts
    /\ srv.got \in 0..MaxLen /\ srv.round \in 0..2
    /\ srv.succN \in 0..MaxAtt
    /\ cli.sasl \in {"idle", "mech", "resp", "wait", "abort"}
    /\ cli.account \in {""} \cup Accounts
    /\ cli.att \in 0..MaxAtt /\ cli.reqs \in 0..MaxReq
    /\ cli.known.L \subseteq Mechs

\* CN-21, hs D5: no exchange survives a DEL of sasl (or runs without it).
DelCancels == ~srv.enabled => (srv.sasl = "idle" /\ srv.cout = <<>>)

\* S1:79, S1:199-213: each success sends exactly one 900 and one 903.
SuccAccounting ==
    /\ gm.n900 + (IF srv.owe900 # "" THEN 1 ELSE 0) = srv.succN
    /\ gm.n903 + (IF srv.owe903 THEN 1 ELSE 0) = srv.succN

\* S1-13 (hs D21): without reauth, every AUTHENTICATE line read after a
\* successful login, outside an exchange, gets 907.
Rule907 ==
    [][(SCons /\ AuthLine(Head(c2s).t) /\ srv.succeeded /\ Reauth = "none"
        /\ srv.sasl \notin Active) => Has(NewOut, "907")]_vars
\* S2:64-65: 907 refuses a change: a step that sends 907 changes no account.
Rule907NoChange == [][Has(NewOut, "907") => srv'.account = srv.account]_vars
\* S1:199-205 (D3): the account changes exactly with a 900 naming the new
\* account or a 901, and those numerics say what the account now is.
RuleAccountNotified ==
    [][/\ srv'.account # srv.account =>
            IF srv'.account = "" THEN Has(NewOut, "901")
            ELSE \E i \in 1..Len(NewOut) : NewOut[i].t = "900" /\ NewOut[i].a = srv'.account
       /\ \A i \in 1..Len(NewOut) :
            /\ NewOut[i].t = "900" => srv'.account = NewOut[i].a
            /\ NewOut[i].t = "901" => srv'.account = ""]_vars
\* S1-10: an abort of a running exchange gets 906.
Rule906 ==
    [][(SCons /\ Head(c2s).t = "STAR" /\ srv.sasl \in Active /\ ~Late907)
       => Has(NewOut, "906")]_vars
\* S2:62-65: once sasl is enabled, an opener is never silently dropped.
RuleOpenerAnswered ==
    [][(SCons /\ Head(c2s).t = "AUTHMECH" /\ srv.enabled /\ srv.sasl \notin Active)
       => (NewOut # <<>> \/ srv'.sasl = "open")]_vars
\* S1:55-63, S1:79: a success follows a COMPLETE final response: the last
\* line the server read in this exchange ended a response, and it has read
\* as many responses as the mechanism has rounds.
RuleVerdictAfterLast ==
    [][(srv'.succN > srv.succN) => (gm.sTerm /\ gm.sResp = Rounds(srv.mech))]_vars
\* S1:58-63 (server side): a success never follows an unterminated challenge.
RuleSrvChalFramed ==
    [][(srv'.succN > srv.succN \/ Has(NewOut, "903")) => gm.srvLast # "FULL"]_vars
\* S1:231 (D4): 908 only for an opener naming an unsupported mechanism,
\* and it lists the supported ones.
Rule908 ==
    [][Has(NewOut, "908") =>
         /\ SCons /\ Head(c2s).t = "AUTHMECH" /\ Head(c2s).m \notin srv.supp
         /\ \A i \in 1..Len(NewOut) : NewOut[i].t = "908" => NewOut[i].L = srv.supp]_vars
\* S2:38-42, CN:270-271: a sasl value lists the supported mechanisms, and
\* only LS and NEW carry values.
RuleValueIsMechs ==
    [][\A i \in 1..Len(NewOut) :
         /\ (NewOut[i].t \in {"LS", "NEW"} /\ NewOut[i].hv) => NewOut[i].L = srv'.supp
         /\ NewOut[i].t \in {"ACK", "NAK", "DEL"} => ~NewOut[i].hv]_vars
\* S2-2: a sasl REQ while the auth layer is down is NAKed.
RuleNakIfDown ==
    [][(SCons /\ Head(c2s).t = "REQ" /\ ~srv.offered) => Has(NewOut, "NAK")]_vars
\* S2-7: ERROR only after a failure has been reported.
RuleFailCloseReason == [][Has(NewOut, "ERROR") => srv.failed]_vars

\* S1-1, CN-19: the client sends AUTHENTICATE lines only while sasl is
\* enabled as far as the lines it has READ say (last ACK vs DEL).
RuleClientAuthOnlyEnabled ==
    [][(\E i \in 1..Len(NewC2S) : AuthLine(NewC2S[i].t)) => gm.en]_vars
\* S1-2 / S2-6 (D7): no opener after 001 unless the client reauthenticates.
RuleClientPostReg ==
    [][Has(NewC2S, "AUTHMECH") => (~cli.welcomed \/ ClientReauth)]_vars
\* S1:58-63: a client that has finished a response ended it with a short
\* chunk or "+" (so "+" follows an exact multiple of 400).
RuleClientFraming == cli.sasl = "wait" => gm.cliLast \in Term
\* S1:58-60: no client line is over 400 bytes.
RuleClientLineLen == [][~Has(NewC2S, "LONG")]_vars
\* S1-9: after the final (non-empty) challenge, the response is empty.
RuleClientEmptyFinal ==
    [][(cli.sasl \in {"mech", "wait"} /\ cli'.sasl = "resp"
        /\ cli'.mech \in TwoRound /\ cli'.round = 2) => cli'.out = <<"PLUS">>]_vars
\* S2:48-49: the client opens only mechanisms it implements; S2:73 (with
\* PickListed): one from the list when the list names one it implements.
RuleClientMech ==
    [][\A i \in 1..Len(NewC2S) : NewC2S[i].t = "AUTHMECH" =>
         /\ NewC2S[i].m \in CliMechs
         /\ (PickListed /\ Listed) => NewC2S[i].m \in cli.known.L]_vars

(* Liveness. *)

\* Every exchange the client starts ends: in 902-907, a DEL of sasl, or a
\* closed connection; under Spec (the client reads and sends what it
\* started; nobody is forced to time out or abort).
ExchangeEnds == [](InExchange => <>(~InExchange \/ cli.closed \/ cli.quit))
\* Owed lines are sent (a challenge in progress, 900/903, the 904 after a
\* 908 or a 901, the 001 after 906); only the client's QUIT excuses them.
OwedSent == [](Owed => <>(~Owed \/ srv.peerQuit))

(* Design invariants: once quiet, both ends agree. *)

Quiet == /\ c2s = <<>> /\ s2c = <<>> /\ sout = <<>> /\ ~Owed
         /\ CLive /\ ~srv.closed /\ cli.sasl = "idle" /\ srv.sasl = "idle"
AccountAgrees == Quiet => cli.account = srv.account
EnabledAgrees == Quiet => cli.enabled = srv.enabled
\* D11: the client's list is the server's set, unless it may change silently.
MechListAgrees ==
    (Quiet /\ ~SilentChange /\ AdvertValue /\ srv.offered /\ cli.avail)
        => cli.known = [hv |-> TRUE, L |-> srv.supp]

\* VIEW for SAFETY-only runs (never with liveness or W_*): drops gw.
SafetyView == <<c2s, s2c, sout, srv, cli, gm>>

(* Witnesses: invariants EXPECTED TO FAIL, each showing that a feature is *)
(* exercised.  Check each alone (W_*.cfg).                                *)
W_LoggedIn      == ~(cli.account # "" /\ cli.welcomed)
W_Retry908      == ~(gw.mech908 # "" /\ gw.okMech # "" /\ gw.okMech # gw.mech908)
W_MultiChunk    == ~gw.multi        \* a response of 2+ lines reassembled
W_ExactPlus     == ~gw.exactPlus    \* "+" after an exact multiple of 400
W_Limit         == ~gw.limit        \* server length limit hit (S1:64)
W_TwoRound      == ~gw.twoRound     \* SCRAM-shaped success, empty final response
W_ChalChunked   == ~gw.chalChunk    \* client reassembled a multi-line challenge
W_AbortMid      == ~gw.abortMid     \* "*" between chunks of a response
W_AccountChange == ~gw.acctChange   \* reauth moved the account a1 -> a2
W_PostReg       == ~gw.postReg      \* success after 001
W_FailLogout    == ~gw.failLogout   \* failed reauth logs out (901, D10)
W_Relogin       == ~gw.relogin      \* 901, then logged in again
W_Refuse907     == ~gw.refuse907    \* "same": change of account refused (D9)
W_Late907       == ~gw.late907      \* S1-13 907
W_PostRegErr    == ~gw.postRegErr   \* "none": opener after 001 gets 904 (D8)
W_NewList       == ~gw.newList      \* NEW sasl=<new list> while offered
W_NewThenAuth   == ~(gw.newSasl /\ cli.account # "")   \* NEW sasl, REQ, login
W_DelMid        == ~gw.delMid       \* DEL of sasl during an exchange
W_StaleList     == ~gw.stale        \* opener of a listed mech no longer supported
W_903First      == ~(srv.owe900 # "")                  \* 903 sent before its 900
=============================================================================
