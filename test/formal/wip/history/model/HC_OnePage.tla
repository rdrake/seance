---------------------------- MODULE HC_OnePage ----------------------------
(***************************************************************************)
(* Filling a gap with CHATHISTORY after a reconnect: the server's store,   *)
(* LATEST and BEFORE pages (CH-10, CH-12), one connection order (CH-19),   *)
(* chathistory-end (CH-21), a live message racing a page (D6, BA-9), and   *)
(* the client's loop (CH-23, Seance's catchup.ts) with dedupe and merge.  *)
(* Decisions: ../DECISIONS.md D3-D11, D14, D22-D24.  Bounds: DESIGN.md.    *)
(*                                                                         *)
(* v1.2 (D35): NOld stored lines older than everything held, in the      *)
(* server's store but not in the buffer (reconnect only); a page line    *)
(* below min(floor, oldest held) is dropped, as Seance does since #282.  *)
(* NOld = 0 is v1.1 exactly.                                              *)
(*                                                                         *)
(* v1.3 (D36): Holes, stored lines missing between two held lines (the    *)
(* held span is no longer all held), and Skew, a server clock that may    *)
(* stamp a later-stored line up to Skew earlier.  Holes = {} and Skew = 0 *)
(* is v1.2 exactly.                                                        *)
(*                                                                         *)
(* v1 (HISTORY-REVIEW-3, D26): three request kinds, each with its own     *)
(* obligation (Mode: reconnect catch-up, first JOIN's LATEST *, "more"'s  *)
(* BEFORE <oldest held>); FAIL ends a request without recovering it; the *)
(* selector form (wildcard, timestamp, msgid) is explicit, an unknown     *)
(* msgid selects nothing (UnknownEmpty), and EndNext is an end oracle     *)
(* written from the next query rather than from EndOK.                    *)
(*                                                                         *)
(* v0.1 (HISTORY-REVIEW-1): msgid and content are separate (a replay may *)
(* mint a new id, HS_NewId); the page records its snapshot, so the       *)
(* PageEligible and EndTruthful oracles are fixed at answer time.          *)
(*                                                                         *)
(* v0: the catch-up path only (no first JOIN, no "more", no FAIL).  A page *)
(* reaches the client as one wire item (D22); a live line is a separate    *)
(* item, so it can come before or after the page.                          *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
    Mode,          \* "reconnect", "join" (first JOIN) or "more" (D26)
    MayFail,       \* the server may answer a query with FAIL (CH-7)
    NOld,          \* reconnect: stored lines older than every held one, not in buf (D35); else 0
    NHeld,         \* reconnect: messages held before the gap (1..2); more: held (newest); join: 0
    Holes,         \* reconnect: offsets in the held span that are stored but not held (D36); else {}
    Skew,          \* a later-stored line may carry a time up to Skew earlier (D36); 0: none
    NGap,          \* reconnect: stored during the gap; more: older than the held; join: the store
    LiveOn,        \* one more message stored during catch-up (D6)
    Times,         \* the time values, e.g. {1, 3}
    Fuzz,          \* FUZZ_INTERVAL (D8: 0 or 1)
    Limit,         \* the page limit the client asks for (CH-3)
    BudgetKind,    \* "pages" or "msgs" (D14)
    BudgetN,       \* k for pages(k), m for messages(m)
    \* server switches (DECISIONS.md switch table)
    ExactCount, Contiguous, TimeOrdered, BatchAgrees, StableAcrossReconnect,
    SendsEnd,      \* the server may tag the page with chathistory-end (truthfully)
    \* client switches
    Dedupe,        \* skip a msgid already in the buffer (MI-4)
    MsgidAnchor,   \* BEFORE msgid=... (the spec's loop) or BEFORE timestamp=...
    StopOnHeld,    \* also stop when a page holds a msgid held before the gap
    InsertMerge    \* insert each message by time, or append in arrival order

ASSUME NOld = 0 \/ Mode = "reconnect"
\* D36: a hole is strictly inside the held span, so the oldest and the newest
\* line of the span are held (Floor and HoldsFrom read held lines).
NHoles == Cardinality(Holes)
Span == NHeld + NHoles               \* reconnect: held lines and the holes between them
ASSUME Holes = {} \/ (Mode = "reconnect" /\ \A k \in Holes : 1 < k /\ k < Span)
ASSUME Skew = 0 \/ Mode = "reconnect"

NStored == NOld + Span + NGap
N == NStored + (IF LiveOn THEN 1 ELSE 0)
Ids == 1..N
Mids == 1..(2 * N)                \* a message's msgid; N + c is a re-minted id for content c
Content(x) == IF x > N THEN x - N ELSE x
Replay(c) == c                    \* CH-18: a replayed message keeps its msgid
\* reconnect: Old (never loaded), then the held span (held messages, with
\* Holes among them: stored, never loaded, D36), then the gap; more:
\* the held messages are the newest and the "gap" is the older history; join:
\* nothing held.
Old == 1..NOld
HoleIds == {NOld + k : k \in Holes}
Held == IF Mode = "more" THEN (NGap + 1)..NStored ELSE ((NOld + 1)..(NOld + Span)) \ HoleIds
Gap == IF Mode = "more" THEN 1..NGap ELSE (NOld + Span + 1)..NStored
NotHole(x) == x \notin HoleIds
HeldSeq == SelectSeq([i \in 1..Span |-> NOld + i], NotHole)   \* reconnect: held, in store order
LiveId == N                       \* meaningful only when LiveOn

\* Store times are non-decreasing along the store (D8), or, with Skew (D36),
\* a later-stored line is at most Skew earlier.
TimeFns == {f \in [Ids -> Times] : \A i \in Ids : \A j \in Ids : i < j => f[i] <= f[j] + Skew}

Range(s) == {s[i] : i \in DOMAIN s}
Perms(S) == {p \in [1..Cardinality(S) -> S] : Range(p) = S}
IsSub(p, s) == \E f \in [1..Len(p) -> 1..Len(s)] :
                  (\A i \in 1..Len(p) : s[f[i]] = p[i])
                  /\ \A i \in 1..Len(p) - 1 : f[i] < f[i + 1]
Pos(s, x) == CHOOSE i \in DOMAIN s : s[i] = x

VARIABLES
    time,      \* environment, fixed in Init: message -> time
    ord,       \* server: the new connection's total order of stored messages (CH-19)
    liveSt,    \* server: the live message is stored (in ord)
    liveRel,   \* server: the live message has been relayed to the client
    q,         \* the query in flight, or a record with k = "none"
    s2c,       \* the wire: page items and live items
    buf,       \* client: the buffer, a sequence of msgids, in display order
    pgSeen,    \* ghost: contents received in pages
    liveSeen,  \* ghost: the relayed live line has been read
    phase,     \* client: "query", "wait" or "done"
    anchor,    \* client: the first message of the last page (CH-23 earliest_message)
    pages,     \* client: pages received
    got,       \* client: messages retrieved (D14)
    why,       \* client: why catch-up stopped ("none" while running)
    pg1,       \* ghost: the first page as received (its snapshot), or NoItem
    unkEmpty   \* ghost: an empty page answered a BEFORE with an unknown msgid

vars == <<time, ord, liveSt, liveRel, q, s2c, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>

\* form: "star" (LATEST *), "msgid" or "ts" (BEFORE msgid=sel / timestamp=ts).
NoQ == [k |-> "none", form |-> "none", sel |-> 0, ts |-> 0]
NoItem == [k |-> "none", ms |-> << >>, end |-> FALSE, qq |-> NoQ, el |-> {}, so |-> << >>]
T(x) == time[Content(x)]            \* a msgid's time
\* lower_bound - FUZZ_INTERVAL (CH-23); reconnect only.  lower_bound is the
\* newest held line (Seance: chan.catchupRef(), the newest server-stamped
\* line); with Skew = 0 that is the last of the span, time[NOld + Span].
MaxT(S) == CHOOSE t \in Times : (\E x \in S : time[x] = t) /\ \A x \in S : time[x] <= t
MinT(S) == CHOOSE t \in Times : (\E x \in S : time[x] = t) /\ \A x \in S : time[x] >= t
Floor == IF NHeld = 0 THEN 0 ELSE MaxT(Held) - Fuzz
\* D35: the oldest held line's time (Seance: chan.oldestTimeOf(held)), and the
\* cutoff below which a reconnect page line is never placed: Seance's
\* Math.min(floorMs, holdsFrom), i.e. min(newest held - FUZZ, oldest held).
HoldsFrom == IF NHeld = 0 THEN 0 ELSE MinT(Held)
Cutoff == IF Floor < HoldsFrom THEN Floor ELSE HoldsFrom

\* D7: the order on the new connection.
\*   StableAcrossReconnect: no existing pair swaps (the store order);
\*   else TimeOrdered: only equal-time messages may swap;
\*   else any total order.
OrdOK(o, t) ==
    /\ StableAcrossReconnect => o = [i \in 1..NStored |-> i]
    /\ TimeOrdered => \A i \in 1..NStored - 1 : t[o[i]] <= t[o[i + 1]]

Init ==
    /\ time \in TimeFns
    /\ ord \in {o \in Perms(1..NStored) : OrdOK(o, time)}
    /\ liveSt = FALSE /\ liveRel = FALSE
    /\ q = NoQ /\ s2c = <<>>
    /\ buf = IF Mode = "more" THEN [i \in 1..NHeld |-> NGap + i]
             ELSE [i \in 1..NHeld |-> HeldSeq[i]]   \* held in the old connection's order; join: empty
    /\ pgSeen = {} /\ liveSeen = FALSE
    /\ phase = "query" /\ anchor = 0 /\ pages = 0 /\ got = 0 /\ why = "none"
    /\ pg1 = NoItem /\ unkEmpty = FALSE

-----------------------------------------------------------------------------
\* Server.

\* D3, D5: eligible messages for a query against the order o (anchor excluded).
\* Only LATEST * and BEFORE msgid= / timestamp= are modelled (D26).
Elig(qq, o) ==
    CASE qq.form = "star" -> Range(o)                    \* LATEST *
      \* MI-5: a msgid is looked up as given; an unknown one selects nothing
      \* (D5's empty-batch reply).
      [] qq.form = "msgid" ->
            IF qq.sel \in Range(o) THEN {o[i] : i \in 1..(Pos(o, qq.sel) - 1)} ELSE {}
      [] qq.form = "ts" -> {m \in Range(o) : time[m] < qq.ts}   \* BEFORE timestamp=ts

\* D10: with Contiguous, the c eligible messages nearest the selector, i.e.
\* the newest in o; else any c of them.
Chosen(E, c, o) ==
    IF Contiguous
    THEN {{o[i] : i \in {j \in DOMAIN o : o[j] \in E /\
              Cardinality({l \in DOMAIN o : l > j /\ o[l] \in E}) < c}}}
    ELSE {S \in SUBSET E : Cardinality(S) = c}

\* The order of S as o has it.
InOrd(S, o) == CHOOSE p \in Perms(S) : IsSub(p, o)

\* D9 (v0.2, D25): chathistory-end means the next page in the same direction,
\* BEFORE the batch's first message (CH-23's next selector), would be empty
\* in the snapshot; for an empty page, that the query itself had nothing.
EndOK(E, p, o) ==
    IF p = << >> THEN E = {} ELSE Pos(o, p[1]) = 1

\* CH-6, D3: the page's size; then its content (D10) and order (D7, BatchAgrees).
SrvAnswer ==
    /\ q.k # "none"
    /\ LET E == Elig(q, ord)
           cap == IF Cardinality(E) < Limit THEN Cardinality(E) ELSE Limit
           big == IF Cardinality(E) < Limit + 1 THEN Cardinality(E) ELSE Limit + 1
       IN \E c \in (IF ExactCount THEN {cap} ELSE 0..big) :
          \E S \in Chosen(E, c, ord) :
          \E p \in (IF BatchAgrees THEN {InOrd(S, ord)} ELSE Perms(S)) :
          \E e \in (IF SendsEnd /\ EndOK(E, p, ord) THEN BOOLEAN ELSE {FALSE}) :  \* D9
             s2c' = Append(s2c, [k |-> "page", ms |-> [i \in DOMAIN p |-> Replay(p[i])], end |-> e,
                                 qq |-> q, el |-> Elig(q, ord), so |-> ord])
    /\ q' = NoQ
    /\ UNCHANGED <<time, ord, liveSt, liveRel, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>

\* CH-7: the server may refuse the query with FAIL (D26).
SrvFail ==
    /\ MayFail /\ q.k # "none"
    /\ s2c' = Append(s2c, [NoItem EXCEPT !.k = "fail", !.qq = q])
    /\ q' = NoQ
    /\ UNCHANGED <<time, ord, liveSt, liveRel, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>

\* D6: the live message is stored (it joins the order as the newest) ...
StoreLive ==
    /\ LiveOn /\ ~liveSt
    /\ liveSt' = TRUE
    /\ ord' = Append(ord, LiveId)
    /\ UNCHANGED <<time, liveRel, q, s2c, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>

\* ... and relayed at any later point, before or after a page (BA-9).
RelayLive ==
    /\ liveSt /\ ~liveRel
    /\ liveRel' = TRUE
    /\ s2c' = Append(s2c, [NoItem EXCEPT !.k = "live", !.ms = <<LiveId>>])
    /\ UNCHANGED <<time, ord, liveSt, q, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>

-----------------------------------------------------------------------------
\* Client.

\* Insert m after every message whose time is <= its own (a stable insert).
InsertByTime(b, m) ==
    LET k == Cardinality({i \in DOMAIN b : T(b[i]) <= T(m)})
    IN SubSeq(b, 1, k) \o <<m>> \o SubSeq(b, k + 1, Len(b))

Merge1(b, m) ==
    IF Dedupe /\ m \in Range(b) THEN b
    ELSE IF InsertMerge THEN InsertByTime(b, m) ELSE Append(b, m)

\* D35, Seance since #282 (history.ts resolve): in a reconnect, a page line
\* older than min(floor, oldest held) is older than the gap, never loaded,
\* and is not placed (scrolling up brings it as history).  Only with a held
\* line to judge by (Seance: a held msgid; else the page is kept); a line at
\* or above the cutoff is merged as before (by msgid, Dedupe).  The stop
\* decision, the anchor and the budget still read the whole page.
Placed(m) == ~(Mode = "reconnect" /\ NHeld > 0 /\ T(m) < Cutoff)
Kept(it) == IF it.k = "page" THEN SelectSeq(it.ms, Placed) ELSE it.ms

RECURSIVE MergeAll(_, _)
MergeAll(b, ms) == IF ms = <<>> THEN b ELSE MergeAll(Merge1(b, Head(ms)), Tail(ms))

BudgetLeft(pg, gt) == IF BudgetKind = "pages" THEN pg < BudgetN ELSE gt < BudgetN

\* The first query: LATEST * for a reconnect or a first JOIN; for "more",
\* BEFORE the oldest held message (DESIGN.md's table).  Later queries (the
\* reconnect loop only): BEFORE the first message of the last page.
FirstAnchor == NGap + 1             \* "more": the oldest held message
Before(a) == IF MsgidAnchor THEN [NoQ EXCEPT !.k = "before", !.form = "msgid", !.sel = a]
             ELSE [NoQ EXCEPT !.k = "before", !.form = "ts", !.ts = T(a)]

CQuery ==
    /\ phase = "query"
    /\ IF ~BudgetLeft(pages, got)
       THEN phase' = "done" /\ why' = "budget" /\ q' = q
       ELSE /\ q' = IF pages = 0 /\ Mode # "more" THEN [NoQ EXCEPT !.k = "latest", !.form = "star"]
                    ELSE Before(IF pages = 0 THEN FirstAnchor ELSE anchor)
            /\ phase' = "wait" /\ why' = why
    /\ UNCHANGED <<time, ord, liveSt, liveRel, s2c, buf, pgSeen, liveSeen, anchor, pages, got, pg1, unkEmpty>>

\* CH-23: process one wire item.  A page ends the wait and decides the stop.
CRecv ==
    /\ s2c # <<>>
    /\ s2c' = Tail(s2c)
    /\ LET it == Head(s2c) IN
       /\ buf' = MergeAll(buf, Kept(it))
       /\ pgSeen' = IF it.k = "page" THEN pgSeen \cup {Content(it.ms[i]) : i \in DOMAIN it.ms} ELSE pgSeen
       /\ liveSeen' = (liveSeen \/ it.k = "live")
       /\ pg1' = IF it.k = "page" /\ pages = 0 THEN it ELSE pg1
       /\ unkEmpty' = (unkEmpty \/ (it.k = "page" /\ it.ms = << >> /\ it.qq.form = "msgid"
                                    /\ it.qq.sel \notin Range(it.so)))
       /\ IF it.k = "live"
          THEN UNCHANGED <<phase, anchor, pages, got, why>>
          ELSE IF it.k = "fail"           \* D26: FAIL ends the request, unrecovered
          THEN /\ phase' = "done" /\ why' = "fail"
               /\ UNCHANGED <<anchor, pages, got>>
          ELSE LET ms == it.ms
                   stop == IF Mode # "reconnect" THEN "one"   \* JOIN and "more": one page
                           ELSE IF ms = <<>> THEN "empty"
                           ELSE IF it.end THEN "end"
                           ELSE IF T(ms[1]) < Floor THEN "floor"
                           ELSE IF StopOnHeld /\ Range(ms) \cap Held # {} THEN "held"
                           ELSE "floor"
               IN /\ pages' = pages + 1
                  /\ got' = got + Len(ms)
                  /\ anchor' = IF ms = <<>> THEN anchor ELSE ms[1]
                  /\ IF stop = "none"
                     THEN phase' = "query" /\ why' = why
                     ELSE phase' = "done" /\ why' = stop
    /\ UNCHANGED <<time, ord, liveSt, liveRel, q>>

Next == SrvAnswer \/ SrvFail \/ StoreLive \/ RelayLive \/ CQuery \/ CRecv

Spec == Init /\ [][Next]_vars
FairSpec == Spec /\ WF_vars(SrvAnswer) /\ WF_vars(RelayLive) /\ WF_vars(CQuery) /\ WF_vars(CRecv)

-----------------------------------------------------------------------------
\* Properties.

TypeOK ==
    /\ phase \in {"query", "wait", "done"}
    /\ why \in {"none", "budget", "empty", "end", "floor", "held", "fail", "one"}
    /\ Range(buf) \subseteq Mids
    /\ pages \in Nat /\ got \in Nat

Done == phase = "done"

\* NoLoss (DESIGN.md): once a reconnect catch-up completes, other than by
\* FAIL (D26), every gap message is held.
Held1 == {Content(buf[i]) : i \in DOMAIN buf}
NoLoss == (Mode = "reconnect" /\ Done /\ why # "fail") => Gap \subseteq Held1
\* The same without the FAIL exception (W_FailLoss: FAIL is reachable and loses).
NoLossEvenOnFail == (Mode = "reconnect" /\ Done) => Gap \subseteq Held1

\* D26, first JOIN: LATEST * Limit holds the Limit newest messages of the
\* first page's snapshot.
JoinRecovers == (Mode = "join" /\ Done /\ why # "fail") =>
                    LET so == pg1.so IN {so[i] : i \in {j \in DOMAIN so : j > Len(so) - Limit}} \subseteq Held1
\* D26, "more": BEFORE <oldest held> Limit holds the Limit newest of the older
\* messages (the store order is unchanged on one connection).
MoreRecovers == (Mode = "more" /\ Done /\ why # "fail") =>
                    {g \in Gap : g > NGap - Limit} \subseteq Held1

\* D35, server order against what is held: in a reconnect no line older than
\* every held line comes after a held line in the buffer (the phone trace:
\* LATEST reached below the oldest held line, and an appending client put
\* those lines after the held ones, above the rejoin).
HeldOrder == Mode = "reconnect" =>
                 \A i, j \in DOMAIN buf : (i < j /\ Content(buf[i]) \in Held) => T(buf[j]) >= HoldsFrom

\* D36, a hole (a stored line between two held lines that the client never
\* had): once a page carried it, it is in the buffer exactly once, whatever
\* the walk did next (no loss, no duplicate).
HoleKept == \A h \in HoleIds :
               h \in pgSeen => Cardinality({i \in DOMAIN buf : Content(buf[i]) = h}) = 1
\* D36, and in server order among the held lines: a hole never stands on the
\* wrong side of a held line (or another hole) with a different time.  Up to
\* ties: a time-merging client cannot see the server's order inside a tie
\* (D7).  Meaningful with Skew = 0 only.
HoleOrder == \A i, j \in DOMAIN buf :
                 LET a == Content(buf[i])  b == Content(buf[j]) IN
                 (i < j /\ {a, b} \subseteq Held \cup HoleIds /\ {a, b} \cap HoleIds # {})
                     => T(buf[i]) <= T(buf[j])
\* D36, the lemma msgid settling rests on: a stored line older than every
\* held line is an Old one (never a hole, gap or live line).  True by
\* construction with Skew = 0; Skew breaks it.
OldByTime == (Mode = "reconnect" /\ NHeld > 0) =>
                 \A m \in 1..N : time[m] < HoldsFrom => m \in Old

\* NoDup: no msgid twice in the buffer.
NoDup == \A i, j \in DOMAIN buf : i # j => buf[i] # buf[j]

\* Order: at completion the buffer is non-decreasing in time.
Order == Done => \A i \in 1..Len(buf) - 1 : T(buf[i]) <= T(buf[i + 1])

\* DESIGN.md (NoDup): no message content twice; a server that mints a new
\* msgid on replay (HS_NewId) breaks it past a deduping client.
ContentOnce == \A i, j \in DOMAIN buf : i # j => Content(buf[i]) # Content(buf[j])
\* CH-18, as an id-range check: a replay carries no newly minted msgid
\* (enough for HS_NewId; not a general provenance check).
ReplayIdStable == \A i \in DOMAIN s2c : \A j \in DOMAIN s2c[i].ms : s2c[i].ms[j] \in Ids
\* W_NoDedupe's story: the live message, relayed and replayed, held twice.
NoDupLive == Cardinality({i \in DOMAIN buf : buf[i] = LiveId}) <= 1

\* D3: every page holds only messages eligible for its query (a server check).
PageEligible == \A i \in DOMAIN s2c :
                  s2c[i].k = "page" => {Content(x) : x \in Range(s2c[i].ms)} \subseteq s2c[i].el

\* MI-5, D26: a BEFORE whose msgid the snapshot does not hold selects nothing.
UnknownEmpty == \A i \in DOMAIN s2c :
                  (s2c[i].k = "page" /\ s2c[i].qq.form = "msgid" /\ s2c[i].qq.sel \notin Range(s2c[i].so))
                      => s2c[i].ms = << >>

\* D26: the end oracle written from CH-23's next query, not from EndOK.  A
\* tagged page means BEFORE msgid=<its first wire msgid>, against the same
\* snapshot, would select nothing; a tagged empty page means the query had
\* nothing eligible.  (Exactness: with a minted first id the next lookup is
\* unknown, so this oracle accepts the tag; EndOK, decoding content, does not.)
EndNext == \A i \in DOMAIN s2c :
              (s2c[i].k = "page" /\ s2c[i].end) =>
                  IF s2c[i].ms = << >> THEN s2c[i].el = {}
                  ELSE Elig([NoQ EXCEPT !.k = "before", !.form = "msgid", !.sel = s2c[i].ms[1]], s2c[i].so) = {}

\* D9: a chathistory-end tag is truthful.
EndTruthful == \A i \in DOMAIN s2c :
                  (s2c[i].k = "page" /\ s2c[i].end) =>
                      EndOK(s2c[i].el, [j \in DOMAIN s2c[i].ms |-> Content(s2c[i].ms[j])], s2c[i].so)

\* Termination of the catch-up (FairSpec only).
Terminates == <>Done

\* Covers: each must be violated (reachable).
CoverDone      == ~(Done /\ Gap \subseteq Held1)
CoverMultiPage == ~(Done /\ pages >= 2)
CoverFloor     == ~(why = "floor")
CoverEmpty     == ~(why = "empty")
CoverEnd       == ~(why = "end")
CoverBudget    == ~(why = "budget")
CoverHeldStop  == ~(why = "held")
CoverLiveBoth  == ~(liveSeen /\ LiveOn /\ LiveId \in pgSeen)
CoverFail      == ~(why = "fail")
CoverJoinDone  == ~(Mode = "join" /\ Done /\ why = "one" /\ Len(buf) >= Limit)
CoverMoreDone  == ~(Mode = "more" /\ Done /\ why = "one" /\ Gap \cap Held1 # {})
\* HISTORY-REVIEW-4: the minted-anchor chain in one state: a BEFORE with an
\* unknown msgid, its empty page ending the loop, and a gap message missing
CoverUnknownLoss == ~(Done /\ why = "empty" /\ unkEmpty /\ ~(Gap \subseteq Held1))
CoverUnknownSel == ~(\E i \in DOMAIN s2c : s2c[i].k = "page" /\ s2c[i].qq.form = "msgid" /\ s2c[i].qq.sel \notin Range(s2c[i].so))
\* the reversed-batch regression (review 2): a page that reaches the snapshot's
\* oldest message but whose batch starts elsewhere, e.g. order <<1,2>>, batch
\* <<2,1>>; it must go untagged (HS_EndLast tags it)
CoverEndReversed == ~(\E i \in DOMAIN s2c : s2c[i].k = "page" /\ Len(s2c[i].ms) >= 2
                        /\ s2c[i].ms[Len(s2c[i].ms)] = s2c[i].so[1] /\ s2c[i].ms[1] # s2c[i].so[1])
\* D35: a page reached below everything held and the client dropped a line
CoverOldDropped == ~(\E o \in Old : o \in pgSeen /\ o \notin Held1 /\ time[o] < Cutoff)
\* D36: a page carried a hole and it is in the buffer; and the same for a
\* hole below the floor (where a cutoff of the floor alone would drop it)
CoverHoleKept == ~(Done /\ \E h \in HoleIds : h \in pgSeen /\ h \in Held1)
CoverHoleBelowFloor == ~(Done /\ \E h \in HoleIds : h \in pgSeen /\ h \in Held1 /\ time[h] < Floor)
CoverLiveInPage == ~(\E i \in DOMAIN s2c : s2c[i].k = "page" /\ LiveOn /\ LiveId \in {Content(x) : x \in Range(s2c[i].ms)})
=============================================================================
