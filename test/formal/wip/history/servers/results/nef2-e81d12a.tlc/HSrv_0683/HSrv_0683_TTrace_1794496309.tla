---- MODULE HSrv_0683_TTrace_1794496309 ----
EXTENDS Sequences, TLCExt, HSrv_0683, Toolbox, Naturals, TLC

_expression ==
    LET HSrv_0683_TEExpression == INSTANCE HSrv_0683_TEExpression
    IN HSrv_0683_TEExpression!expression
----

_trace ==
    LET HSrv_0683_TETrace == INSTANCE HSrv_0683_TETrace
    IN HSrv_0683_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        ord = (<<1, 2, 3, 4>>)
        /\
        phase = ("query")
        /\
        pgSeen = ({})
        /\
        s2c = (<<[k |-> "page", ms |-> <<>>, end |-> TRUE, qq |-> [k |-> "before", form |-> "ts", ts |-> 1, sel |-> 0], el |-> {}, so |-> <<1, 2, 3, 4>>]>>)
        /\
        liveSt = (FALSE)
        /\
        why = ("none")
        /\
        got = (0)
        /\
        q = ([k |-> "none", form |-> "none", ts |-> 0, sel |-> 0])
        /\
        buf = (<<>>)
        /\
        pages = (0)
        /\
        ti = (2)
        /\
        liveRel = (FALSE)
        /\
        unkEmpty = (FALSE)
        /\
        anchor = (0)
        /\
        liveSeen = (FALSE)
        /\
        time = (<<1, 2, 2, 3>>)
        /\
        pg1 = ([k |-> "none", ms |-> <<>>, end |-> FALSE, qq |-> [k |-> "none", form |-> "none", ts |-> 0, sel |-> 0], el |-> {}, so |-> <<>>])
    )
----

_init ==
    /\ ord = _TETrace[1].ord
    /\ phase = _TETrace[1].phase
    /\ liveRel = _TETrace[1].liveRel
    /\ pgSeen = _TETrace[1].pgSeen
    /\ unkEmpty = _TETrace[1].unkEmpty
    /\ q = _TETrace[1].q
    /\ why = _TETrace[1].why
    /\ time = _TETrace[1].time
    /\ pages = _TETrace[1].pages
    /\ pg1 = _TETrace[1].pg1
    /\ buf = _TETrace[1].buf
    /\ liveSt = _TETrace[1].liveSt
    /\ ti = _TETrace[1].ti
    /\ got = _TETrace[1].got
    /\ anchor = _TETrace[1].anchor
    /\ liveSeen = _TETrace[1].liveSeen
    /\ s2c = _TETrace[1].s2c
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ ord  = _TETrace[i].ord
        /\ ord' = _TETrace[j].ord
        /\ phase  = _TETrace[i].phase
        /\ phase' = _TETrace[j].phase
        /\ liveRel  = _TETrace[i].liveRel
        /\ liveRel' = _TETrace[j].liveRel
        /\ pgSeen  = _TETrace[i].pgSeen
        /\ pgSeen' = _TETrace[j].pgSeen
        /\ unkEmpty  = _TETrace[i].unkEmpty
        /\ unkEmpty' = _TETrace[j].unkEmpty
        /\ q  = _TETrace[i].q
        /\ q' = _TETrace[j].q
        /\ why  = _TETrace[i].why
        /\ why' = _TETrace[j].why
        /\ time  = _TETrace[i].time
        /\ time' = _TETrace[j].time
        /\ pages  = _TETrace[i].pages
        /\ pages' = _TETrace[j].pages
        /\ pg1  = _TETrace[i].pg1
        /\ pg1' = _TETrace[j].pg1
        /\ buf  = _TETrace[i].buf
        /\ buf' = _TETrace[j].buf
        /\ liveSt  = _TETrace[i].liveSt
        /\ liveSt' = _TETrace[j].liveSt
        /\ ti  = _TETrace[i].ti
        /\ ti' = _TETrace[j].ti
        /\ got  = _TETrace[i].got
        /\ got' = _TETrace[j].got
        /\ anchor  = _TETrace[i].anchor
        /\ anchor' = _TETrace[j].anchor
        /\ liveSeen  = _TETrace[i].liveSeen
        /\ liveSeen' = _TETrace[j].liveSeen
        /\ s2c  = _TETrace[i].s2c
        /\ s2c' = _TETrace[j].s2c

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("HSrv_0683_TTrace_1794496309.json", _TETrace)

=============================================================================

 Note that you can extract this module `HSrv_0683_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `HSrv_0683_TEExpression.tla` file takes precedence 
  over the module `HSrv_0683_TEExpression` below).

---- MODULE HSrv_0683_TEExpression ----
EXTENDS Sequences, TLCExt, HSrv_0683, Toolbox, Naturals, TLC

expression == 
    [
        \* To hide variables of the `HSrv_0683` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        ord |-> ord
        ,phase |-> phase
        ,liveRel |-> liveRel
        ,pgSeen |-> pgSeen
        ,unkEmpty |-> unkEmpty
        ,q |-> q
        ,why |-> why
        ,time |-> time
        ,pages |-> pages
        ,pg1 |-> pg1
        ,buf |-> buf
        ,liveSt |-> liveSt
        ,ti |-> ti
        ,got |-> got
        ,anchor |-> anchor
        ,liveSeen |-> liveSeen
        ,s2c |-> s2c
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_ordUnchanged |-> ord = ord'
        
        \* Format the `ord` variable as Json value.
        \* ,_ordJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(ord)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_ordModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].ord # _TETrace[s-1].ord
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE HSrv_0683_TETrace ----
\*EXTENDS IOUtils, HSrv_0683, TLC
\*
\*trace == IODeserialize("HSrv_0683_TTrace_1794496309.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE HSrv_0683_TETrace ----
EXTENDS HSrv_0683, TLC

trace == 
    <<
    ([ord |-> <<1, 2, 3, 4>>,phase |-> "query",pgSeen |-> {},s2c |-> <<>>,liveSt |-> FALSE,why |-> "none",got |-> 0,q |-> [k |-> "none", form |-> "none", ts |-> 0, sel |-> 0],buf |-> <<>>,pages |-> 0,ti |-> 0,liveRel |-> FALSE,unkEmpty |-> FALSE,anchor |-> 0,liveSeen |-> FALSE,time |-> <<1, 2, 2, 3>>,pg1 |-> [k |-> "none", ms |-> <<>>, end |-> FALSE, qq |-> [k |-> "none", form |-> "none", ts |-> 0, sel |-> 0], el |-> {}, so |-> <<>>]]),
    ([ord |-> <<1, 2, 3, 4>>,phase |-> "query",pgSeen |-> {},s2c |-> <<>>,liveSt |-> FALSE,why |-> "none",got |-> 0,q |-> [k |-> "before", form |-> "ts", ts |-> 1, sel |-> 0],buf |-> <<>>,pages |-> 0,ti |-> 1,liveRel |-> FALSE,unkEmpty |-> FALSE,anchor |-> 0,liveSeen |-> FALSE,time |-> <<1, 2, 2, 3>>,pg1 |-> [k |-> "none", ms |-> <<>>, end |-> FALSE, qq |-> [k |-> "none", form |-> "none", ts |-> 0, sel |-> 0], el |-> {}, so |-> <<>>]]),
    ([ord |-> <<1, 2, 3, 4>>,phase |-> "query",pgSeen |-> {},s2c |-> <<[k |-> "page", ms |-> <<>>, end |-> TRUE, qq |-> [k |-> "before", form |-> "ts", ts |-> 1, sel |-> 0], el |-> {}, so |-> <<1, 2, 3, 4>>]>>,liveSt |-> FALSE,why |-> "none",got |-> 0,q |-> [k |-> "none", form |-> "none", ts |-> 0, sel |-> 0],buf |-> <<>>,pages |-> 0,ti |-> 2,liveRel |-> FALSE,unkEmpty |-> FALSE,anchor |-> 0,liveSeen |-> FALSE,time |-> <<1, 2, 2, 3>>,pg1 |-> [k |-> "none", ms |-> <<>>, end |-> FALSE, qq |-> [k |-> "none", form |-> "none", ts |-> 0, sel |-> 0], el |-> {}, so |-> <<>>]])
    >>
----


=============================================================================

---- CONFIG HSrv_0683_TTrace_1794496309 ----
CONSTANTS
    Mode = "join"
    MayFail = TRUE
    NOld = 0
    NHeld = 0
    Holes = { }
    Skew = 0
    NGap = 4
    LiveOn = FALSE
    Times <- TimesV
    Fuzz = 0
    Limit = 2
    BudgetKind = "pages"
    BudgetN = 1
    ExactCount = TRUE
    Contiguous = TRUE
    TimeOrdered = TRUE
    BatchAgrees = TRUE
    StableAcrossReconnect = FALSE
    SendsEnd = TRUE
    Dedupe = TRUE
    MsgidAnchor = TRUE
    StopOnHeld = FALSE
    InsertMerge = TRUE

INVARIANT
    _inv

CHECK_DEADLOCK
    \* CHECK_DEADLOCK off because of PROPERTY or INVARIANT above.
    FALSE

INIT
    _init

NEXT
    _next

CONSTANT
    _TETrace <- _trace

ALIAS
    _expression
=============================================================================
\* Generated on Thu Nov 12 15:11:50 UTC 2026