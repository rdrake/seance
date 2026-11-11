---------------------------- MODULE M5SrvNoDel ----------------------------
(***************************************************************************)
(* IRCv3 connection registration as the SPECIFICATIONS describe it: CAP   *)
(* 302 negotiation with cap-notify, and SASL 3.1/3.2, between one client  *)
(* and one server.  Written only from ircv3-specifications @ 9ff58d1 (see *)
(* ../RULES.md for the rule list and ../DECISIONS.md for interpretation   *)
(* choices).  No Seance or nefarious2 behaviour is modelled here.         *)
(*                                                                         *)
(* This is a BOUNDED REFERENCE PEER for the pre-registration, single      *)
(* mechanism (client-first, PLAIN-shaped) subset, not every behaviour the *)
(* specs permit (../SPEC-REVIEW*.md).                                     *)
(*                                                                         *)
(* Send boundary (D19): a server step that appends to sout has SENT that  *)
(* line in the specs' sense; the append is irrevocable and is where every *)
(* "after sending" effect happens.  SrvSend is transport delivery: it     *)
(* moves lines to the client in order, and may still flush while the      *)
(* connection is closing (after ERROR is sent); nothing is ever sent      *)
(* after ERROR.                                                           *)
(*                                                                         *)
(* v4 (after SPEC-REVIEW-3): every multi-line server output is written in *)
(* separate steps with other output allowed between: the two LS lines,    *)
(* the two parts of a split ACK (several splits may be open at once, and  *)
(* other REQs' replies and NEW/DEL may come between), 900 and 903, 906    *)
(* and 001.  A success owes a 900 and a 903 (counters independent of the *)
(* current exchange), sent in either order (v5); ERROR is sent only after *)
(* every owed line (v5).  ACK lines carry no completion marker; the model client      *)
(* keeps its outstanding REQs pairwise disjoint and attributes each ACK   *)
(* or NAK line by its contents (D17), so it is correct under reordered    *)
(* and interleaved replies.  A cap DELed while a split ACK is open is     *)
(* dropped from what that ACK enables, on both sides (D18).               *)
(*                                                                         *)
(* Checking direction (README.md):                                        *)
(*  - a CLIENT against the model server: use EnvSpec (server fairness     *)
(*    only) with ReorderReplies = TRUE (Reference.cfg).                   *)
(*  - a SERVER against the model client: the client is under-approximated *)
(*    (fixed opening, no repeated LS, no LIST, no "-cap" removals, no     *)
(*    blind REQ, no overlapping pipelined REQs), so a pass says less.     *)
(*                                                                         *)
(* Out of scope: SASL after 001 (S2 reauthentication by the client, NEW   *)
(* sasl after registration, 901; D2), CAP LIST, 410, versions other than  *)
(* 302, cap values and mechanism lists, "-cap" removals, blind REQ before *)
(* LS, chunking of AUTHENTICATE payloads, 902/905/908, non-SASL           *)
(* registration holds (they only delay SrvRegister).  LS is at most two   *)
(* lines, a split ACK at most two parts.                                  *)
(*                                                                         *)
(* Caps are abstract other caps (OtherCaps), "sasl", and "cap-notify",   *)
(* which CAP LS 302 enables implicitly and the server never removes      *)
(* (CN-23).                                                               *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    MaxReq,         \* REQs the client may send (exploration bound only)
    MaxSasl,        \* exchanges the client may open (S1-11 MAY retry)
    MaxEnv,         \* cap availability changes on the server (NEW/DEL)
    MultiLine,      \* server MAY split LS / ACK over two lines (CN-9, CN-14)
    ArbitraryNak,   \* server MAY NAK a REQ that is not already enabled (D8)
    Reauth,         \* S2-6 SHOULD allow reauth; FALSE = S1-13 907 (D3)
    AbortOnReg,     \* S1-14 SHOULD abort SASL with 906 on registration
    LsCapNotify,    \* server MAY list cap-notify in LS (CN-23b)
    ReqCapNotify,   \* client MAY REQ cap-notify explicitly (CN-23b)
    ReorderReplies, \* server may answer queued REQs in any order and
                    \* interleave their ACK parts (D9)
    OtherCaps       \* the caps other than sasl and cap-notify, e.g. {"a"};
                    \* two open splits need two of them ({"a", "b"})

CN == "cap-notify"
Caps == OtherCaps \cup {"sasl"}  \* caps whose availability can change
AllCaps == Caps \cup {CN}

Msg(t, S, more) == [t |-> t, caps |-> S, more |-> more]
M(t) == Msg(t, {}, FALSE)

RemoveAt(s, i) == SubSeq(s, 1, i - 1) \o SubSeq(s, i + 1, Len(s))
Splits(S) == (SUBSET S) \ {{}, S}
\* D22: an LS line may carry none of the modelled caps (the caps outside the
\* model fill it), so the first of two LS lines may hold any part of S.
LsSplits(S) == SUBSET S
\* An exchange is running: opened, challenged, or with the response read.
\* "open" (D23): the opener has been read and the challenge is not sent yet.
Active == {"open", "await", "decide"}

VARIABLES
    env,   \* [creds, wantSasl, required, svcOk]: fixed per behaviour
    c2s,   \* client -> server, one ordered stream
    s2c,   \* server -> client, lines delivered and not yet read
    sout,  \* server lines sent (D19) and not yet delivered
    srv,   \* server state for this one connection
    cli,   \* client state
    gh,    \* ghost flags for witnesses (not read by any action guard)
    gc     \* ghost: 900/903 lines sent, and W_Between (updated by G)

vars == <<env, c2s, s2c, sout, srv, cli, gh, gc>>

Init ==
    /\ env \in {e \in [creds : BOOLEAN, wantSasl : BOOLEAN,
                       required : BOOLEAN, svcOk : BOOLEAN] :
                   e.required => e.wantSasl}
    /\ c2s = <<M("CAPLS"), M("NICK"), M("USER")>>          \* CN-1, CN-2
    /\ s2c = <<>>
    /\ sout = <<>>
    /\ \E S \in SUBSET Caps :
         srv = [offered |-> S, enabled |-> {}, hold |-> FALSE,
                nick |-> FALSE, user |-> FALSE, reg |-> FALSE,
                owe001 |-> FALSE,
                sasl |-> "idle", owe900 |-> 0, owe903 |-> 0, succN |-> 0,
                peerQuit |-> FALSE,
                authed |-> FALSE, failed |-> FALSE,
                closed |-> FALSE, authUp |-> ("sasl" \in S), envN |-> 0,
                endSeen |-> FALSE, lsSeen |-> FALSE,
                lsOn |-> FALSE, lsRest |-> {},
                inbox |-> <<>>, acking |-> <<>>]
    /\ cli = [lsDone |-> FALSE, avail |-> {}, enabled |-> {},
              pend |-> <<>>, reqs |-> 0, sasl |-> "idle",
              att |-> 0, account |-> FALSE, endSent |-> FALSE,
              welcomed |-> FALSE, quit |-> FALSE, closed |-> FALSE,
              unable |-> FALSE]
    /\ gh = [nakSasl |-> FALSE, strayMech |-> FALSE, lateReply |-> FALSE,
             reHold |-> FALSE, failSeen |-> FALSE, failThenEnd |-> FALSE,
             splitCross |-> FALSE, delInSplit |-> FALSE,
             interleave |-> FALSE, twoSplits |-> FALSE, lsEnv |-> FALSE,
             welcome903 |-> FALSE, abortChal |-> FALSE]
    /\ gc = [between |-> FALSE, n900 |-> 0, n903 |-> 0]

-----------------------------------------------------------------------------
(* Server: handlers for one client line.  Each fixes srv', sout', gh'.    *)

HoldOnCap == srv.hold \/ ~srv.reg                         \* CN-3, CN-6, CN-13
\* 001 has been sent (registration may be decided while 001 is still owed).
Welcomed(s) == s.reg /\ ~s.owe001

\* LS: one line, or (MultiLine) a first line with the `*` marker now and the
\* final line in a later step, SrvLsRest (CN-9).
SrvLS ==
    /\ \E S \in IF LsCapNotify THEN {srv.offered, srv.offered \cup {CN}}
                               ELSE {srv.offered} :         \* CN-23b
         \/ /\ sout' = Append(sout, Msg("LS", S, FALSE))     \* CN-7
            /\ srv' = [srv EXCEPT !.hold = HoldOnCap, !.lsSeen = TRUE]
         \/ /\ MultiLine
            /\ \E A \in LsSplits(S) :
                 /\ sout' = Append(sout, Msg("LS", A, TRUE))
                 /\ srv' = [srv EXCEPT !.hold = HoldOnCap, !.lsSeen = TRUE,
                              !.lsOn = TRUE, !.lsRest = S \ A]
    /\ gh' = gh

\* A REQ waits in the inbox; registration is held from receipt (CN-13).
SrvReqIn(R) ==
    /\ sout' = sout
    /\ srv' = [srv EXCEPT !.inbox = Append(@, R), !.hold = HoldOnCap]
    /\ gh' = [gh EXCEPT !.reHold = @ \/ (srv.endSeen /\ ~srv.reg)]

SrvEnd ==
    /\ sout' = sout
    /\ srv' = [srv EXCEPT !.hold = IF srv.reg THEN @ ELSE FALSE,   \* CN-16
                           !.endSeen = TRUE]
    /\ gh' = gh

\* After a successful login an opener always gets an answer: 907 without
\* reauth (S1-13); with reauth, a new exchange, or an error when it cannot
\* be served (S2-6).  900/903 still owed for the earlier login stay owed.
SrvMech ==
    IF srv.authed
    THEN /\ gh' = gh
         /\ IF ~Reauth
            THEN sout' = Append(sout, M("907")) /\ srv' = srv            \* S1-13
            ELSE IF "sasl" \notin srv.enabled \/ ~env.svcOk
            THEN sout' = Append(sout, M("904")) /\ srv' = srv            \* S2-6
            ELSE /\ sout' = Append(sout, M("AUTH+"))
                 /\ srv' = [srv EXCEPT !.sasl = "await"]
    ELSE IF "sasl" \notin srv.enabled
    THEN /\ gh' = [gh EXCEPT !.strayMech = TRUE]          \* D7
         /\ \/ sout' = sout /\ srv' = srv
            \/ sout' = Append(sout, M("904")) /\ srv' = [srv EXCEPT !.failed = TRUE]
    ELSE /\ gh' = gh
         /\ IF ~env.svcOk
            THEN /\ sout' = Append(sout, M("904"))                    \* S1-5
                 /\ srv' = [srv EXCEPT !.failed = TRUE, !.sasl = "idle"]
            ELSE /\ sout' = sout                                    \* S1-6, D23
                 /\ srv' = [srv EXCEPT !.sasl = "open", !.failed = FALSE]

\* S1-13 covers every AUTHENTICATE line after a successful login, not only
\* an opener: without reauth, a response or `*` that finds no exchange is
\* also rejected with 907 (found by trace validation against Ergo, D21).
Late907 == srv.authed /\ ~Reauth /\ srv.sasl \notin Active

\* D24: SASL lines carry no exchange identifier, so a response that finds no
\* exchange may be read as an opener naming that "mechanism".
SrvData ==
    IF Late907
    THEN sout' = Append(sout, M("907")) /\ srv' = srv /\ gh' = gh
    ELSE IF srv.sasl = "await"
    THEN sout' = sout /\ srv' = [srv EXCEPT !.sasl = "decide"] /\ gh' = gh
    ELSE IF srv.sasl = "idle"
    THEN \/ sout' = sout /\ srv' = srv /\ gh' = gh
         \/ SrvMech
    ELSE sout' = sout /\ srv' = srv /\ gh' = gh

SrvAbort ==
    /\ IF Late907 THEN sout' = Append(sout, M("907")) /\ srv' = srv
       ELSE IF srv.sasl \in Active
       THEN /\ sout' = Append(sout, M("906"))             \* S1-10
            /\ srv' = [srv EXCEPT !.sasl = "idle"]
       ELSE /\ srv' = srv                                 \* D10
            /\ sout' \in {sout, Append(sout, M("906"))}
    /\ gh' = gh

SrvSet(f) == sout' = sout /\ srv' = [srv EXCEPT ![f] = TRUE] /\ gh' = gh

SRecv ==
    /\ c2s # <<>>
    /\ ~srv.closed
    /\ c2s' = Tail(c2s)
    /\ LET m == Head(c2s) IN
       CASE m.t = "CAPLS"    -> SrvLS
         [] m.t = "REQ"      -> SrvReqIn(m.caps)
         [] m.t = "END"      -> SrvEnd
         [] m.t = "NICK"     -> SrvSet("nick")
         [] m.t = "USER"     -> SrvSet("user")
         [] m.t = "AUTHMECH" -> SrvMech
         [] m.t = "AUTHDATA" -> SrvData
         [] m.t = "AUTHSTAR" -> SrvAbort
         [] m.t = "QUIT"     -> /\ sout' = sout /\ gh' = gh
                                 /\ srv' = [srv EXCEPT !.closed = TRUE, !.peerQuit = TRUE]
    /\ UNCHANGED <<env, s2c, cli>>

(* Server: internal steps. *)

\* Transport delivery of one sent line (D19), also while closing.
SrvSend ==
    /\ sout # <<>>
    /\ s2c' = Append(s2c, Head(sout))
    /\ sout' = Tail(sout)
    /\ UNCHANGED <<env, c2s, srv, cli, gh>>

\* The final LS line lists what is still offered of the remainder: a cap
\* DELed after the first line is left out unless a NEW brought it back
\* (CN-9; CN-7: the line may be empty).
SrvLsRest ==
    /\ ~srv.closed /\ srv.lsOn
    /\ sout' = Append(sout, Msg("LS", srv.lsRest \cap (srv.offered \cup {CN}), FALSE))
    /\ srv' = [srv EXCEPT !.lsOn = FALSE, !.lsRest = {}]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

\* Answer a queued REQ, as a whole (CN-11).  ACK only what is offered (plus
\* cap-notify); a REQ of already enabled caps or cap-notify MUST be ACKed
\* (CN-10, CN-23b); a REQ naming an unoffered cap MUST be NAKed (S2-2);
\* otherwise (ArbitraryNak) the server may NAK.  An ACK may be split: the
\* first part now, the rest later (SrvAckRest); the caps change only when
\* the last part is sent (CN-14).  In order (ReorderReplies = FALSE) means
\* the oldest REQ is answered next and a split ACK is finished before the
\* next answer; NEW/DEL may still come between its parts.
Ackable(R) == R \subseteq srv.offered \cup {CN}
MustAck(R) == R \subseteq srv.enabled \cup {CN}

SrvAnswer ==
    /\ ~srv.closed /\ srv.inbox # <<>>
    /\ ReorderReplies \/ srv.acking = <<>>
    /\ \E i \in IF ReorderReplies THEN 1..Len(srv.inbox) ELSE {1} :
         LET R == srv.inbox[i]
             rest == RemoveAt(srv.inbox, i)
             ghI == [gh EXCEPT !.interleave = @ \/ srv.acking # <<>>]
         IN
         \/ /\ Ackable(R)
            /\ sout' = Append(sout, Msg("ACK", R, FALSE))
            /\ srv' = [srv EXCEPT !.inbox = rest, !.enabled = @ \cup (R \ {CN})]
            /\ gh' = ghI
         \/ /\ Ackable(R) /\ MultiLine
            /\ \E A \in Splits(R) :
                 /\ sout' = Append(sout, Msg("ACK", A, FALSE))
                 /\ srv' = [srv EXCEPT !.inbox = rest,
                              !.acking = Append(@, [commit |-> R \ {CN},
                                                    rest |-> R \ A,
                                                    reg0 |-> Welcomed(srv)])]
            /\ gh' = [ghI EXCEPT !.twoSplits = @ \/ srv.acking # <<>>]
         \/ /\ ~Ackable(R) \/ (ArbitraryNak /\ ~MustAck(R))
            /\ sout' = Append(sout, Msg("NAK", R, FALSE))
            /\ srv' = [srv EXCEPT !.inbox = rest]          \* CN-15
            /\ gh' = [ghI EXCEPT !.nakSasl = @ \/ ("sasl" \in R /\ ~Ackable(R))]
    /\ UNCHANGED <<env, c2s, s2c, cli>>

\* The last part of a split ACK lists the rest of the requested set as
\* asked; it enables the set minus any cap DELed since the first part (D18).
SrvAckRest ==
    /\ ~srv.closed /\ srv.acking # <<>>
    /\ \E k \in IF ReorderReplies THEN 1..Len(srv.acking) ELSE {1} :
         LET p == srv.acking[k] IN
         /\ sout' = Append(sout, Msg("ACK", p.rest, FALSE))
         /\ srv' = [srv EXCEPT !.enabled = @ \cup p.commit,
                               !.acking = RemoveAt(@, k)]
         /\ gh' = [gh EXCEPT !.splitCross = @ \/ (Welcomed(srv) /\ ~p.reg0)]
    /\ UNCHANGED <<env, c2s, s2c, cli>>

\* D23: the challenge goes out in its own step, so an exchange can fail,
\* time out or be aborted between the opener and AUTHENTICATE +.
SrvChallenge ==
    /\ ~srv.closed /\ srv.sasl = "open"
    /\ sout' = Append(sout, M("AUTH+"))
    /\ srv' = [srv EXCEPT !.sasl = "await"]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

\* Services answer the client's response (S1-11, S1-12).  Success owes one
\* 900 and one 903 (counters, independent of later exchanges), sent by
\* Srv900 and Srv903 in either order, with other output allowed between
\* (S1:79 names both, orders neither).
SrvDecide ==
    /\ ~srv.closed /\ srv.sasl = "decide"
    /\ IF env.creds
       THEN /\ sout' = sout
            /\ srv' = [srv EXCEPT !.sasl = "idle", !.authed = TRUE,
                                  !.owe900 = @ + 1, !.owe903 = @ + 1,
                                  !.succN = @ + 1]
       ELSE /\ sout' = Append(sout, M("904"))
            /\ srv' = [srv EXCEPT !.sasl = "idle", !.failed = TRUE]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

Srv900 ==
    /\ ~srv.closed /\ srv.owe900 > 0
    /\ sout' = Append(sout, M("900"))
    /\ srv' = [srv EXCEPT !.owe900 = @ - 1]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

Srv903 ==
    /\ ~srv.closed /\ srv.owe903 > 0
    /\ sout' = Append(sout, M("903"))
    /\ srv' = [srv EXCEPT !.owe903 = @ - 1]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

\* The server gives up on an exchange at any time (D11).
SrvSaslTimeout ==
    /\ ~srv.closed /\ srv.sasl \in Active
    /\ sout' = Append(sout, M("904"))
    /\ srv' = [srv EXCEPT !.sasl = "idle", !.failed = TRUE]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

\* Registration (CN-3).  An owed 900/903 does not delay it (D20).  With an
\* exchange running the server aborts it (S1-14: 906 now, 001 in a later
\* step, Srv001) or, without AbortOnReg, may also leave it running.
SrvRegister ==
    /\ ~srv.closed /\ ~srv.reg
    /\ srv.nick /\ srv.user /\ ~srv.hold
    /\ \/ /\ srv.sasl = "idle"
          /\ sout' = Append(sout, M("001"))
          /\ srv' = [srv EXCEPT !.reg = TRUE]
       \/ /\ srv.sasl \in Active                         \* S1-14
          /\ sout' = Append(sout, M("906"))
          /\ srv' = [srv EXCEPT !.reg = TRUE, !.owe001 = TRUE, !.sasl = "idle"]
       \/ /\ srv.sasl \in Active /\ ~AbortOnReg
          /\ sout' = Append(sout, M("001"))
          /\ srv' = [srv EXCEPT !.reg = TRUE]
    /\ gh' = [gh EXCEPT !.welcome903 = @ \/ (srv.owe900 + srv.owe903 > 0 /\ srv.sasl = "idle")]
    /\ UNCHANGED <<env, c2s, s2c, cli>>

Srv001 ==
    /\ ~srv.closed /\ srv.owe001
    /\ sout' = Append(sout, M("001"))
    /\ srv' = [srv EXCEPT !.owe001 = FALSE]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

\* S2-7: MAY disconnect after failed auth, reason (904) already sent.  Every
\* owed line is sent first (900/903 of an earlier success, 001, the LS rest,
\* the last part of a split ACK); queued REQs may go unanswered.
SrvFailClose ==
    /\ ~srv.closed /\ srv.failed
    /\ srv.owe900 = 0 /\ srv.owe903 = 0 /\ ~srv.owe001 /\ ~srv.lsOn
    /\ srv.acking = <<>>
    /\ sout' = Append(sout, M("ERROR"))
    /\ srv' = [srv EXCEPT !.closed = TRUE]
    /\ UNCHANGED <<env, c2s, s2c, cli, gh>>

\* A cap comes or goes at any time after CAP LS 302 was handled; cap-notify
\* tells the client (CN-17, CN-23, CN-24, S2-5).  Losing sasl cancels an
\* exchange (CN-21, D5); a DELed cap is dropped from open split ACKs (D18).
EnvChange ==
    /\ ~srv.closed /\ srv.lsSeen /\ srv.envN < MaxEnv
    /\ \E c \in Caps :
         IF c \in srv.offered
         THEN /\ sout' = Append(sout, Msg("DEL", {c}, FALSE))
              /\ srv' = [srv EXCEPT !.offered = @ \ {c}, !.enabled = @ \ {c},
                           !.envN = @ + 1,
                           !.authUp = IF c = "sasl" THEN FALSE ELSE @,
                           !.sasl = IF c = "sasl" /\ @ \in Active
                                    THEN "idle" ELSE @,
                           !.acking = [k \in DOMAIN @ |->
                                         @[k]]]
              /\ gh' = [gh EXCEPT !.lsEnv = @ \/ srv.lsOn,
                           !.delInSplit = @ \/ \E k \in DOMAIN srv.acking :
                                                  c \in srv.acking[k].commit]
         ELSE /\ sout' = Append(sout, Msg("NEW", {c}, FALSE))
              /\ srv' = [srv EXCEPT !.offered = @ \cup {c}, !.envN = @ + 1,
                           !.authUp = IF c = "sasl" THEN TRUE ELSE @]
              /\ gh' = [gh EXCEPT !.lsEnv = @ \/ srv.lsOn]
    /\ UNCHANGED <<env, c2s, s2c, cli>>


-----------------------------------------------------------------------------
(* Client. *)

InExchange == cli.sasl \in {"mech", "data", "abort"}

\* D4, event-based and sticky (see DECISIONS.md).
Unable(c) == cli.unable \/ (env.wantSasl /\ ~cli.account /\ c)

\* D17: outstanding REQs are pairwise disjoint (CReq), so every ACK line
\* belongs to the one outstanding REQ that contains its caps, and a NAK to
\* the one that equals its caps, whatever order the replies come in.  Each
\* outstanding REQ keeps the ACKed caps so far (buf) and the caps DELed
\* after its first ACK part arrived (del, D18).
Owner(S) == {k \in DOMAIN cli.pend : S \subseteq cli.pend[k].R}

CHandle(m) ==
    CASE m.t = "LS" ->                                    \* CN-9
           /\ c2s' = c2s
           /\ cli' = IF m.more THEN [cli EXCEPT !.avail = @ \cup m.caps]
                     ELSE [cli EXCEPT !.avail = @ \cup m.caps, !.lsDone = TRUE,
                                      !.unable = Unable("sasl" \notin cli.avail \cup m.caps)]
      [] m.t = "ACK" ->                                   \* CN-14, D17
           /\ c2s' = c2s
           /\ cli' = IF Owner(m.caps) = {} THEN cli
                     ELSE LET k == CHOOSE j \in Owner(m.caps) : TRUE
                              p == cli.pend[k]
                              B == p.buf \cup m.caps
                          IN IF B = p.R
                             THEN [cli EXCEPT !.enabled = @ \cup (p.R \ p.del),
                                              !.pend = RemoveAt(@, k)]
                             ELSE [cli EXCEPT !.pend[k].buf = B]
      [] m.t = "NAK" ->                                   \* CN-15, D17
           /\ c2s' = c2s
           /\ LET K == {k \in DOMAIN cli.pend : cli.pend[k].R = m.caps} IN
              cli' = IF K = {} THEN cli
                     ELSE [cli EXCEPT !.pend = RemoveAt(@, CHOOSE k \in K : TRUE),
                                      !.unable = Unable(m.caps = {"sasl"})]
      [] m.t = "NEW" ->
           /\ c2s' = c2s
           /\ cli' = [cli EXCEPT !.avail = @ \cup m.caps]
      [] m.t = "DEL" ->                                   \* CN-19, D5, D18
           /\ c2s' = c2s
           /\ cli' = [cli EXCEPT !.avail = @ \ m.caps, !.enabled = @ \ m.caps,
                        !.pend = [k \in DOMAIN @ |->
                                    IF @[k].buf # {}
                                    THEN [@[k] EXCEPT !.del = @ \cup (m.caps \cap cli.pend[k].R)]
                                    ELSE @[k]],
                        !.sasl = IF "sasl" \in m.caps /\ InExchange
                                 THEN "idle" ELSE @,
                        !.unable = Unable("sasl" \in m.caps /\ "sasl" \notin cli.enabled)]
      [] m.t = "AUTH+" ->
           \* S1-4 (D27): the client may answer the challenge with its data
           \* or abort the exchange with "*" (e.g. it will not send PLAIN
           \* over an unencrypted connection).
           IF cli.sasl = "mech"
           THEN \/ /\ c2s' = Append(c2s, M("AUTHDATA"))
                   /\ cli' = [cli EXCEPT !.sasl = "data"]
                \/ /\ c2s' = Append(c2s, M("AUTHSTAR"))
                   /\ cli' = [cli EXCEPT !.sasl = "abort"]
           ELSE c2s' = c2s /\ cli' = cli
      [] m.t = "900" -> c2s' = c2s /\ cli' = [cli EXCEPT !.account = TRUE]
      [] m.t = "903" -> c2s' = c2s
                        /\ cli' = IF InExchange THEN [cli EXCEPT !.sasl = "ok"] ELSE cli
      [] m.t = "907" -> c2s' = c2s
                        /\ cli' = IF InExchange THEN [cli EXCEPT !.sasl = "ok"] ELSE cli
      [] m.t \in {"904", "906"} ->                        \* S1-11, S1-10, D12
           /\ c2s' = c2s
           /\ cli' = IF InExchange THEN [cli EXCEPT !.sasl = "idle"] ELSE cli
      [] m.t = "001" -> c2s' = c2s /\ cli' = [cli EXCEPT !.welcomed = TRUE]
      [] m.t = "ERROR" -> c2s' = c2s /\ cli' = [cli EXCEPT !.closed = TRUE]

CRecv ==
    /\ s2c # <<>> /\ ~cli.quit /\ ~cli.closed
    /\ s2c' = Tail(s2c)
    /\ LET m == Head(s2c) IN
         /\ CHandle(m)
         /\ gh' = [gh EXCEPT
                     !.lateReply = @ \/ (m.t \in {"903", "904", "906", "907"} /\ ~InExchange),
                     !.failSeen = @ \/ (m.t = "904" /\ InExchange),
                     !.abortChal = @ \/ (m.t = "AUTH+" /\ cli.sasl = "mech" /\ cli'.sasl = "abort")]
    /\ UNCHANGED <<env, sout, srv>>

CLive == ~cli.quit /\ ~cli.closed

\* Any advertised cap, plus cap-notify even when unadvertised (CN-23b),
\* disjoint from every outstanding REQ (D17).
CReq ==
    /\ CLive /\ cli.lsDone /\ cli.reqs < MaxReq
    /\ \E R \in (SUBSET (cli.avail \cup (IF ReqCapNotify THEN {CN} ELSE {}))) \ {{}} :
         /\ \A k \in DOMAIN cli.pend : R \cap cli.pend[k].R = {}
         /\ c2s' = Append(c2s, Msg("REQ", R, FALSE))
         /\ cli' = [cli EXCEPT !.reqs = @ + 1,
                      !.pend = Append(@, [R |-> R, buf |-> {}, del |-> {}]),
                      \* CN-13: a REQ before 001 suspends registration
                      \* again, so another END is owed (D13).
                      !.endSent = IF cli.welcomed THEN @ ELSE FALSE]
    /\ UNCHANGED <<env, s2c, sout, srv, gh>>

CMech ==
    /\ CLive /\ env.wantSasl
    /\ "sasl" \in cli.enabled                             \* S1-1 (D1)
    /\ ~cli.welcomed                                      \* S1-2 (D2: scope)
    /\ cli.sasl = "idle" /\ ~cli.account /\ cli.att < MaxSasl
    /\ c2s' = Append(c2s, M("AUTHMECH"))
    /\ cli' = [cli EXCEPT !.sasl = "mech", !.att = @ + 1]
    /\ UNCHANGED <<env, s2c, sout, srv, gh>>

\* S1-4: abort (timeout or choice) at any time during an exchange.
CAbort ==
    /\ CLive /\ cli.sasl \in {"mech", "data"}
    /\ c2s' = Append(c2s, M("AUTHSTAR"))
    /\ cli' = [cli EXCEPT !.sasl = "abort"]
    /\ UNCHANGED <<env, s2c, sout, srv, gh>>

\* S1-4: stop waiting for the 906.
CGiveUp ==
    /\ CLive /\ cli.sasl = "abort"
    /\ cli' = [cli EXCEPT !.sasl = "idle"]
    /\ UNCHANGED <<env, c2s, s2c, sout, srv, gh>>

\* S1-3 (D16): END is recommended when SASL is complete or needs aborting;
\* an END sent mid-exchange is the client choosing to abort it (S1-14), so
\* the recommendation does not restrict when END may be sent.
CEnd ==
    \* D25: a client that does not want SASL may end before LS is complete
    \* (a pipelined CAP LS 302 / CAP END); one that wants it reads LS first.
    /\ CLive /\ (cli.lsDone \/ ~env.wantSasl) /\ ~cli.endSent
    /\ ~(env.required /\ cli.unable)                      \* S2-3
    /\ c2s' = Append(c2s, M("END"))
    /\ cli' = [cli EXCEPT !.endSent = TRUE]
    /\ gh' = [gh EXCEPT !.failThenEnd = @ \/ gh.failSeen]
    /\ UNCHANGED <<env, s2c, sout, srv>>

CQuit ==
    /\ CLive
    /\ c2s' = Append(c2s, M("QUIT"))
    /\ cli' = [cli EXCEPT !.quit = TRUE]
    /\ UNCHANGED <<env, s2c, sout, srv, gh>>

CQuitOblig == env.required /\ cli.unable /\ CQuit         \* S2-3

-----------------------------------------------------------------------------

NewOut == IF Len(sout') > Len(sout) THEN SubSeq(sout', Len(sout) + 1, Len(sout')) ELSE <<>>
NewC2S == IF Len(c2s') > Len(c2s) THEN SubSeq(c2s', Len(c2s) + 1, Len(c2s')) ELSE <<>>
Has(seq, t) == \E i \in 1..Len(seq) : seq[i].t = t
CapsIn(seq, t) == UNION {seq[i].caps : i \in {j \in 1..Len(seq) : seq[j].t = t}}
Consumed(t) == c2s # <<>> /\ c2s' = Tail(c2s) /\ Head(c2s).t = t

\* Every step also updates gc: the number of 900 and 903 lines sent, and
\* W_Between's flag, a line other than 900/903 sent while one of a
\* success's pair has been sent and the other is still owed (before and
\* after the step).
Count(t) == Cardinality({i \in 1..Len(NewOut) : NewOut[i].t = t})
Half(s) == s.owe900 # s.owe903
G(A) == A /\ gc' = [between |-> gc.between \/
                        (Half(srv) /\ Half(srv')
                         /\ \E i \in 1..Len(NewOut) : NewOut[i].t \notin {"900", "903"}),
                    n900 |-> gc.n900 + Count("900"),
                    n903 |-> gc.n903 + Count("903")]

Next ==
    \/ G(SRecv) \/ G(SrvSend) \/ G(SrvLsRest) \/ G(SrvAnswer) \/ G(SrvAckRest)
    \/ G(SrvChallenge) \/ G(SrvDecide) \/ G(Srv900) \/ G(Srv903) \/ G(SrvSaslTimeout) \/ G(SrvRegister)
    \/ G(Srv001) \/ G(SrvFailClose) \/ G(EnvChange)
    \/ G(CRecv) \/ G(CReq) \/ G(CMech) \/ G(CAbort) \/ G(CGiveUp) \/ G(CEnd)
    \/ G(CQuit)

\* Fairness is split.  SrvFair is an assumption about the server and the
\* network: lines get read and delivered, REQs answered, owed lines sent,
\* services answer, other registration holds clear.  CliFair is an
\* assumption about the client: it reads, times out, ends negotiation, and
\* (the one spec obligation, S2-3) disconnects when it must.  When the
\* model is the environment for checking a client, use EnvSpec: the
\* client's own progress must come from the client, not be assumed.
SrvFair ==
    /\ WF_vars(G(SRecv)) /\ WF_vars(G(SrvSend)) /\ WF_vars(G(SrvLsRest))
    /\ WF_vars(G(SrvAnswer)) /\ WF_vars(G(SrvAckRest)) /\ WF_vars(G(SrvDecide))
    /\ WF_vars(G(SrvChallenge))
    /\ WF_vars(G(Srv900)) /\ WF_vars(G(Srv903)) /\ WF_vars(G(SrvRegister))
    /\ WF_vars(G(Srv001))
CliFair ==
    /\ WF_vars(G(CRecv)) /\ WF_vars(G(CAbort)) /\ WF_vars(G(CGiveUp))
    /\ WF_vars(G(CEnd)) /\ WF_vars(G(CQuitOblig))

Spec == Init /\ [][Next]_vars /\ SrvFair /\ CliFair
EnvSpec == Init /\ [][Next]_vars /\ SrvFair

-----------------------------------------------------------------------------
(* Rule properties.  Server rules look at the lines a step sends (appends *)
(* to sout, D19); client rules at the lines it writes to c2s.  Most mirror *)
(* a guard; they are there as monitors for code models mapped onto these *)
(* variables.                                                              *)

TypeOK ==
    /\ srv.sasl \in {"idle"} \cup Active
    /\ srv.owe900 \in 0..MaxSasl /\ srv.owe903 \in 0..MaxSasl
    /\ srv.succN \in 0..MaxSasl
    /\ cli.sasl \in {"idle", "mech", "data", "abort", "ok"}
    /\ srv.offered \subseteq Caps /\ srv.enabled \subseteq srv.offered
    /\ \A k \in DOMAIN srv.acking : srv.acking[k].commit \subseteq srv.offered
    /\ cli.enabled \subseteq AllCaps /\ cli.avail \subseteq AllCaps
    /\ cli.reqs \in 0..MaxReq /\ cli.att \in 0..MaxSasl
    /\ srv.authUp = ("sasl" \in srv.offered)                \* S2-1, S2-5

RuleNoWelcomeInHold == [][Has(NewOut, "001") => ~srv.hold]_vars           \* CN-3
RuleNakNoChange == [][Has(NewOut, "NAK") => srv'.enabled = srv.enabled]_vars  \* CN-15
\* CN-14: caps change only when the last ACK part is sent.
RuleAckCommitsLast ==
    [][(srv'.enabled \ srv.enabled # {}) =>
         (Has(NewOut, "ACK") /\ Len(srv'.acking) <= Len(srv.acking))]_vars
\* CN-11: a REQ leaves the inbox only by being answered as a whole in that
\* step: one NAK of exactly its caps, or one ACK of its caps (or of a part,
\* opening a split ACK); and a split ACK closes only by sending its last
\* part.  With AnswersEventually, every REQ gets exactly one answer.
RuleAckWhole ==
    [][/\ Len(srv'.inbox) < Len(srv.inbox) =>
            /\ Len(NewOut) = 1
            /\ \E i \in 1..Len(srv.inbox) :
                 /\ srv'.inbox = RemoveAt(srv.inbox, i)
                 /\ \/ NewOut[1].t = "NAK" /\ NewOut[1].caps = srv.inbox[i]
                    \/ NewOut[1].t = "ACK" /\ NewOut[1].caps = srv.inbox[i]
                       /\ srv'.acking = srv.acking
                    \/ /\ NewOut[1].t = "ACK" /\ NewOut[1].caps # {}
                       /\ NewOut[1].caps \subseteq srv.inbox[i]
                       /\ NewOut[1].caps # srv.inbox[i]
                       /\ srv'.acking = Append(srv.acking,
                              [commit |-> srv.inbox[i] \ {CN},
                               rest |-> srv.inbox[i] \ NewOut[1].caps,
                               reg0 |-> Welcomed(srv)])
       /\ Len(srv'.acking) < Len(srv.acking) =>
            /\ Len(NewOut) = 1 /\ NewOut[1].t = "ACK"
            /\ \E k \in 1..Len(srv.acking) :
                 /\ srv'.acking = RemoveAt(srv.acking, k)
                 /\ NewOut[1].caps = srv.acking[k].rest]_vars
\* CN-10, CN-23b: a REQ of already enabled caps (or cap-notify) is never NAKed.
RuleRedundantAck ==
    [][Has(NewOut, "NAK") => ~(CapsIn(NewOut, "NAK") \subseteq srv.enabled \cup {CN})]_vars
RuleSaslAdvertOnlyIfUp ==                                                   \* S2-1
    [][("sasl" \in CapsIn(NewOut, "LS") \cup CapsIn(NewOut, "NEW")) => srv'.authUp]_vars
\* S2-2: a REQ with sasl answered while the auth layer is down is NAKed.
\* (The last part of a split ACK may still name a cap DELed since the
\* first part; D18.  This rule is about answers, not completions.)
RuleSaslNakIfDown ==
    [][(Len(srv'.inbox) < Len(srv.inbox) /\ ~srv.authUp
        /\ \E i \in 1..Len(srv.inbox) :
             srv'.inbox = RemoveAt(srv.inbox, i) /\ "sasl" \in srv.inbox[i])
       => Has(NewOut, "NAK")]_vars
\* S2-2: no ANSWER (a whole ACK or a split's first part) names sasl while
\* the auth layer is down.  Not every ACK line: a split's last part may
\* name a cap DELed since its first part (D18).
RuleNoSaslAckIfDown ==
    [][(Len(srv'.inbox) < Len(srv.inbox) /\ "sasl" \in CapsIn(NewOut, "ACK"))
       => srv.authUp]_vars
\* S1-13: any AUTHENTICATE line after a successful login gets 907 (without
\* reauth; D21).
Rule907 ==
    [][((Consumed("AUTHMECH") \/ Consumed("AUTHDATA") \/ Consumed("AUTHSTAR"))
        /\ srv.authed /\ ~Reauth) => Has(NewOut, "907")]_vars
\* S2-6: with reauth, an opener after login is never silently dropped.
RuleAuthedOpenerAnswered ==
    [][(Consumed("AUTHMECH") /\ srv.authed) => NewOut # <<>>]_vars
\* S1:79: every success sends exactly one 900 and one 903; nothing else
\* does (an invariant: lines sent plus lines owed = successes).
SuccAccounting ==
    /\ gc.n900 + srv.owe900 = srv.succN
    /\ gc.n903 + srv.owe903 = srv.succN
RuleClientAuthOnlyEnabled ==                                                \* S1-1, S1-2
    [][Has(NewC2S, "AUTHMECH") => ("sasl" \in cli.enabled /\ ~cli.welcomed)]_vars
RuleClientRequiredNoEnd ==                                                  \* S2-3
    [][Has(NewC2S, "END") => ~(env.required /\ cli.unable)]_vars
RuleFailCloseReason == [][Has(NewOut, "ERROR") => srv.failed]_vars          \* S2-7

\* S2-3: once a required client cannot get sasl, it disconnects.
RequiredQuits == [](env.required /\ cli.unable => <>(cli.quit \/ cli.closed \/ srv.closed))
\* Every queued REQ and every open split ACK is finished (with RuleAckWhole:
\* every REQ gets exactly one whole answer).
AnswersEventually ==
    [](srv.inbox # <<>> \/ srv.acking # <<>> =>
        <>((srv.inbox = <<>> /\ srv.acking = <<>>) \/ srv.closed))
\* Owed lines are sent: 900 and 903 after a success, the 001 after 906, the
\* LS rest.  Only the client's QUIT excuses them (the server's own ERROR
\* comes after them).
Owed == srv.owe900 > 0 \/ srv.owe903 > 0 \/ srv.owe001 \/ srv.lsOn
OwedSent == [](Owed => <>(~Owed \/ srv.peerQuit))

\* VIEW for SAFETY runs only (never with liveness or W_* witnesses): drops
\* gh and gc.between, which no invariant or Rule* property reads.  Keeps
\* gc.n900/n903 (SuccAccounting) and all of srv, including the reg0 field
\* of open splits, which RuleAckWhole compares (SPEC-REVIEW-6 #2).
SafetyView == <<env, c2s, s2c, sout, srv, cli, gc.n900, gc.n903>>

(* Design properties, conditional on the fairness assumptions above. *)

Quiet == /\ c2s = <<>> /\ s2c = <<>> /\ sout = <<>> /\ srv.inbox = <<>>
         /\ srv.acking = <<>> /\ ~Owed
         /\ CLive /\ ~srv.closed /\ cli.welcomed

\* CN-22: once quiet, both ends agree on what is enabled and on the login.
CapsAgree == Quiet => cli.enabled \ {CN} = srv.enabled
AccountAgrees == Quiet => cli.account = srv.authed

\* Under Spec's fairness, every connection ends in 001 or a disconnect.
\* Not a theorem of the specs, and not a guarantee under EnvSpec.
Terminates == <>(cli.welcomed \/ cli.quit \/ cli.closed \/ srv.closed)

(* Witnesses: invariants EXPECTED TO FAIL, each showing a behaviour the   *)
(* model permits.  Check each alone with "INVARIANT W_x".                  *)
W_LoggedIn       == ~(cli.welcomed /\ cli.account)              \* success reachable
\* D4 gap: failed login, THEN END, then 001 unauthenticated, required SASL.
W_RequiredUnauth == ~(env.required /\ cli.welcomed /\ ~cli.account /\ gh.failThenEnd)
W_NakSasl        == ~gh.nakSasl         \* sasl REQ NAKed because it is not offered
W_StrayMech      == ~gh.strayMech       \* conforming opener lands without the cap
W_LateReply      == ~gh.lateReply       \* a terminal numeric arrives outside any exchange
W_ReHold         == ~gh.reHold          \* D13: REQ after END re-suspends registration
W_SplitCross     == ~gh.splitCross      \* 001 sent between the parts of a split ACK
W_Between        == ~gc.between         \* other output between a success's 900 and 903
W_DelInSplit     == ~gh.delInSplit      \* D18: DEL of a cap in an open split ACK
W_Interleave     == ~gh.interleave      \* another REQ answered inside a split ACK
W_TwoSplits      == ~gh.twoSplits       \* two split ACKs open at once (OtherCaps = {"a", "b"})
W_LsEnv          == ~gh.lsEnv           \* NEW/DEL between the two LS lines
W_Welcome903     == ~gh.welcome903      \* D20: 001 sent while a 900 or 903 is owed
W_903First       == ~(gc.n903 > gc.n900)  \* a success's 903 sent before its 900
W_LsAllFirst     == ~(srv.lsOn /\ srv.lsRest = {})   \* D22: the last LS line holds no modelled cap
W_FailBeforeChal == ~(env.svcOk /\ "sasl" \in srv.enabled /\ cli.sasl = "mech"
                      /\ s2c # <<>> /\ Head(s2c).t \in {"904", "906"})  \* D23
W_StrayOpen      == ~(srv.sasl = "open" /\ cli.sasl = "data")  \* D24: a late response opens an exchange
W_AbortChal      == ~gh.abortChal       \* D27: "*" in answer to the challenge
W_EarlyEnd       == ~(cli.endSent /\ ~cli.lsDone)              \* D25: END before LS is complete
=============================================================================
