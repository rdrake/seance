------------------------------- MODULE M_BurstStale -------------------------------
(* Account state of IRCv3 clients across a split and a P10 burst, with one   *)
(* bouncer session.  Readings: ../DECISIONS.md (D1-D9); scope: ../DESIGN.md. *)
(* Server: nefarious2 ircv3.2-upgrade e81d12aa.                              *)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
  InitPrim,       \* "dA" or "dB": the session's face at start (D6)
  POrigin,        \* where P's account changes: "home", "services" (at B) or "both" (D3)
  SessSwitch,     \* the face may re-authenticate to another account name (D4)
  AliasFirst,     \* BX U before AC on the wire (D5); the code: TRUE
  AliasReauth,    \* an alias device may re-authenticate (D5); the code: TRUE
  SessLogout,     \* a face may be deauthed during a split (D4)
  Joins,          \* P may part and join (D2)
  LossAtSplit,    \* a split may cut lines in flight (D7); TCP: TRUE
  PromoteNotify,  \* the promote announces a changed account (D7); the code: FALSE
  BxcName,        \* "session" (the code) or "device": what a merge's BX C carries (D8)
  ReauthInBurst,  \* a device may change account while a burst N or merge BX C is unread (D8); the code: TRUE
  Lookup,         \* "byName" (the code): a session is found by its client's current account
                  \* name; "byRecord": by the client, whatever its name (D5, D8)
  ClassicTie,     \* the classic outcome: "any" (one, the other or both), "winner" (exactly
                  \* one), "code" (the session's two devices tie on nick TS, D8)
  MaxChanges, MaxMsgs, MaxSplits

Servers == {"A", "B"}
Other(v) == IF v = "A" THEN "B" ELSE "A"
Devs == {"dA", "dB"}
Clients == {"P"} \cup Devs
Home(c) == IF c = "dB" THEN "B" ELSE "A"
Dev(v) == IF v = "A" THEN "dA" ELSE "dB"
Peer(d) == IF d = "dA" THEN "dB" ELSE "dA"
Obs == {"oA", "oB"}
Srv(o) == IF o = "oA" THEN "A" ELSE "B"
ObsAt(v) == IF v = "A" THEN "oA" ELSE "oB"
Nicks == {"P", "S"}
Nick(c) == IF c = "P" THEN "P" ELSE "S"
Accts == {"X", "Y"}
SessName == "X"          \* the name the session was created under (D4)
NONE == "*"              \* logged out
NOREP == "-"             \* no copy of the client on this server
GONE == "gone"           \* not visible to the observer
NOFACE == "none"

VARIABLES
  acc,       \* acc[v][c]: server v's account for c; acc[Home(c)][c] is the truth
  alive,     \* alive[c]
  inSess,    \* inSess[c]: device c is in the session
  face,      \* face[v]: the client v shows as nick S
  chan,      \* chan[v]: v holds P as a member of the channel
  view,      \* view[o][n]: observer o's view of nick n
  q,         \* q[v]: P10 lines in flight from v to Other(v)
  link,      \* "up" | "split"
  nChg, nMsg, nSplit,
  win,       \* the heal's verdict inputs, read alike by both servers (D8)
  bad,       \* properties a delivery broke
  seen,      \* cover events
  preSplit,  \* P's account at the last split (used by a mutant only)
  verd       \* verd[v]: the same-nick verdict v took at the last heal

vars == <<acc, alive, inSess, face, chan, view, q, link, nChg, nMsg, nSplit,
          win, bad, seen, preSplit, verd>>

L(t, c, a, s, ch) == [t |-> t, c |-> c, a |-> a, s |-> s, ch |-> ch]
Up == link = "up"
Quiescent == Up /\ q["A"] = <<>> /\ q["B"] = <<>>
BurstUnread == \E v \in Servers : \E i \in 1..Len(q[v]) : q[v][i].t \in {"N", "BXC"} /\ q[v][i].c \in Devs
MayChangeFace == ReauthInBurst \/ ~BurstUnread

\* What server v shows for nick n (D1)
Belief(v, n) ==
  IF n = "P" THEN (IF acc[v]["P"] # NOREP /\ chan[v] THEN acc[v]["P"] ELSE GONE)
  ELSE (IF face[v] = NOFACE THEN GONE ELSE acc[v][face[v]])

\* The source a server delivers c's message as: P, or its face (ircd_relay.c:648-651)
Src(v, c) == IF c = "P" THEN "P" ELSE face[v]
CanSee(v, c) == Belief(v, Nick(c)) # GONE

\* The tag is the delivering server's copy of the source (send.c:604-608)
TagAt(v, c) == acc[v][Src(v, c)]
DeliverBad(v, c, sent) ==
  LET tag == TagAt(v, c)
      vw == view[ObsAt(v)][Nick(c)]
  IN  (IF tag # vw THEN {"TagView"} ELSE {})
      \cup (IF tag # sent THEN {"TagSend"} ELSE {})
      \cup (IF tag # sent /\ c = "P" THEN {"TagSendPlain"} ELSE {})

Enq(v, ls) == q' = IF Up THEN [q EXCEPT ![v] = @ \o ls] ELSE q

TypeOK ==
  /\ acc \in [Servers -> [Clients -> Accts \cup {NONE, NOREP}]]
  /\ alive \in [Clients -> BOOLEAN] /\ inSess \in [Clients -> BOOLEAN]
  /\ face \in [Servers -> Devs \cup {NOFACE}]
  /\ chan \in [Servers -> BOOLEAN]
  /\ view \in [Obs -> [Nicks -> Accts \cup {NONE, GONE}]]
  /\ link \in {"up", "split"}

Init ==
  /\ acc = [v \in Servers |-> [c \in Clients |-> "X"]]
  /\ alive = [c \in Clients |-> TRUE]
  /\ inSess = [c \in Clients |-> c \in Devs]
  /\ face = [v \in Servers |-> InitPrim]
  /\ chan = [v \in Servers |-> TRUE]
  /\ view = [o \in Obs |-> [n \in Nicks |-> "X"]]
  /\ q = [v \in Servers |-> <<>>]
  /\ link = "up"
  /\ nChg = 0 /\ nMsg = 0 /\ nSplit = 0
  /\ win = [merge |-> "A", classic |-> "A"]
  /\ bad = {} /\ seen = {}
  /\ preSplit = "X"
  /\ verd = [v \in Servers |-> "none"]

-----------------------------------------------------------------------------
(* Account changes                                                         *)

\* P's account changes at its own server (SASL, webhook), at B (services)
\* while B has a copy, or at both (D3).  m_account.c:187-351.
ChangeP(o, a) ==
  /\ nChg < MaxChanges
  /\ \/ o = "A" /\ POrigin \in {"home", "both"}
     \/ o = "B" /\ POrigin \in {"services", "both"} /\ Up
  /\ acc[o]["P"] # NOREP /\ a # acc[o]["P"]
  /\ nChg' = nChg + 1
  /\ acc' = [acc EXCEPT ![o]["P"] = a]
  /\ view' = IF chan[o] THEN [view EXCEPT ![ObsAt(o)]["P"] = a] ELSE view
  /\ Enq(o, <<L("AC", "P", a, FALSE, FALSE)>>)
  /\ seen' = seen \cup (IF ~Up /\ a = NONE THEN {"plogoutsplit"} ELSE {})
  /\ UNCHANGED <<alive, inSess, face, chan, link, nMsg, nSplit, win, bad, preSplit, verd>>

\* P parts or joins at A (channel.c:5856-5859)
PartJoinP ==
  /\ Joins /\ nChg < MaxChanges
  /\ nChg' = nChg + 1
  /\ chan' = [chan EXCEPT !["A"] = ~@]
  /\ view' = [view EXCEPT !["oA"]["P"] = IF chan["A"] THEN GONE ELSE acc["A"]["P"]]
  /\ Enq("A", <<L("J", "P", NONE, FALSE, ~chan["A"])>>)
  /\ UNCHANGED <<acc, alive, inSess, face, link, nMsg, nSplit, win, bad, seen, preSplit, verd>>

\* The face re-authenticates (sasl_auth.c:894-944): its server's copy of the
\* alias first (bouncer_session.c:12313-12315), BX U and AC in AliasFirst order.
SessReauth(c, a) ==
  LET h == Home(c)
      d == Peer(c)
      \* bounce_emit_alias_update looks the session up after the account is set
      \* (sasl_auth.c:906 then 933; bouncer_session.c:12296, 16822)
      hasAlias == acc[h][d] # NOREP /\ alive[d] /\ inSess[d]
                  /\ (Lookup = "byRecord" \/ a = SessName)
      bxu == IF hasAlias THEN <<L("BXU", d, a, FALSE, FALSE)>> ELSE <<>>
      ac == <<L("AC", c, a, FALSE, FALSE)>>
  IN
  /\ nChg < MaxChanges /\ alive[c] /\ inSess[c] /\ face[h] = c /\ MayChangeFace
  /\ a \in Accts /\ a # acc[h][c] /\ (SessSwitch \/ a = SessName)
  /\ nChg' = nChg + 1
  /\ acc' = [acc EXCEPT ![h][c] = a, ![h][d] = IF hasAlias THEN a ELSE @]
  /\ view' = [view EXCEPT ![ObsAt(h)]["S"] = a]
  /\ Enq(h, IF AliasFirst THEN bxu \o ac ELSE ac \o bxu)
  /\ seen' = seen \cup (IF hasAlias /\ Up THEN {"reauthlinked"} ELSE {})
                   \cup (IF Up /\ acc[h][d] # NOREP /\ alive[d] /\ inSess[d] THEN {"renamelinked"} ELSE {})
                   \cup (IF ~Up THEN {"splitchange"} ELSE {})
  /\ UNCHANGED <<alive, inSess, face, chan, link, nMsg, nSplit, win, bad, preSplit, verd>>

\* An alias device re-authenticates on its own (D5): bouncer_session.c:12293
\* returns for an alias, so only its own account changes; ACCOUNT goes to the
\* channels it mirrors, under nick S; AC to the peer.
AliasReauthA(c, a) ==
  LET h == Home(c) IN
  /\ AliasReauth /\ nChg < MaxChanges /\ alive[c] /\ inSess[c] /\ MayChangeFace
  /\ face[h] # c /\ face[h] # NOFACE
  /\ a \in Accts /\ a # acc[h][c]
  /\ nChg' = nChg + 1
  /\ acc' = [acc EXCEPT ![h][c] = a]
  /\ view' = [view EXCEPT ![ObsAt(h)]["S"] = a]
  /\ Enq(h, <<L("AC", c, a, FALSE, FALSE)>>)
  /\ seen' = seen \cup (IF ~Up THEN {"splitchange"} ELSE {})
  /\ UNCHANGED <<alive, inSess, face, chan, link, nMsg, nSplit, win, bad, preSplit, verd>>

\* A face is deauthed during a split (sasl_webhook.c:186-219): its session ends
\* here (bouncer_session.c:12138-12151), the connection stays.
LogoutFace(c) ==
  LET h == Home(c) IN
  /\ SessLogout /\ ~Up /\ nChg < MaxChanges
  /\ alive[c] /\ inSess[c] /\ face[h] = c
  /\ nChg' = nChg + 1
  /\ acc' = [acc EXCEPT ![h][c] = NONE]
  /\ inSess' = [inSess EXCEPT ![c] = FALSE]
  /\ view' = [view EXCEPT ![ObsAt(h)]["S"] = NONE]
  /\ seen' = seen \cup {"splitchange"}
  /\ UNCHANGED <<alive, face, chan, q, link, nMsg, nSplit, win, bad, preSplit, verd>>

-----------------------------------------------------------------------------
(* Messages                                                                *)

Send(c) ==
  LET h == Home(c) IN
  /\ nMsg < MaxMsgs /\ alive[c]
  /\ IF c = "P" THEN chan[h]
     ELSE face[h] = c \/ (inSess[c] /\ face[h] # NOFACE /\ inSess[face[h]])
  /\ nMsg' = nMsg + 1
  /\ bad' = bad \cup (IF CanSee(h, c) THEN DeliverBad(h, c, acc[h][c]) ELSE {})
  /\ seen' = seen \cup (IF CanSee(h, c) /\ c # Src(h, c) THEN {"aliasmsg"} ELSE {})
  /\ Enq(h, <<L("MSG", c, acc[h][c], c # Src(h, c), FALSE)>>)
  /\ UNCHANGED <<acc, alive, inSess, face, chan, view, link, nChg, nSplit, win, preSplit, verd>>

-----------------------------------------------------------------------------
(* Receiving one P10 line at v from Other(v)                               *)

Pop(v, out) == q' = [q EXCEPT ![Other(v)] = Tail(@), ![v] = @ \o out]

\* ms_account (m_account.c:189-190 ignore; 209, 325 notify).  A device's AC
\* is announced under nick S whether it is the face or an alias here (D5).
RecvAC(v, l) ==
  LET c == l.c IN
  /\ IF acc[v][c] = NOREP
     THEN UNCHANGED <<acc, view>>
     ELSE /\ acc' = [acc EXCEPT ![v][c] = l.a]
          /\ view' = IF c = "P"
                     THEN (IF chan[v] THEN [view EXCEPT ![ObsAt(v)]["P"] = l.a] ELSE view)
                     ELSE (IF face[v] # NOFACE THEN [view EXCEPT ![ObsAt(v)]["S"] = l.a] ELSE view)
  /\ Pop(v, <<>>)
  /\ UNCHANGED <<alive, inSess, face, chan, bad, seen>>

\* BX U account= applies to an alias only (bounce_alias_update), no line out
RecvBXU(v, l) ==
  /\ acc' = IF acc[v][l.c] # NOREP /\ face[v] # l.c
            THEN [acc EXCEPT ![v][l.c] = l.a] ELSE acc
  /\ Pop(v, <<>>)
  /\ UNCHANGED <<alive, inSess, face, chan, view, bad, seen>>

RecvMSG(v, l) ==
  /\ bad' = bad \cup (IF CanSee(v, l.c) THEN DeliverBad(v, l.c, l.a) ELSE {})
  /\ seen' = seen \cup (IF CanSee(v, l.c) /\ l.s THEN {"aliasmsg"} ELSE {})
  /\ Pop(v, <<>>)
  /\ UNCHANGED <<acc, alive, inSess, face, chan, view>>

RecvJ(v, l) ==
  /\ IF acc[v]["P"] = NOREP
     THEN UNCHANGED <<chan, view>>
     ELSE /\ chan' = [chan EXCEPT ![v] = l.ch]
          /\ view' = [view EXCEPT ![ObsAt(v)]["P"] = IF l.ch THEN acc[v]["P"] ELSE GONE]
  /\ Pop(v, <<>>)
  /\ UNCHANGED <<acc, alive, inSess, face, bad, seen>>

\* The burst's N for P: a new member gets a JOIN with the N's account
\* (m_burst.c:973-987); a member already present gets none.
RecvNP(v, l) ==
  LET member == acc[v]["P"] # NOREP /\ chan[v] IN
  /\ acc' = [acc EXCEPT ![v]["P"] = l.a]
  /\ chan' = [chan EXCEPT ![v] = l.ch]
  /\ view' = IF member THEN view
             ELSE [view EXCEPT ![ObsAt(v)]["P"] = IF l.ch THEN l.a ELSE GONE]
  /\ Pop(v, <<>>)
  /\ UNCHANGED <<alive, inSess, face, bad, seen>>

BxcVal(v, f) == IF BxcName = "session" THEN SessName ELSE acc[v][f]

\* The burst's N for a device c meets this server's face f (D8)
RecvND(v, l) ==
  LET c == l.c
      f == face[v]
  IN
  CASE f = NOFACE ->
         /\ face' = [face EXCEPT ![v] = c]
         /\ acc' = [acc EXCEPT ![v][c] = l.a]
         /\ view' = [view EXCEPT ![ObsAt(v)]["S"] = l.a]
         /\ Pop(v, <<>>)
         /\ UNCHANGED <<alive, inSess, chan, bad, seen, verd>>
    [] f = c ->
         /\ acc' = [acc EXCEPT ![v][c] = l.a]
         /\ view' = [view EXCEPT ![ObsAt(v)]["S"] = l.a]
         /\ Pop(v, <<>>)
         /\ UNCHANGED <<alive, inSess, face, chan, bad, seen, verd>>
    [] Home(f) = v /\ l.s /\ inSess[f] /\ alive[f] /\ l.a = acc[v][f] /\ l.a # NONE
       /\ (Lookup = "byRecord" \/ l.a = SessName) ->
         \* D.2 merge: m_nick.c:655-658 reads our client's current account; the
         \* session is found by that name (bouncer_session.c:2172)
         /\ seen' = seen \cup {"merge"}
         /\ verd' = [verd EXCEPT ![v] = "merge"]
         /\ IF win.merge = v
            THEN /\ Pop(v, <<>>)
                 /\ UNCHANGED <<acc, face>>
            ELSE /\ face' = [face EXCEPT ![v] = c]
                 /\ acc' = [acc EXCEPT ![v][c] = l.a]
                 /\ Pop(v, <<L("BXC", f, BxcVal(v, f), TRUE, FALSE)>>)
         /\ UNCHANGED <<alive, inSess, chan, view, bad>>
    [] Home(f) = v ->
         \* classic collision (m_nick.c:1068-1135)
         /\ seen' = seen \cup {"classic"}
         /\ verd' = [verd EXCEPT ![v] = "classic"]
         /\ CASE win.classic = Home(c) ->
                   /\ alive' = [alive EXCEPT ![f] = FALSE]
                   /\ inSess' = [inSess EXCEPT ![f] = FALSE]
                   /\ face' = [face EXCEPT ![v] = c]
                   /\ acc' = [acc EXCEPT ![v][c] = l.a]
                   /\ view' = [view EXCEPT ![ObsAt(v)]["S"] = l.a]
                   /\ Pop(v, <<L("KILL", f, NONE, FALSE, FALSE)>>)
              [] win.classic = v
                 \/ (win.classic = "code" /\ acc[v][f] # NONE /\ l.a = NONE) ->
                   \* (code: the account-asymmetry override, m_nick.c:994-1016)
                   /\ Pop(v, <<L("KILL", c, NONE, FALSE, FALSE)>>)
                   /\ UNCHANGED <<alive, inSess, face, acc, view>>
              [] OTHER ->
                   /\ alive' = [alive EXCEPT ![f] = FALSE]
                   /\ inSess' = [inSess EXCEPT ![f] = FALSE]
                   /\ face' = [face EXCEPT ![v] = NOFACE]
                   /\ view' = [view EXCEPT ![ObsAt(v)]["S"] = GONE]
                   /\ Pop(v, <<L("KILL", f, NONE, FALSE, FALSE), L("KILL", c, NONE, FALSE, FALSE)>>)
                   /\ UNCHANGED acc
         /\ UNCHANGED <<chan, bad>>
    [] OTHER ->
         /\ bad' = bad \cup {"Unexpected"}
         /\ Pop(v, <<>>)
         /\ UNCHANGED <<acc, alive, inSess, face, chan, view, seen, verd>>

\* BX C of a demoted face: filed as an alias with the line's account
\* (bouncer_session.c:14518, :14561)
RecvBXC(v, l) ==
  /\ IF ~alive[l.c] THEN UNCHANGED <<acc, bad>>
     ELSE IF face[v] = l.c THEN /\ bad' = bad \cup {"Unexpected"}
                                /\ UNCHANGED acc
     ELSE /\ acc' = [acc EXCEPT ![v][l.c] = l.a]
          /\ UNCHANGED bad
  /\ Pop(v, <<>>)
  /\ UNCHANGED <<alive, inSess, face, chan, view, seen>>

RecvKILL(v, l) ==
  LET c == l.c IN
  /\ alive' = [alive EXCEPT ![c] = FALSE]
  /\ inSess' = [inSess EXCEPT ![c] = IF c \in Devs THEN FALSE ELSE @]
  /\ acc' = [acc EXCEPT ![v][c] = IF Home(c) = v THEN @ ELSE NOREP]
  /\ face' = IF face[v] = c THEN [face EXCEPT ![v] = NOFACE] ELSE face
  /\ view' = IF face[v] = c THEN [view EXCEPT ![ObsAt(v)]["S"] = GONE] ELSE view
  /\ Pop(v, <<>>)
  /\ UNCHANGED <<chan, bad, seen>>

Recv(v) ==
  /\ q[Other(v)] # <<>>
  /\ LET l == Head(q[Other(v)]) IN
     CASE l.t = "AC" -> RecvAC(v, l) /\ UNCHANGED verd
       [] l.t = "BXU" -> RecvBXU(v, l) /\ UNCHANGED verd
       [] l.t = "MSG" -> RecvMSG(v, l) /\ UNCHANGED verd
       [] l.t = "J" -> RecvJ(v, l) /\ UNCHANGED verd
       [] l.t = "N" /\ l.c = "P" -> RecvNP(v, l) /\ UNCHANGED verd
       [] l.t = "N" -> RecvND(v, l)
       [] l.t = "BXC" -> RecvBXC(v, l) /\ UNCHANGED verd
       [] l.t = "KILL" -> RecvKILL(v, l) /\ UNCHANGED verd
  /\ UNCHANGED <<link, nChg, nMsg, nSplit, win, preSplit>>

-----------------------------------------------------------------------------
(* Split and heal                                                          *)

\* v promotes its own device when the face was the peer's (D6):
\* bouncer_session.c:8820-8925, s_misc.c:1083-1104
Promotes(v) ==
  /\ face[v] # NOFACE /\ Home(face[v]) # v
  /\ alive[Dev(v)] /\ inSess[Dev(v)] /\ inSess[face[v]]
NewFace(v) ==
  IF face[v] = NOFACE \/ Home(face[v]) = v THEN face[v]
  ELSE IF Promotes(v) THEN Dev(v) ELSE NOFACE

Split ==
  /\ Up /\ nSplit < MaxSplits
  /\ LossAtSplit \/ (q["A"] = <<>> /\ q["B"] = <<>>)
  /\ link' = "split"
  /\ nSplit' = nSplit + 1
  /\ q' = [v \in Servers |-> <<>>]
  /\ preSplit' = acc["A"]["P"]
  /\ face' = [v \in Servers |-> NewFace(v)]
  /\ acc' = [v \in Servers |-> [c \in Clients |->
               IF Home(c) = v THEN acc[v][c] ELSE NOREP]]
  /\ view' = [o \in Obs |-> [n \in Nicks |->
               LET v == Srv(o) IN
               IF n = "P" THEN (IF v = Home("P") THEN view[o]["P"] ELSE GONE)
               ELSE IF NewFace(v) = NOFACE THEN GONE
               ELSE IF Promotes(v) /\ PromoteNotify THEN acc[v][Dev(v)]
               ELSE view[o]["S"]]]
  /\ seen' = seen \cup {"split"} \cup (IF \E v \in Servers : Promotes(v) THEN {"promote"} ELSE {})
  /\ UNCHANGED <<alive, inSess, chan, nChg, nMsg, win, bad, verd>>

BurstP(v) == IF v = Home("P") THEN <<L("N", "P", preSplit, FALSE, chan[v])>> ELSE <<>>
BurstFace(v) ==
  IF face[v] # NOFACE /\ Home(face[v]) = v
  THEN <<L("N", face[v], acc[v][face[v]], inSess[face[v]], FALSE)>> ELSE <<>>

Heal ==
  /\ link = "split"
  /\ link' = "up"
  /\ \E m \in Servers,
        k \in CASE ClassicTie = "any" -> Servers \cup {"none"}
               [] ClassicTie = "winner" -> Servers
               [] OTHER -> {"code"} :
       win' = [merge |-> m, classic |-> k]
  /\ q' = [v \in Servers |-> BurstP(v) \o BurstFace(v)]
  /\ verd' = [v \in Servers |-> "none"]
  /\ seen' = seen \cup {"heal"}
  /\ UNCHANGED <<acc, alive, inSess, face, chan, view, nChg, nMsg, nSplit, bad, preSplit>>

Next ==
  \/ \E o \in Servers, a \in Accts \cup {NONE} : ChangeP(o, a)
  \/ PartJoinP
  \/ \E c \in Devs, a \in Accts : SessReauth(c, a) \/ AliasReauthA(c, a)
  \/ \E c \in Devs : LogoutFace(c)
  \/ \E c \in Clients : Send(c)
  \/ \E v \in Servers : Recv(v)
  \/ Split
  \/ Heal

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties (DECISIONS.md, P1-P9)                                        *)

Truth(v, n) ==
  IF n = "P" THEN (IF chan[Home("P")] THEN acc[Home("P")]["P"] ELSE GONE)
  ELSE IF face[v] = NOFACE \/ ~alive[face[v]] THEN GONE
  ELSE acc[Home(face[v])][face[v]]

ViewMatchesServer == \A o \in Obs, n \in Nicks : view[o][n] = Belief(Srv(o), n)
ViewConverges == Quiescent => \A o \in Obs, n \in Nicks : view[o][n] = Truth(Srv(o), n)
TagAgreesView == "TagView" \notin bad
TagAtSendPlain == "TagSendPlain" \notin bad
TagAtSend == "TagSend" \notin bad
NoUnexpected == "Unexpected" \notin bad
\* both servers took the same same-nick verdict (D8: the code's contract)
VerdictsAgree == (verd["A"] # "none" /\ verd["B"] # "none") => verd["A"] = verd["B"]

IsAlias(d) == alive[d] /\ inSess[d] /\ face[Home(d)] # NOFACE /\ face[Home(d)] # d
AliasesAgree == Quiescent =>
  \A d \in Devs : IsAlias(d) =>
    /\ acc[Home(d)][d] = acc[Home(face[Home(d)])][face[Home(d)]]
    /\ \A v \in Servers : acc[v][d] \in {NOREP, acc[Home(d)][d]}
CopiesAgree == Quiescent =>
  \A v \in Servers, c \in Clients :
    (alive[c] /\ acc[v][c] # NOREP) => acc[v][c] = acc[Home(c)][c]
OneFace == Quiescent =>
  /\ face["A"] = face["B"]
  /\ face["A"] # NOFACE => alive[face["A"]]
  /\ \A d \in Devs : alive[d] =>
       \/ face[Home(d)] = d
       \/ (inSess[d] /\ face[Home(d)] # NOFACE /\ inSess[face[Home(d)]])
  /\ \A v \in Servers, c \in Clients :
       Home(c) # v => (acc[v][c] # NOREP <=> alive[c])

\* The session is not lost to a nick collision: at quiescence a device lives
NoSessionLoss == Quiescent => \E d \in Devs : alive[d]

\* The live-repro path: a face renamed while linked, no device changed during
\* the split, and the session is lost at the heal
NoLossAfterLinkedRename ==
  ~(Quiescent /\ \A d \in Devs : ~alive[d]
    /\ "renamelinked" \in seen /\ "splitchange" \notin seen)

\* Covers: each must be violated in some passing config
CoverPromote == "promote" \notin seen
CoverMerge == ~(Quiescent /\ "merge" \in seen)
CoverClassic == ~(Quiescent /\ "classic" \in seen)
CoverSplitLogoutHealed ==
  ~(Quiescent /\ {"plogoutsplit", "heal"} \subseteq seen /\ view["oB"]["P"] = NONE)
CoverAliasMsg == "aliasmsg" \notin seen
CoverReauthLinked == ~(Quiescent /\ "reauthlinked" \in seen)
=============================================================================
