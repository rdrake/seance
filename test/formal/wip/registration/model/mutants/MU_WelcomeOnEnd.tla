------------------------------ MODULE MU_WelcomeOnEnd ------------------------------
(***************************************************************************)
(* The rest of connection registration, spec-first: PASS, a server's PING *)
(* cookie, 433 during registration, a registration timeout, and metadata  *)
(* set before registration (draft/metadata-2 before-connect) against CAP  *)
(* END and the registration burst.                                        *)
(*                                                                         *)
(* Sources (RULES.md cites them by line):                                 *)
(*   MI  modern-irc index.md            (ircdocs/modern-irc 8f4c3cc)       *)
(*   MC  modern-irc _includes/messages/connection.md                      *)
(*   MA  modern-irc _includes/modern-appendix.md (numerics)               *)
(*   MD  ircv3-specifications extensions/metadata.md (9ff58d1)            *)
(*   CN  ircv3-specifications extensions/capability-negotiation.md        *)
(*                                                                         *)
(* Capability negotiation and SASL are the handshake model's (wip/spec);  *)
(* here they are one flag: CAP LS suspends registration, CAP END resumes  *)
(* it (MI:101, CN; hs D13 for a REQ after END is out of scope, D1).       *)
(* The send boundary is hs D19: a step that appends to s2c or c2s has     *)
(* sent that line.                                                        *)
(*                                                                         *)
(* Only the IRCv3 metadata text and the Modern IRC MUSTs give Rule*       *)
(* properties of every server; the PING cookie and the timeout are        *)
(* specified nowhere and are switches (Cookie, Timeout) with witnesses    *)
(* (DECISIONS D2, D4).                                                    *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    NickList,   \* the nicks the client tries, in order (a sequence)
    Taken,      \* nicks in use on the network (static, D3)
    PassReq,    \* server: "none" (no connection password) | "need"
    CliPasses,  \* what the client may hold: subset of {"none", "right", "wrong"}
    Cookie,     \* server sends a PING during registration and waits for its PONG (D2)
    Meta,       \* server advertises metadata before-connect; the client enables it (D5)
    MetaVals,   \* subset of {0, 1}: keys the client sets before 001
    Timeout,    \* server may end a registration that has not completed (D4)
    NoBatch     \* server may refuse batch while granting metadata (D9)

ASSUME Len(NickList) \in 1..3
ASSUME PassReq \in {"none", "need"}
ASSUME CliPasses \subseteq {"none", "right", "wrong"} /\ CliPasses # {}
ASSUME MetaVals \subseteq {0, 1} /\ MetaVals # {}
ASSUME Cookie \in BOOLEAN /\ Meta \in BOOLEAN /\ Timeout \in BOOLEAN /\ NoBatch \in BOOLEAN

\* TLC configs cannot write a tuple: they bind NickList <- NL1 or NL2.
NL1 == <<"n1">>
NL2 == <<"n1", "n2">>

Nicks == {NickList[i] : i \in 1..Len(NickList)}
ASSUME Taken \subseteq Nicks
FreeNick == Nicks \ Taken # {}

VARIABLES c2s, s2c, srv, cli, hist
vars == <<c2s, s2c, srv, cli, hist>>

M(t, a) == [t |-> t, a |-> a]
Tok == "tok"                 \* the cookie (MC:133 "any non-empty string")

(***************************************************************************)
(* hist is the client's wire, both directions, in the order the client    *)
(* sent and read it: [d |-> "C" | "S", m |-> message].  The client-side   *)
(* rules read it.                                                         *)
(***************************************************************************)
Log(d, m) == hist' = Append(hist, [d |-> d, m |-> m])

Init ==
    /\ c2s = <<>> /\ s2c = <<>> /\ hist = <<>>
    /\ srv = [phase |-> "pre", susp |-> FALSE, nick |-> "", user |-> FALSE,
              pass |-> "none", cookie |-> "none", meta |-> 0, out |-> <<>>,
              batch |-> FALSE, pre |-> FALSE]
    /\ \E p \in CliPasses, v \in MetaVals :
         cli = [pass |-> p, mv |-> v, capls |-> FALSE, passSent |-> FALSE,
                ni |-> 0, need |-> FALSE, user |-> FALSE, metaSent |-> 0,
                endSent |-> FALSE, pings |-> <<>>, welcomed |-> FALSE,
                nick |-> "", closed |-> FALSE,
                reqB |-> FALSE, batch |-> FALSE, acked |-> FALSE, held |-> FALSE]

PassOK == PassReq = "none" \/ srv.pass = "right"

(***************************************************************************)
(* Server                                                                 *)
(***************************************************************************)
Ready ==
    /\ srv.phase = "pre" /\ srv.nick # "" /\ srv.user /\ ~srv.susp
    /\ (~Cookie \/ srv.cookie = "ok")

\* MI:117-126: 001 first, then the burst; the MOTD (or 422) closes it.
\* MD:113, MD:140: with metadata negotiated, a metadata batch targeting the
\* client's own nick, before 376/422, holding what was set before
\* registration; empty if nothing was (D6).  Without batch, metadata is
\* not usable (MD: it requires batch), so there is no batch (D9).
Burst(n) ==
    <<M("001", n)>>
    \o (IF Meta /\ srv.batch
        THEN <<M("BATCH+", n)>> \o (IF srv.meta = 1 THEN <<M("KV", "k")>> ELSE <<>>)
             \o <<M("BATCH-", n)>>
        ELSE <<>>)
    \o <<M("376", "")>>

\* D9 (nefarious2): what was set before registration is dropped at its end
\* if batch was not negotiated by then.
SWelcome ==
    /\ Ready /\ PassOK
    /\ srv' = [srv EXCEPT !.phase = "burst", !.out = Burst(srv.nick),
                          !.meta = IF srv.batch THEN @ ELSE 0,
                          !.pre = srv.pre /\ srv.batch]
    /\ UNCHANGED <<c2s, s2c, cli, hist>>

\* MC:32: a wrong or missing password: 464 SHOULD, then ERROR MAY; at least
\* one of them MUST.  464 alone leaves the connection open but unregistered.
SRefuse ==
    /\ Ready /\ ~PassOK
    /\ \/ s2c' = Append(s2c, M("464", "*")) /\ srv' = [srv EXCEPT !.phase = "refused"]
       \/ s2c' = s2c \o <<M("464", "*"), M("ERROR", "")>> /\ srv' = [srv EXCEPT !.phase = "closed"]
       \/ s2c' = Append(s2c, M("ERROR", "")) /\ srv' = [srv EXCEPT !.phase = "closed"]
    /\ UNCHANGED <<c2s, cli, hist>>

SBurst ==
    /\ srv.phase = "burst" /\ srv.out # <<>>
    /\ s2c' = Append(s2c, Head(srv.out))
    /\ srv' = [srv EXCEPT !.out = Tail(@),
                          !.phase = IF Tail(srv.out) = <<>> THEN "reg" ELSE @]
    /\ UNCHANGED <<c2s, cli, hist>>

\* MC:138 / MI:115: a PING may come at any time during registration (D2).
SPing ==
    /\ Cookie /\ srv.phase = "pre" /\ srv.cookie = "none"
    /\ s2c' = Append(s2c, M("PING", Tok))
    /\ srv' = [srv EXCEPT !.cookie = "sent"]
    /\ UNCHANGED <<c2s, cli, hist>>

\* D4: a registration that has not completed may be ended, with ERROR (MC:230).
STimeout ==
    /\ Timeout /\ srv.phase \in {"pre", "refused"}
    /\ s2c' = Append(s2c, M("ERROR", ""))
    /\ srv' = [srv EXCEPT !.phase = "closed"]
    /\ UNCHANGED <<c2s, cli, hist>>

\* One client line.  A closed server reads nothing.
SRecv ==
    /\ srv.phase # "closed" /\ c2s # <<>>
    /\ c2s' = Tail(c2s)
    /\ LET m == Head(c2s)
           pre == srv.phase = "pre"
       IN CASE m.t = "CAPLS" ->
                 s2c' = s2c /\ srv' = [srv EXCEPT !.susp = pre]
            \* D9: CAP REQ batch, at any point of registration, is ACKed (or,
            \* with NoBatch, may be NAKed): one line, CAPB TRUE or FALSE.
            [] m.t = "REQB" ->
                 IF pre
                 THEN \E ok \in IF NoBatch THEN BOOLEAN ELSE {TRUE} :
                        /\ s2c' = Append(s2c, M("CAPB", ok))
                        /\ srv' = [srv EXCEPT !.batch = ok]
                 ELSE s2c' = s2c /\ srv' = srv
            [] m.t = "CAPEND" ->
                 s2c' = s2c /\ srv' = [srv EXCEPT !.susp = FALSE]
            \* MC:30: only the last PASS counts; after registration, 462 (MA:941).
            [] m.t = "PASS" ->
                 IF pre THEN s2c' = s2c /\ srv' = [srv EXCEPT !.pass = m.a]
                 ELSE s2c' = Append(s2c, M("462", "")) /\ srv' = srv
            \* MC:53: a nick in use gets 433 and the NICK is ignored (D3).
            [] m.t = "NICK" ->
                 IF ~pre THEN s2c' = s2c /\ srv' = srv
                 ELSE IF m.a \in Taken
                 THEN s2c' = Append(s2c, M("433", m.a)) /\ srv' = srv
                 ELSE s2c' = s2c /\ srv' = [srv EXCEPT !.nick = m.a]
            [] m.t = "USER" ->
                 IF pre THEN s2c' = s2c /\ srv' = [srv EXCEPT !.user = TRUE]
                 ELSE s2c' = Append(s2c, M("462", "")) /\ srv' = srv
            \* MC:135: the cookie is answered by a PONG with the same token.
            [] m.t = "PONG" ->
                 s2c' = s2c
                 /\ srv' = IF srv.cookie = "sent" /\ m.a = Tok
                           THEN [srv EXCEPT !.cookie = "ok"] ELSE srv
            \* MD:90, MD:176: METADATA * SET before registration is accepted
            \* only with before-connect, and only aimed at "*" (D5); 761
            \* answers it (MD example 711-730).  After registration the
            \* value is stored but no longer reaches the burst.
            [] m.t = "METASET" ->
                 IF pre /\ Meta /\ m.a = "*"
                 THEN s2c' = Append(s2c, M("761", "*")) /\ srv' = [srv EXCEPT !.meta = 1, !.pre = TRUE]
                 ELSE IF pre
                 THEN s2c' = Append(s2c, M("FAIL", m.a)) /\ srv' = srv
                 ELSE s2c' = Append(s2c, M("761", srv.nick)) /\ srv' = [srv EXCEPT !.meta = 1]
            [] OTHER -> s2c' = s2c /\ srv' = srv
    /\ UNCHANGED <<cli, hist>>

(***************************************************************************)
(* Client                                                                 *)
(***************************************************************************)
Live == ~cli.closed

CSend(m) == c2s' = Append(c2s, m) /\ Log("C", m)

\* MI:90-99: CAP LS 302, PASS, NICK and USER are sent on connection.
CCapLs ==
    /\ Live /\ ~cli.capls
    /\ CSend(M("CAPLS", "302"))
    /\ cli' = [cli EXCEPT !.capls = TRUE]
    /\ UNCHANGED <<s2c, srv>>

\* MI:103: PASS MUST precede the latter of NICK and USER.  The client sends
\* it before either (MI:90-93), so it never strands itself (cli-pass).
PassFirst == cli.pass = "none" \/ cli.passSent
CPass ==
    /\ Live /\ cli.capls /\ cli.pass # "none" /\ ~cli.passSent
    /\ ~(cli.ni >= 1 /\ cli.user)                                    \* cli-pass
    /\ CSend(M("PASS", cli.pass))
    /\ cli' = [cli EXCEPT !.passSent = TRUE]
    /\ UNCHANGED <<s2c, srv>>

\* The first NICK, and after a 433 the next nick in the list (D3).
CNick ==
    /\ Live /\ cli.capls /\ ~cli.welcomed /\ cli.ni < Len(NickList) /\ PassFirst
    /\ cli.ni = 0 \/ cli.need
    /\ CSend(M("NICK", NickList[cli.ni + 1]))
    /\ cli' = [cli EXCEPT !.ni = @ + 1, !.need = FALSE]
    /\ UNCHANGED <<s2c, srv>>

CUser ==
    /\ Live /\ cli.capls /\ ~cli.user /\ PassFirst
    /\ CSend(M("USER", ""))
    /\ cli' = [cli EXCEPT !.user = TRUE]
    /\ UNCHANGED <<s2c, srv>>

\* MD:176: before registration the client targets itself as "*", even after
\* it sent NICK.  It may set its key before or after CAP END (D7).
CMeta ==
    /\ Live /\ Meta /\ cli.capls /\ ~cli.welcomed /\ cli.metaSent < cli.mv
    /\ CSend(M("METASET", "*"))                                      \* cli-meta
    /\ cli' = [cli EXCEPT !.metaSent = @ + 1]
    /\ UNCHANGED <<s2c, srv>>

\* D9: with metadata the client asks for batch, before or after its SET,
\* and only before CAP END; it may also never ask.
CReqBatch ==
    /\ Live /\ Meta /\ cli.capls /\ ~cli.reqB /\ ~cli.endSent
    /\ CSend(M("REQB", ""))
    /\ cli' = [cli EXCEPT !.reqB = TRUE]
    /\ UNCHANGED <<s2c, srv>>

\* CAP END once NICK and USER (and PASS, if held) are out (MI:99-111).
CEnd ==
    /\ Live /\ cli.capls /\ cli.ni >= 1 /\ cli.user /\ ~cli.endSent
    /\ cli.pass = "none" \/ cli.passSent
    /\ CSend(M("CAPEND", ""))
    /\ cli' = [cli EXCEPT !.endSent = TRUE, !.welcomed = TRUE]
    /\ UNCHANGED <<s2c, srv>>

\* MC:135, MI:115: every PING gets a PONG with the same token.
CPong ==
    /\ Live /\ cli.pings # <<>>
    /\ CSend(M("PONG", Head(cli.pings)))                             \* cli-pong
    /\ cli' = [cli EXCEPT !.pings = Tail(@)]
    /\ UNCHANGED <<s2c, srv>>

\* Reading one server line.  The client is registered only on 001, and
\* takes its nick from it (MI:129).
CRecv ==
    /\ Live /\ s2c # <<>>
    /\ s2c' = Tail(s2c)
    /\ Log("S", Head(s2c))
    /\ LET m == Head(s2c) IN
       cli' = CASE m.t = "PING" -> [cli EXCEPT !.pings = Append(@, m.a)]
                [] m.t = "433" -> [cli EXCEPT !.need = TRUE]
                [] m.t = "ERROR" -> [cli EXCEPT !.closed = TRUE]
                [] m.t = "CAPB" -> [cli EXCEPT !.batch = m.a]
                [] m.t = "761" /\ m.a = "*" -> [cli EXCEPT !.acked = TRUE]
                \* D9: a key acknowledged before 001 is held only if batch was
                \* negotiated; otherwise the server dropped it.
                [] m.t = "001" -> [cli EXCEPT !.welcomed = TRUE, !.nick = m.a,
                                              !.held = cli.acked /\ cli.batch]
                [] OTHER -> cli
    /\ UNCHANGED <<c2s, srv>>

Next ==
    \/ SWelcome \/ SRefuse \/ SBurst \/ SPing \/ STimeout \/ SRecv
    \/ CCapLs \/ CPass \/ CNick \/ CUser \/ CMeta \/ CReqBatch \/ CEnd \/ CPong \/ CRecv

Fair ==
    /\ WF_vars(SWelcome) /\ WF_vars(SRefuse) /\ WF_vars(SBurst) /\ WF_vars(SPing)
    /\ WF_vars(SRecv)
    /\ WF_vars(CCapLs) /\ WF_vars(CPass) /\ WF_vars(CNick) /\ WF_vars(CUser)
    /\ WF_vars(CMeta) /\ WF_vars(CReqBatch) /\ WF_vars(CEnd) /\ WF_vars(CPong) /\ WF_vars(CRecv)

Spec == Init /\ [][Next]_vars /\ Fair

(***************************************************************************)
(* Properties.  Positions in the client's wire.                           *)
(***************************************************************************)
At(i, d, t) == i \in DOMAIN hist /\ hist[i].d = d /\ hist[i].m.t = t
Pos(d, t) == {i \in DOMAIN hist : At(i, d, t)}
Seen(d, t) == Pos(d, t) # {}
First(d, t) == CHOOSE i \in Pos(d, t) : \A j \in Pos(d, t) : i <= j

TypeOK ==
    /\ srv.phase \in {"pre", "burst", "reg", "refused", "closed"}
    /\ srv.cookie \in {"none", "sent", "ok"} /\ srv.meta \in {0, 1}
    /\ cli.ni \in 0..Len(NickList) /\ cli.metaSent \in 0..1
    /\ srv.batch \in BOOLEAN /\ srv.pre \in BOOLEAN /\ cli.reqB \in BOOLEAN /\ cli.batch \in BOOLEAN
    /\ cli.acked \in BOOLEAN /\ cli.held \in BOOLEAN

\* MI:103 (MUST, client): no PASS after both a NICK and a USER.
RulePassBeforeLatter ==
    \A i \in Pos("C", "PASS") :
        ~((\E j \in 1..(i - 1) : At(j, "C", "NICK")) /\ (\E k \in 1..(i - 1) : At(k, "C", "USER")))

\* MC:135 (MUST, client): a PONG carries the token of a PING read earlier.
RulePongToken ==
    \A i \in Pos("C", "PONG") :
        \E j \in 1..(i - 1) : At(j, "S", "PING") /\ hist[j].m.a = hist[i].m.a

\* MD:176 (MUST, client): METADATA before 001 targets "*".
RuleMetaStar ==
    \A i \in Pos("C", "METASET") :
        (\A j \in 1..(i - 1) : ~At(j, "S", "001")) => hist[i].m.a = "*"

\* MI:117-126 (MUST, server): nothing of the burst before 001.
RuleBurstAfter001 ==
    \A t \in {"376", "BATCH+", "BATCH-", "KV"} :
        \A i \in Pos("S", t) : \E j \in 1..(i - 1) : At(j, "S", "001")

\* MD:113, MD:140 (MUST, server): with metadata negotiated, by 376 the
\* client has had a metadata batch for its own nick, opened and closed
\* between 001 and 376.
RuleMetaBatch ==
    (Meta /\ srv.batch /\ Seen("S", "376") /\ Seen("S", "001")) =>
        \E b \in Pos("S", "BATCH+"), e \in Pos("S", "BATCH-") :
            /\ First("S", "001") < b /\ b < e /\ e < First("S", "376")
            /\ hist[b].m.a = hist[First("S", "001")].m.a

\* MD:140 (server): a key acknowledged before 001 (761 "*") is in that batch.
RuleMetaCarries ==
    (Meta /\ srv.batch /\ Seen("S", "376") /\ Seen("S", "001")
     /\ \E i \in Pos("S", "761") : hist[i].m.a = "*" /\ i < First("S", "001"))
    => \E k \in Pos("S", "KV") : First("S", "001") < k /\ k < First("S", "376")

\* D9 (server, nefarious2): registration completed without batch holds
\* nothing set before it, and sends no metadata batch.
RuleDropWithoutBatch == (srv.phase \in {"burst", "reg"} /\ ~srv.batch) => ~srv.pre
RuleNoMetaBatchWithoutBatch == ~srv.batch => ~Seen("S", "BATCH+")

\* D9 (client): after 001 the client counts a key set before registration
\* as held only if the server still holds it.
RuleHeldIsKept == cli.held => (srv.pre /\ srv.meta = 1)

\* D9 (server): completing registration keeps the stored metadata with
\* batch and empties it without (before 001 only a pre-registration SET
\* can have set it).
RuleWelcomeStore ==
    [][(srv.phase = "pre" /\ srv'.phase = "burst")
       => srv'.meta = (IF srv.batch THEN srv.meta ELSE 0)]_vars

\* MC:53 (server): a NICK answered with 433 does not change the nick.
RuleNickIgnoredOn433 ==
    [][(\E i \in (Len(s2c) + 1)..Len(s2c') : s2c'[i].t = "433") => srv'.nick = srv.nick]_vars

\* MC:30-32 (server): no 001 without the right password where one is needed,
\* and a refusal says so with 464 or ERROR.
RulePassGate == srv.phase \in {"burst", "reg"} => PassOK
RulePassRefusalSaid ==
    [][(srv.phase = "pre" /\ srv'.phase \in {"refused", "closed"} /\ ~PassOK /\ Ready)
       => \E i \in (Len(s2c) + 1)..Len(s2c') : s2c'[i].t \in {"464", "ERROR"}]_vars

\* Cookie (D2, server convention, checked for the Cookie server): no 001
\* before the PONG.
RuleCookieGate == (Cookie /\ srv.phase \in {"burst", "reg"}) => srv.cookie = "ok"

\* MC:230 (server): ERROR ends the connection: nothing is sent after it.
RuleNothingAfterError ==
    [][srv.phase = "closed" => Len(s2c') <= Len(s2c)]_vars

\* MI:129 (client): registered only by 001, with 001's nick.
RuleWelcomedBy001 ==
    cli.welcomed => (Seen("S", "001") /\ cli.nick = hist[First("S", "001")].m.a)

\* Liveness: every PING read is answered; a client with a usable password
\* and a free nick ends registered unless the server may time it out.
PingsAnswered == cli.pings # <<>> ~> (cli.pings = <<>> \/ cli.closed)
Registers ==
    (~Timeout /\ FreeNick /\ (PassReq = "none" \/ cli.pass = "right"))
    => <>cli.welcomed

(***************************************************************************)
(* Witnesses: each should be VIOLATED (a counterexample shows the case).   *)
(***************************************************************************)
W_433Then001   == ~(Seen("S", "433") /\ Seen("S", "001"))
W_EndThen433   == ~(Seen("C", "CAPEND") /\ \E i \in Pos("S", "433") : First("C", "CAPEND") < i)
W_CookieThen001 == ~(Seen("S", "PING") /\ Seen("C", "PONG") /\ Seen("S", "001"))
W_MetaKV       == ~Seen("S", "KV")
W_EmptyBatch   == ~(\E b \in Pos("S", "BATCH+") : At(b + 1, "S", "BATCH-"))
W_MetaAfterEnd == ~(\E i \in Pos("C", "METASET") : Seen("C", "CAPEND") /\ First("C", "CAPEND") < i
                                                 /\ ~(\E j \in 1..(i - 1) : At(j, "S", "001")))
W_Timeout      == ~(Seen("S", "ERROR") /\ ~Seen("S", "001") /\ ~Seen("S", "464"))
W_PassRefused  == ~Seen("S", "464")
W_Refused464Only == ~(srv.phase = "refused")
W_MetaDropped  == ~(cli.acked /\ cli.welcomed /\ ~srv.pre)
W_MetaBeforeBatch == ~(cli.held /\ \E i \in Pos("S", "761"), j \in Pos("S", "CAPB") :
                                    i < j /\ hist[j].m.a = TRUE)
=============================================================================
