---------------------------- MODULE MU_RelayAll ----------------------------
(***************************************************************************)
(* Web push across one account's devices: message pushes, read relays and *)
(* the notifications each device shows.  v0.                               *)
(*                                                                         *)
(* One account on one network.  Each device has at most one subscription. *)
(* Messages arrive in conversations; the server pushes a message only when *)
(* no device attends (nefarious2's attention gate); a device that reads a  *)
(* conversation moves the server's read marker, and the server may relay   *)
(* the read to subscriptions so they close what they show.  The push       *)
(* service is unordered and lossy.  A device's worker turns each push into *)
(* notifications ("cards"); a strict device (WebKit) must show something   *)
(* for every push or count a silent push (three revoke every              *)
(* subscription of the origin).                                            *)
(*                                                                         *)
(* The server's choices are constants, so one model covers nefarious2 as  *)
(* it is (RelayTo = "all", OutPer = "account", StrictRelay = "send") and  *)
(* the candidate rules of ../PRIOR-ART.md section 3:                       *)
(*   R1 RelayTo = "others"     no relay to the reader's own subscription   *)
(*   R2 OutPer = "sub"         relay only where a message push went        *)
(*   R3 StrictRelay = "skip"   no relays to strict (WebKit) subscriptions  *)
(*   R5 Open                   the app's sweep when it opens (exists)     *)
(*   R10                       a relay closes only what its marker covers *)
(* Rules: ../RULES.md.  Readings: ../DECISIONS.md.                         *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Dev,          \* the account's devices
    Strict,       \* those under WebKit's every-push-must-show rule
    Conv,         \* conversations
    MaxMsg,       \* messages in a behaviour
    InitSubbed,   \* devices subscribed at the start; the rest may subscribe later
    Lossy,        \* whether the push service may lose a push
    Identity,     \* how the server knows the reader: "conn" (the connection that
                  \* registered the subscription) | "device" (an id the client sends)
    MergeTime,    \* the time a merged card carries: "last" (Seance today: the
                  \* push that arrived last) | "newest" (its newest message)
    RelayTo,      \* "all" (nefarious2 today) | "others" (R1)
    OutPer,       \* "account" (nefarious2 today) | "sub" (R2)
    StrictRelay   \* "send" (today) | "skip" (R3)

ASSUME /\ Strict \subseteq Dev /\ InitSubbed \subseteq Dev
       /\ MaxMsg \in Nat \ {0}
       /\ Lossy \in BOOLEAN
       /\ Identity \in {"conn", "device"}
       /\ MergeTime \in {"last", "newest"}
       /\ RelayTo \in {"all", "others"}
       /\ OutPer \in {"account", "sub"}
       /\ StrictRelay \in {"send", "skip"}

None == "none"     \* a quiet stub: shown for a message already read
Local == "local"   \* Chrome's own answer to a Mark read tapped on it
Times == 0..MaxMsg               \* a message's number is its time; 0 = before any

MsgPush  == [k : {"msg"}, c : Conv, n : 1..MaxMsg]
\* `by`: who really read (for the rules); the server's view of it is `Who`.
ReadPush == [k : {"read"}, c : Conv, n : Times, by : Dev]
Push == MsgPush \cup ReadPush

\* A card is a visible notification.  A message card merges every message
\* pushed to its conversation's tag: `top` is the newest of them, `n` the
\* time the card carries (data.time), which closes and Mark read compare.
\* `seen`: what the device knew was read in the conversation when it showed
\* the card.  A stub says nothing is unread and carries no time (n = 0, so
\* any relay for its conversation closes it): "Marked as read" after a relay
\* (`by` the reader), the quiet show for a message already read (`by` None),
\* or Chrome's answer to a Mark read tapped on it (`by` Local).
MsgCard  == [k : {"msg"}, c : Conv, n : 1..MaxMsg, top : 1..MaxMsg, seen : Times]
StubCard == [k : {"stub"}, c : Conv, n : {0}, by : Dev \cup {None, Local}]
Card == MsgCard \cup StubCard

VARIABLES
    log,      \* log[i]: the conversation message i arrived in
    marker,   \* the server's read marker per conversation (only ever rises)
    subbed,   \* devices with a live subscription
    open,     \* devices whose app is open (attending)
    outA,     \* nefarious2's outstanding flag per conversation (account-wide)
    outS,     \* per subscription: a message push for c went here since the last relay here
    chan,     \* pushes in flight to each device: unordered, lossy
    cards,    \* what each device shows
    known,    \* each device's own idea of the read marker
    silent,   \* WebKit's silent-push count per device (never reset)
    got,      \* ghost: the messages ever pushed to each device
    step      \* the last step's name, for the action properties

vars == <<log, marker, subbed, open, outA, outS, chan, cards, known, silent, got, step>>

Max(a, b) == IF a >= b THEN a ELSE b

\* The newest message in c, 0 when none.
Latest(c) == LET ns == {i \in 1..Len(log) : log[i] = c}
             IN IF ns = {} THEN 0 ELSE CHOOSE i \in ns : \A j \in ns : j <= i

TypeOK ==
    /\ log \in Seq(Conv) /\ Len(log) <= MaxMsg
    /\ marker \in [Conv -> Times]
    /\ subbed \subseteq Dev /\ open \subseteq Dev
    /\ outA \in [Conv -> BOOLEAN]
    /\ outS \in [Dev -> [Conv -> BOOLEAN]]
    /\ chan \in [Dev -> SUBSET Push]
    /\ cards \in [Dev -> SUBSET Card]
    /\ known \in [Dev -> [Conv -> Times]]
    /\ silent \in [Dev -> Nat]
    /\ got \in [Dev -> SUBSET (1..MaxMsg)]
    /\ step \in STRING

Init ==
    /\ log = <<>>
    /\ marker = [c \in Conv |-> 0]
    /\ subbed = InitSubbed
    /\ open = {}
    /\ outA = [c \in Conv |-> FALSE]
    /\ outS = [d \in Dev |-> [c \in Conv |-> FALSE]]
    /\ chan = [d \in Dev |-> {}]
    /\ cards = [d \in Dev |-> {}]
    /\ known = [d \in Dev |-> [c \in Conv |-> 0]]
    /\ silent = [d \in Dev |-> 0]
    /\ got = [d \in Dev |-> {}]
    /\ step = "init"

-----------------------------------------------------------------------------
(* The server *)

\* A message arrives.  Pushed to every subscription when nobody attends.
Arrive(c) ==
    /\ Len(log) < MaxMsg
    /\ LET n == Len(log) + 1
           p == [k |-> "msg", c |-> c, n |-> n]
       IN /\ log' = Append(log, c)
          /\ IF open = {}
             THEN /\ chan' = [d \in Dev |-> IF d \in subbed THEN chan[d] \cup {p} ELSE chan[d]]
                  /\ outA' = [outA EXCEPT ![c] = TRUE]
                  /\ outS' = [d \in Dev |-> IF d \in subbed
                                            THEN [outS[d] EXCEPT ![c] = TRUE] ELSE outS[d]]
                  /\ got' = [d \in Dev |-> IF d \in subbed THEN got[d] \cup {n} ELSE got[d]]
             ELSE UNCHANGED <<chan, outA, outS, got>>
    /\ step' = "arrive"
    /\ UNCHANGED <<marker, subbed, open, cards, known, silent>>

\* Who the server can tell read: the page's connection registered the
\* device's subscription; the worker's Mark read goes over a throwaway
\* connection that registers nothing, so only a device id names it.
Who(d, via) == IF via = "page" \/ Identity = "device" THEN d ELSE None

\* Where a read by `w` (the server's view) in `c` is relayed.
Gate(c) == OutPer = "sub" \/ outA[c]
Targets(w, c) ==
    {e \in subbed : /\ TRUE
                    /\ (StrictRelay = "skip" => e \notin Strict)
                    /\ (OutPer = "sub" => outS[e][c])}

\* `d` reads `c` up to `n`, leaving `after` on its screen; the server raises
\* the marker and relays the read.  `via`: the connection the MARKREAD
\* went over.
ReadAt(d, c, n, via, after) ==
    /\ n > known[d][c]
    /\ marker' = [marker EXCEPT ![c] = Max(@, n)]
    /\ known' = [known EXCEPT ![d][c] = n]
    /\ cards' = [cards EXCEPT ![d] = after]
    /\ IF n > marker[c] /\ Gate(c)
       THEN LET T == Targets(Who(d, via), c)
                r == [k |-> "read", c |-> c, n |-> n, by |-> d]
            IN /\ chan' = [e \in Dev |-> IF e \in T THEN chan[e] \cup {r} ELSE chan[e]]
               /\ outA' = [outA EXCEPT ![c] = FALSE]
               /\ outS' = [e \in Dev |-> IF e \in T \cup {d}
                                         THEN [outS[e] EXCEPT ![c] = FALSE] ELSE outS[e]]
       ELSE /\ outS' = [outS EXCEPT ![d][c] = FALSE]
            /\ UNCHANGED <<chan, outA>>
    /\ step' = "read"
    /\ UNCHANGED <<log, subbed, open, silent, got>>

\* On the open page, up to the newest message; the page closes its cards
\* for c up to there.
ReadOnPage(d, c) ==
    /\ d \in open
    /\ ReadAt(d, c, Latest(c), "page",
              {x \in cards[d] : ~(x.c = c /\ x.n <= Latest(c))})

\* Mark read on a card (handleMarkRead): the marker at the time the card
\* carries, sent through the open page when there is one (viaPage), else
\* over a throwaway connection (swMarkRead).  Locally (markedReadHere): on
\* WebKit the tapped card goes; on Chrome every card of the conversation
\* goes, and when that would leave nothing up, "Marked as read" answers the
\* tap in its place.
ReadFromCard(d, x) ==
    LET rest == {y \in cards[d] : y.c # x.c}
        after == IF d \in Strict THEN cards[d] \ {x}
                 ELSE IF rest = {} THEN {[k |-> "stub", c |-> x.c, n |-> 0, by |-> Local]}
                 ELSE rest
    IN /\ x \in cards[d] /\ x.k = "msg"
       /\ ReadAt(d, x.c, x.n, IF d \in open THEN "page" ELSE "worker", after)

\* A device subscribes (late): it has had none of the earlier pushes.
Subscribe(d) ==
    /\ d \notin subbed
    /\ subbed' = subbed \cup {d}
    /\ step' = "subscribe"
    /\ UNCHANGED <<log, marker, open, outA, outS, chan, cards, known, silent, got>>

-----------------------------------------------------------------------------
(* The devices *)

\* The app opens: it learns the markers and its sweep closes every card at
\* or below them, and every stub (R5).
Open(d) ==
    /\ d \notin open
    /\ open' = open \cup {d}
    /\ known' = [known EXCEPT ![d] = [c \in Conv |-> Max(@[c], marker[c])]]
    /\ cards' = [cards EXCEPT ![d] = {x \in @ : x.k = "msg" /\ x.n > marker[x.c]}]
    /\ step' = "open"
    /\ UNCHANGED <<log, marker, subbed, outA, outS, chan, silent, got>>

Leave(d) ==
    /\ d \in open
    /\ open' = open \ {d}
    /\ step' = "leave"
    /\ UNCHANGED <<log, marker, subbed, outA, outS, chan, cards, known, silent, got>>

\* The worker handles one push: the cards after it, and whether it showed
\* anything (WebKit counts a push that showed nothing as silent).  A card
\* shown under a conversation's tag takes the place of what that tag showed.
Show(d, x) == {y \in cards[d] : y.c # x.c} \cup {x}

\* A message push.  Already read here: no fresh card.  A strict device must
\* still show: the conversation's message card again, quietly and unchanged,
\* or the quiet stub when none is up (showQuiet); a lax one shows the stub
\* only when nothing else would be up (keepChromeCount).
OnMsg(d, p) ==
    IF p.n <= known[d][p.c]
    THEN IF d \in Strict /\ \E y \in cards[d] : y.k = "msg" /\ y.c = p.c
         THEN [after |-> cards[d], shown |-> TRUE]
         ELSE IF d \in Strict \/ (cards[d] = {} /\ d \notin open)
         THEN [after |-> Show(d, [k |-> "stub", c |-> p.c, n |-> 0, by |-> None]),
               shown |-> TRUE]
         ELSE [after |-> cards[d], shown |-> FALSE]
    ELSE LET prev == {y \in cards[d] : y.k = "msg" /\ y.c = p.c}
             top  == IF prev = {} THEN p.n
                     ELSE Max(p.n, (CHOOSE y \in prev : TRUE).top)
         IN [after |-> Show(d, [k |-> "msg", c |-> p.c,
                                n |-> IF MergeTime = "newest" THEN top ELSE p.n,
                                top |-> top, seen |-> known[d][p.c]]),
             shown |-> TRUE]

\* A read relay: close what its marker covers.  A strict device then shows
\* "Marked as read" beside what is left (under a tag of its own, which the
\* conversation's next card replaces), whatever it closed; a lax one only
\* when it would otherwise be left showing nothing.
OnRead(d, p) ==
    LET left == {y \in cards[d] : ~(y.c = p.c /\ y.n <= p.n)}
        stub == [k |-> "stub", c |-> p.c, n |-> 0, by |-> p.by]
    IN IF d \in Strict \/ (left = {} /\ d \notin open)
       THEN [after |-> left \cup {stub}, shown |-> TRUE]
       ELSE [after |-> left, shown |-> FALSE]

Handle(d, p) == IF p.k = "msg" THEN OnMsg(d, p) ELSE OnRead(d, p)

Deliver(d, p) ==
    /\ p \in chan[d]
    /\ chan' = [chan EXCEPT ![d] = @ \ {p}]
    /\ cards' = [cards EXCEPT ![d] = Handle(d, p).after]
    /\ silent' = IF d \in Strict /\ ~Handle(d, p).shown
                 THEN [silent EXCEPT ![d] = @ + 1] ELSE silent
    /\ known' = IF p.k = "read" THEN [known EXCEPT ![d][p.c] = Max(@, p.n)] ELSE known
    /\ step' = "deliver"
    /\ UNCHANGED <<log, marker, subbed, open, outA, outS, got>>

\* The push service loses a push (TTL, an endpoint gone).
Drop(d, p) ==
    /\ Lossy
    /\ p \in chan[d]
    /\ chan' = [chan EXCEPT ![d] = @ \ {p}]
    /\ step' = "drop"
    /\ UNCHANGED <<log, marker, subbed, open, outA, outS, cards, known, silent, got>>

\* The worker closes a stub once it may; the user swipes a card away.
Close(d, x) ==
    /\ x \in cards[d]
    /\ cards' = [cards EXCEPT ![d] = @ \ {x}]
    /\ step' = IF x.k = "stub" THEN "stubgone" ELSE "dismiss"
    /\ UNCHANGED <<log, marker, subbed, open, outA, outS, chan, known, silent, got>>

Next ==
    \/ \E c \in Conv : Arrive(c)
    \/ \E d \in Dev, c \in Conv : ReadOnPage(d, c)
    \/ \E d \in Dev : \E x \in cards[d] : ReadFromCard(d, x)
    \/ \E d \in Dev : Subscribe(d) \/ Open(d) \/ Leave(d)
    \/ \E d \in Dev : \E p \in chan[d] : Deliver(d, p) \/ Drop(d, p)
    \/ \E d \in Dev : \E x \in cards[d] : Close(d, x)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Rules (../RULES.md).  State invariants first. *)

\* R1 (server): no relay ever heads for the reader's own subscription.
RuleNoSelfRelay == \A d \in Dev : \A p \in chan[d] : p.k = "read" => p.by # d

\* The complaint: a device never shows "Marked as read" for its own read.
RuleNoOwnReadStub == \A d \in Dev : \A x \in cards[d] : x.k = "stub" => x.by # d

\* WebKit: three silent pushes revoke every subscription of the origin.
RuleNeverRevoked == \A d \in Strict : silent[d] < 3

\* No alerting card for a message the device knew was read.
RuleNoAlertForRead == \A d \in Dev : \A x \in cards[d] : x.k = "msg" => x.n > x.seen

\* Action properties.

\* R10: a delivered push or the opening app's sweep closes a message card
\* only when what the device knows is read covers every message in it, or a
\* card of its conversation that holds them takes its place.
RuleCloseOnlyRead ==
    [][step' \in {"deliver", "open"} =>
        \A d \in Dev : \A x \in cards[d] \ cards'[d] :
            x.k = "msg" => \/ x.top <= known'[d][x.c]
                           \/ \E y \in cards'[d] : y.c = x.c /\ y.k = "msg" /\ y.top >= x.top]_vars

\* R2 (server): a relay goes only where a message push for its conversation
\* went since the last relay there.
RuleRelayWherePushed ==
    [][\A e \in Dev : \A p \in chan'[e] \ chan[e] : p.k = "read" => outS[e][p.c]]_vars

\* R5: once the app has opened, it shows no card whose messages are all read.
RuleOpenClean ==
    [][step' = "open" =>
        \A d \in open' \ open : \A x \in cards'[d] : x.k = "msg" /\ x.top > marker[x.c]]_vars

-----------------------------------------------------------------------------
(* Witnesses: each is expected to be violated (reachable). *)

\* Richard's report: the reading device shows "Marked as read" for its own read.
W_OwnReadStub == ~\E d \in Strict : \E x \in cards[d] : x.k = "stub" /\ x.by = d
\* A read on another device puts "Marked as read" on a strict device.
W_OtherReadStub == ~\E d \in Strict : \E x \in cards[d] : x.k = "stub" /\ x.by \notin {d, None}
\* A card stays up on a closed device after another device read everything
\* in it, with no relay on its way that would close it.
W_StaleCard ==
    ~\E d \in Dev \ open : \E x \in cards[d] :
        /\ x.k = "msg"
        /\ \E e \in Dev \ {d} : known[e][x.c] >= x.top
        /\ ~\E p \in chan[d] : p.k = "read" /\ p.c = x.c /\ p.n >= x.n
\* A relay heads for a device that was never pushed a message of its conversation.
W_RelayNoCard ==
    ~\E d \in Dev : \E p \in chan[d] : p.k = "read" /\ ~\E i \in got[d] : log[i] = p.c
\* A relay is on its way that will close a card holding a message newer
\* than its marker (if nothing replaces the card first).
W_ClosedUnread ==
    ~\E d \in Dev : \E p \in chan[d] :
        /\ p.k = "read"
        /\ \E x \in cards[d] : x.k = "msg" /\ x.c = p.c /\ x.n <= p.n /\ x.top > p.n
=============================================================================
