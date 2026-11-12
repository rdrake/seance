---------------------------- MODULE Edit ----------------------------
(***************************************************************************)
(* Seance's message-edit author rule (evilnet/seance #288, #289 at        *)
(* e07e163).  Decisions: ../DECISIONS.md D37.                              *)
(*                                                                         *)
(* An edit is a resent PRIVMSG tagged +evilnet.github.io/edit (and         *)
(* +seance/edit) = the original's msgid.  It replaces the original only    *)
(* when its sender is the original's author (channel.ts isEditAuthor):     *)
(* when either line carries an account the accounts decide, one account    *)
(* against none is refused, and with none our own lines replace our own    *)
(* and anyone else's only lines of the same nick.  A refused edit is a     *)
(* line of its own.  An edit shown before its original waits for it        *)
(* (Channel.awaitOriginal); the late original then goes behind it and      *)
(* counts for nothing (IrcClient.takeLateEdit / settleLateOriginal).       *)
(*                                                                         *)
(* Standalone, not EXTENDS Delivery: the rule reads lines other people     *)
(* send and shares no variable with Delivery's pending copies; composing   *)
(* them would only multiply the state spaces (D37).                        *)
(*                                                                         *)
(* The server side is a log of lines in server order.  Each line is read   *)
(* live when it is sent, or missed and fetched later by a history page:    *)
(* "append" (a catch-up, deliverAppend: pushMessage with replay) or        *)
(* "more" (an older page, deliverPrepend: settleLateOriginal).             *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
    People,        \* who speaks; a person is identified by nothing the client sees
    Nicks,         \* nicks, already casefolded (the client folds both sides alike)
    Me,            \* the person whose client this is, or "none"
    MaxMsgs,       \* lines sent over the run
    MaxRen,        \* nick changes over the run
    MaxAcc,        \* logins / logouts over the run
    AccountsOn,    \* account-tag: people may be logged in
    Mentions,      \* a line may highlight us (and so count and enter the inbox)
    TrimOn,        \* the UI may drop one loaded line from its buffer (chan.forget); the inbox keeps it
    PageOn         \* missed lines may be fetched by a history page

NoAcc == "none"
\* The nicks at the start: fixed, since the nicks are symmetric (People = {"a", "m"}).
InitNick == [p \in People |-> IF p = "a" THEN "n1" ELSE "n2"]
NoAw == [e |-> 0, by |-> [nick |-> "none", acc |-> NoAcc, self |-> FALSE]]
NoAuth == [nick |-> "none", acc |-> NoAcc, self |-> FALSE]
Ids == 1..MaxMsgs
Modes == {"append", "more"}

\* One switch the mutant DM_LateCounts flips: a line hidden behind its
\* author's edit when it arrives still counts.
HiddenCounts == FALSE

\* channel.ts:61-77 isEditAuthor, under a casemapping already applied.
IsAuthor(au, by) == IF au.acc # NoAcc \/ by.acc # NoAcc THEN au.acc # NoAcc /\ by.acc # NoAcc /\ au.acc = by.acc ELSE IF au.self /\ by.self THEN TRUE ELSE au.nick = by.nick

VARIABLES
    log,         \* server: lines in server order, [p, nick, acc, eo, hl]
    nick,        \* server: person -> current nick
    acct,        \* server: person -> account, or NoAcc
    ren,         \* server: nick changes so far
    accN,        \* server: account changes so far
    missed,      \* server: lines the client did not read live
    inLive,      \* a line just sent, to be read live before anything else happens, or 0
    trims,       \* environment: lines the UI dropped so far
    \* client (Channel + store, as far as the rule reads or writes them)
    shown,       \* ids pushed into the timeline (msgRefs / idByMsgid)
    from,        \* id -> the author record the client keeps (MsgRef.from)
    selfAt,      \* id -> whether the client took it for ours (isSelf at reading)
    ed,          \* id -> the msgid it is shown as an edit of (editOf), or 0
    sup,         \* id -> the edit that replaced it (supersededBy), or 0
    aw,          \* original id -> the edit waiting for it (editsBeforeOriginal), or NoAw
    inbox,       \* ids with an inbox entry (mentions survive a trim)
    \* ghosts
    seen,        \* ids the client has read, live or in a page
    cnt,         \* id -> times it raised the unread count
    hlc,         \* id -> times it raised the highlight count
    late,        \* ids hidden behind their edit as they arrived
    lost         \* <<o, e>>: e hid o's text (timeline replace or inbox drop)

vars == <<log, nick, acct, ren, accN, missed, inLive, trims, shown, from, selfAt, ed, sup, aw, inbox,
          seen, cnt, hlc, late, lost>>
cvars == <<shown, from, selfAt, ed, sup, aw, inbox, seen, cnt, hlc, late, lost>>

Init ==
    /\ log = << >>
    /\ nick = InitNick
    /\ acct \in (IF AccountsOn THEN [People -> {NoAcc} \cup People] ELSE {[p \in People |-> NoAcc]})
    /\ \A p \in People : acct[p] \in {NoAcc, p}
    /\ ren = 0 /\ accN = 0 /\ missed = {} /\ inLive = 0 /\ trims = 0
    /\ shown = {} /\ from = [i \in Ids |-> NoAuth] /\ selfAt = [i \in Ids |-> FALSE]
    /\ ed = [i \in Ids |-> 0] /\ sup = [i \in Ids |-> 0] /\ aw = [i \in Ids |-> NoAw]
    /\ inbox = {} /\ seen = {} /\ cnt = [i \in Ids |-> 0] /\ hlc = [i \in Ids |-> 0]
    /\ late = {} /\ lost = {}

-----------------------------------------------------------------------------
(* The client.  S is a record of the client variables; each step maps one. *)
Now == [sh |-> shown, fr |-> from, sf |-> selfAt, ed |-> ed, sup |-> sup, aw |-> aw,
        ib |-> inbox, sn |-> seen, c |-> cnt, h |-> hlc, lt |-> late, lo |-> lost]
Apply(S) ==
    /\ shown' = S.sh /\ from' = S.fr /\ selfAt' = S.sf /\ ed' = S.ed /\ sup' = S.sup
    /\ aw' = S.aw /\ inbox' = S.ib /\ seen' = S.sn /\ cnt' = S.c /\ hlc' = S.h
    /\ late' = S.lt /\ lost' = S.lo

\* privmsg.ts:85 self = isSelf(nick): the sender's nick against ours *now*.
SelfNow(i) == Me # "none" /\ log[i].nick = nick[Me]
ByOf(i) == [nick |-> log[i].nick, acc |-> log[i].acc, self |-> SelfNow(i)]

\* privmsg.ts:273-284: the edit tag survives unless the original is known
\* (shown, or earlier in the same page) and its author did not send it.
Kept(S, i, page) ==
    LET o == log[i].eo
        known == o \in S.sh \/ o \in page
        orig == IF o \in S.sh THEN S.fr[o] ELSE IF o \in page THEN ByOf(o) ELSE NoAuth
    IN IF o # 0 /\ ~(known /\ ~IsAuthor(orig, ByOf(i))) THEN o ELSE 0

\* client.ts:2809-2818 takeLateEdit: the edit waiting for i, if its author
\* sent it and it is shown; the waiting entry is taken either way.
LateOf(S, i) ==
    LET w == S.aw[i] IN
    IF w # NoAw /\ IsAuthor(ByOf(i), w.by) /\ w.e \in S.sh /\ w.e # i THEN w.e ELSE 0

\* Put i in the timeline (client.ts:3737-3824 pushMessage, or a page row).
\* `count` is the counting rule of the path; `replay` as pushMessage's.
Push(S, i, e, countIt) ==
    LET le == LateOf(S, i)
        hid == le # 0
        cntd == (~hid \/ HiddenCounts) /\ ~SelfNow(i) /\ countIt
        hl == (~hid \/ HiddenCounts) /\ ~SelfNow(i) /\ log[i].hl
    IN [S EXCEPT !.sh = @ \cup {i}, !.sn = @ \cup {i},
                 !.fr = [@ EXCEPT ![i] = ByOf(i)],
                 !.sf = [@ EXCEPT ![i] = SelfNow(i)],
                 !.ed = [@ EXCEPT ![i] = e],
                 !.aw = [@ EXCEPT ![i] = NoAw],
                 !.sup = IF hid THEN [@ EXCEPT ![i] = le] ELSE @,
                 !.lt = IF hid THEN @ \cup {i} ELSE @,
                 !.lo = IF hid THEN @ \cup {<<i, le>>} ELSE @,
                 !.c = IF cntd THEN [@ EXCEPT ![i] = @ + 1] ELSE @,
                 !.h = IF hl THEN [@ EXCEPT ![i] = @ + 1] ELSE @,
                 !.ib = IF ~hid /\ log[i].hl /\ ~SelfNow(i) THEN @ \cup {i} ELSE @]

\* privmsg.ts:322-331 + helpers/inbox.ts:262-276: an edit's sender drops the
\* original's inbox entry when the entry's nick is the sender's nick.
Drop(S, i, e) ==
    IF e # 0 /\ ~SelfNow(i) /\ e \in S.ib /\ log[e].nick = log[i].nick
    THEN [S EXCEPT !.ib = @ \ {e}, !.lo = @ \cup {<<e, i>>}]
    ELSE S

\* privmsg.ts:339-359, the afterReplay closure: replace a shown original if
\* its author sent the edit, else wait for the original.
Place(S, i, e) ==
    IF e = 0 THEN S
    ELSE IF e \in S.sh /\ e # i
         THEN IF IsAuthor(S.fr[e], ByOf(i))
              THEN [S EXCEPT !.sup = [@ EXCEPT ![e] = i], !.lo = @ \cup {<<e, i>>}]
              ELSE S
         ELSE [S EXCEPT !.aw = [@ EXCEPT ![e] = [e |-> i, by |-> ByOf(i)]]]

\* A line read live: privmsg.ts handleMessage, not replaying.
Live(S, i) ==
    LET e == Kept(S, i, {})
        S1 == Drop(S, i, e)
        S2 == Push(S1, i, e, (~SelfNow(i) /\ e = 0) \/ log[i].hl)   \* privmsg.ts:337 + client.ts:3795
    IN Place(S2, i, e)

\* channel.ts:30-35 countsAsUnread.
CountsAsUnread(i, e) == ~SelfNow(i) /\ (e = 0 \/ log[i].hl)

PageSet(seq) == {seq[k] : k \in 1..Len(seq)}
Before(seq, k) == {seq[j] : j \in 1..(k - 1)}

RECURSIVE PushAll(_, _, _, _)
PushAll(S, seq, E, k) ==
    IF k > Len(seq) THEN S
    ELSE PushAll(Push(S, seq[k], E[k], CountsAsUnread(seq[k], E[k])), seq, E, k + 1)

\* deliverPrepend (history.ts:488-552): all rows go in, then
\* settleLateOriginal for each, then countPageUnread skipping the replaced.
RECURSIVE SettleAll(_, _, _)
SettleAll(S, seq, k) ==
    IF k > Len(seq) THEN S
    ELSE LET i == seq[k]
             le == LateOf(S, i)
             S1 == [S EXCEPT !.aw = [@ EXCEPT ![i] = NoAw]]
         IN SettleAll(IF le # 0
                      THEN [S1 EXCEPT !.sup = [@ EXCEPT ![i] = le], !.lt = @ \cup {i},
                                      !.lo = @ \cup {<<i, le>>}]
                      ELSE S1, seq, k + 1)

RECURSIVE CountAll(_, _, _, _)
CountAll(S, seq, E, k) ==
    IF k > Len(seq) THEN S
    ELSE LET i == seq[k]
             go == ~(i \in S.lt) \/ HiddenCounts
             S1 == [S EXCEPT !.c = IF go /\ CountsAsUnread(i, E[k]) THEN [@ EXCEPT ![i] = @ + 1] ELSE @,
                             !.h = IF go /\ ~SelfNow(i) /\ log[i].hl THEN [@ EXCEPT ![i] = @ + 1] ELSE @,
                             !.ib = IF ~(i \in S.lt) /\ ~SelfNow(i) /\ log[i].hl THEN @ \cup {i} ELSE @]
         IN CountAll(S1, seq, E, k + 1)

Prepend(S, seq, E) ==
    LET S0 == [S EXCEPT !.sh = @ \cup PageSet(seq), !.sn = @ \cup PageSet(seq),
                        !.fr = [i \in Ids |-> IF i \in PageSet(seq) THEN ByOf(i) ELSE @[i]],
                        !.sf = [i \in Ids |-> IF i \in PageSet(seq) THEN SelfNow(i) ELSE @[i]],
                        !.ed = [i \in Ids |-> IF \E k \in 1..Len(seq) : seq[k] = i
                                              THEN E[CHOOSE k \in 1..Len(seq) : seq[k] = i] ELSE @[i]]]
    IN CountAll(SettleAll(S0, seq, 1), seq, E, 1)

\* history.ts runAfter: per line, the inbox drop then the placement.
RECURSIVE AfterAll(_, _, _, _)
AfterAll(S, seq, E, k) ==
    IF k > Len(seq) THEN S
    ELSE AfterAll(Place(Drop(S, seq[k], E[k]), seq[k], E[k]), seq, E, k + 1)

\* A history page: collect (each edit judged against the shown lines and
\* the page so far), deliver, then run the queued work.
Page(S, seq, mode) ==
    LET E == [k \in 1..Len(seq) |-> Kept(S, seq[k], Before(seq, k))]
        S1 == IF mode = "append" THEN PushAll(S, seq, E, 1) ELSE Prepend(S, seq, E)
    IN AfterAll(S1, seq, E, 1)

-----------------------------------------------------------------------------
(* The environment.                                                       *)
Orig(i) == log[i].eo = 0

\* p says a line, or edits line o (anyone may tag any original); read live or missed.
Send(p, o, hl, live) ==
    /\ Len(log) < MaxMsgs
    /\ o = 0 \/ (o \in 1..Len(log) /\ Orig(o))
    /\ hl => (Mentions /\ p # Me)
    /\ inLive = 0
    /\ LET i == Len(log) + 1 IN
       /\ log' = Append(log, [p |-> p, nick |-> nick[p], acc |-> acct[p], eo |-> o, hl |-> hl])
       /\ IF live THEN inLive' = i /\ missed' = missed
                   ELSE inLive' = 0 /\ missed' = missed \cup {i}
    /\ UNCHANGED <<nick, acct, ren, accN, trims>> /\ UNCHANGED cvars

\* The client reads the line just sent, before any later line or NICK.
ReadLive ==
    /\ inLive # 0
    /\ Apply(Live(Now, inLive)) /\ inLive' = 0
    /\ UNCHANGED <<log, nick, acct, ren, accN, missed, trims>>

\* A nick change to a free nick; taking a nick someone left is a takeover.
Rename(p, n) ==
    /\ inLive = 0 /\ ren < MaxRen /\ \A q \in People : nick[q] # n
    /\ nick' = [nick EXCEPT ![p] = n] /\ ren' = ren + 1
    /\ UNCHANGED <<log, acct, accN, missed, inLive, trims>> /\ UNCHANGED cvars

\* Log in to one's own account, or out.
Account(p) ==
    /\ inLive = 0 /\ AccountsOn /\ accN < MaxAcc
    /\ acct' = [acct EXCEPT ![p] = IF @ = NoAcc THEN p ELSE NoAcc] /\ accN' = accN + 1
    /\ UNCHANGED <<log, nick, ren, missed, inLive, trims>> /\ UNCHANGED cvars

\* A history page of missed lines, in server order (one or two of them).
Fetch(seq, mode) ==
    /\ inLive = 0 /\ PageOn
    /\ Apply(Page(Now, seq, mode))
    /\ UNCHANGED <<log, nick, acct, ren, accN, missed, inLive, trims>>

\* The UI drops a loaded line from its buffer (chan.forget); its inbox entry stays.
Trim(i) ==
    /\ inLive = 0 /\ TrimOn /\ trims < 1 /\ i \in shown
    /\ shown' = shown \ {i} /\ trims' = trims + 1
    /\ UNCHANGED <<log, nick, acct, ren, accN, missed, inLive>>
    /\ UNCHANGED <<from, selfAt, ed, sup, aw, inbox, seen, cnt, hlc, late, lost>>

Unread(i) == i \in missed /\ i \notin seen
Pages == {<<i>> : i \in Ids} \cup {<<i, j>> : i, j \in Ids}

Next ==
    \/ \E p \in People, o \in 0..MaxMsgs, hl, live \in BOOLEAN : Send(p, o, hl, live)
    \/ ReadLive
    \/ \E p \in People, n \in Nicks : Rename(p, n)
    \/ \E p \in People : Account(p)
    \/ \E seq \in Pages, mode \in Modes :
         /\ \A k \in 1..Len(seq) : Unread(seq[k])
         /\ Len(seq) = 2 => seq[1] < seq[2]
         /\ Fetch(seq, mode)
    \/ \E i \in Ids : Trim(i)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties (D37).                                                       *)
\* The intended rule on what the lines carried when sent; "ours" is the
\* truth (both sent by Me), not the client's isSelf.
Intended(o, e) ==
    IF log[o].acc # NoAcc \/ log[e].acc # NoAcc
    THEN log[o].acc # NoAcc /\ log[o].acc = log[e].acc
    ELSE log[o].nick = log[e].nick \/ (Me # "none" /\ log[o].p = Me /\ log[e].p = Me)

TypeOK ==
    /\ Len(log) <= MaxMsgs /\ shown \subseteq seen /\ seen \subseteq 1..Len(log)
    /\ \A i \in Ids : cnt[i] \in 0..2 /\ hlc[i] \in 0..2

\* (a) Only the author's edit ever replaces a line.
AuthorOnly == \A o \in Ids : sup[o] # 0 => Intended(o, sup[o])

\* (b) An impostor's edit of a line the client shows is a line of its own:
\* not marked as an edit, and counted unread.
ImpostorIsLine ==
    \A e \in shown :
        LET o == log[e].eo IN
        (o # 0 /\ o \in shown /\ ~Intended(o, e) /\ ~selfAt[e]) => (ed[e] = 0 /\ cnt[e] = 1)

\* (c) A message (an original and the edits that replaced it) counts once
\* at most; without mentions, since a highlight in an edit counts by design.
CountOnce == \A o \in Ids : cnt[o] + (IF sup[o] # 0 THEN cnt[sup[o]] ELSE 0) <= 1
\* (c) A late original hidden behind its author's edit counts nothing.
LateSilent == \A o \in late : cnt[o] = 0 /\ hlc[o] = 0

\* (d) The original's text leaves what the user can see (the timeline, the
\* inbox) only for its author's edit.
OriginalKept == \A r \in lost : Intended(r[1], r[2])

\* Further checks (D37): expected to fail, as findings.
\* An author's edit and its original never stand side by side (channel.ts:157-162).
NoSideBySide ==
    \A e \in shown :
        LET o == log[e].eo IN
        (o # 0 /\ o \in shown /\ ed[e] = o /\ Intended(o, e)) => sup[o] # 0
\* The inbox follows the timeline: no entry for an original its author's edit replaced.
InboxFollowsEdit == \A o \in inbox : sup[o] = 0
\* Someone else's message counts at least once (o or the edit that replaced it).
AtLeastOnce ==
    \A o \in seen : (Orig(o) /\ ~selfAt[o])
        => cnt[o] + (IF sup[o] # 0 THEN cnt[sup[o]] ELSE 0) >= 1
\* Strict authorship: only the same person replaces (fails without accounts by design).
SamePerson == \A o \in Ids : sup[o] # 0 => log[o].p = log[sup[o]].p

\* Covers: each must be violated in some config.
CoverNickChangeAccount ==
    ~\E o \in Ids : sup[o] # 0 /\ log[o].nick # log[sup[o]].nick /\ log[o].acc # NoAcc
CoverTakeoverRefused ==
    ~\E e \in shown : LET o == log[e].eo IN
        o # 0 /\ o \in shown /\ log[e].nick = log[o].nick /\ log[e].p # log[o].p /\ ed[e] = 0
CoverLateHidden == late = {}
CoverInboxDrop == ~\E r \in lost : r[1] \notin shown
CoverPageJudged ==
    ~\E e \in shown : LET o == log[e].eo IN o # 0 /\ o \in missed /\ e \in missed /\ ed[e] = 0
CoverImpostorWaits == ~\E o \in Ids : aw[o] # NoAw /\ ~Intended(o, aw[o].e)
=============================================================================
