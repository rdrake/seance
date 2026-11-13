---- MODULE DM_NoSpent_TTrace_1794535107 ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, DM_NoSpent

_expression ==
    LET DM_NoSpent_TEExpression == INSTANCE DM_NoSpent_TEExpression
    IN DM_NoSpent_TEExpression!expression
----

_trace ==
    LET DM_NoSpent_TETrace == INSTANCE DM_NoSpent_TETrace
    IN DM_NoSpent_TETrace!trace
----

_prop ==
    ~<>[](
        pendCmd = ([l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"])
        /\
        compet = ({})
        /\
        crossDeliv = (FALSE)
        /\
        role = ([l1 |-> "none", l2 |-> "resp"])
        /\
        cause = ([l1 |-> "none", l2 |-> "fail"])
        /\
        out = ([l1 |-> <<>>, l2 |-> <<>>])
        /\
        otherDone = (FALSE)
        /\
        firstK = ([l1 |-> "none", l2 |-> "fail"])
        /\
        histSettled = (FALSE)
        /\
        ob = (<<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>)
        /\
        modConf = ({})
        /\
        late = ({})
        /\
        pendTxt = ([l1 |-> "a", l2 |-> "a"])
        /\
        hout = (<<>>)
        /\
        by = ([l1 |-> "none", l2 |-> "own"])
        /\
        early = (FALSE)
        /\
        pend = ([l1 |-> "pending", l2 |-> "failed"])
        /\
        order = (<<"l2", "l1">>)
        /\
        kindCross = (FALSE)
        /\
        labeledN = ([l1 |-> 1, l2 |-> 1])
        /\
        s2c = (<<>>)
        /\
        pendTgt = ([l1 |-> "chan", l2 |-> "chan"])
        /\
        lateUsed = (0)
        /\
        spent = ({})
        /\
        crossTimed = (FALSE)
        /\
        histDone = ("none")
        /\
        sent = (<<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>)
        /\
        buf = (<<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>)
        /\
        owed = ({})
        /\
        nextRef = (5)
        /\
        closed = (FALSE)
        /\
        closeBuf = (FALSE)
    )
----

_init ==
    /\ histSettled = _TETrace[1].histSettled
    /\ pendCmd = _TETrace[1].pendCmd
    /\ cause = _TETrace[1].cause
    /\ histDone = _TETrace[1].histDone
    /\ modConf = _TETrace[1].modConf
    /\ pendTgt = _TETrace[1].pendTgt
    /\ ob = _TETrace[1].ob
    /\ by = _TETrace[1].by
    /\ labeledN = _TETrace[1].labeledN
    /\ out = _TETrace[1].out
    /\ nextRef = _TETrace[1].nextRef
    /\ pend = _TETrace[1].pend
    /\ otherDone = _TETrace[1].otherDone
    /\ crossTimed = _TETrace[1].crossTimed
    /\ kindCross = _TETrace[1].kindCross
    /\ early = _TETrace[1].early
    /\ pendTxt = _TETrace[1].pendTxt
    /\ buf = _TETrace[1].buf
    /\ late = _TETrace[1].late
    /\ compet = _TETrace[1].compet
    /\ sent = _TETrace[1].sent
    /\ crossDeliv = _TETrace[1].crossDeliv
    /\ hout = _TETrace[1].hout
    /\ firstK = _TETrace[1].firstK
    /\ spent = _TETrace[1].spent
    /\ role = _TETrace[1].role
    /\ s2c = _TETrace[1].s2c
    /\ lateUsed = _TETrace[1].lateUsed
    /\ closed = _TETrace[1].closed
    /\ closeBuf = _TETrace[1].closeBuf
    /\ owed = _TETrace[1].owed
    /\ order = _TETrace[1].order
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ histSettled  = _TETrace[i].histSettled
        /\ histSettled' = _TETrace[j].histSettled
        /\ pendCmd  = _TETrace[i].pendCmd
        /\ pendCmd' = _TETrace[j].pendCmd
        /\ cause  = _TETrace[i].cause
        /\ cause' = _TETrace[j].cause
        /\ histDone  = _TETrace[i].histDone
        /\ histDone' = _TETrace[j].histDone
        /\ modConf  = _TETrace[i].modConf
        /\ modConf' = _TETrace[j].modConf
        /\ pendTgt  = _TETrace[i].pendTgt
        /\ pendTgt' = _TETrace[j].pendTgt
        /\ ob  = _TETrace[i].ob
        /\ ob' = _TETrace[j].ob
        /\ by  = _TETrace[i].by
        /\ by' = _TETrace[j].by
        /\ labeledN  = _TETrace[i].labeledN
        /\ labeledN' = _TETrace[j].labeledN
        /\ out  = _TETrace[i].out
        /\ out' = _TETrace[j].out
        /\ nextRef  = _TETrace[i].nextRef
        /\ nextRef' = _TETrace[j].nextRef
        /\ pend  = _TETrace[i].pend
        /\ pend' = _TETrace[j].pend
        /\ otherDone  = _TETrace[i].otherDone
        /\ otherDone' = _TETrace[j].otherDone
        /\ crossTimed  = _TETrace[i].crossTimed
        /\ crossTimed' = _TETrace[j].crossTimed
        /\ kindCross  = _TETrace[i].kindCross
        /\ kindCross' = _TETrace[j].kindCross
        /\ early  = _TETrace[i].early
        /\ early' = _TETrace[j].early
        /\ pendTxt  = _TETrace[i].pendTxt
        /\ pendTxt' = _TETrace[j].pendTxt
        /\ buf  = _TETrace[i].buf
        /\ buf' = _TETrace[j].buf
        /\ late  = _TETrace[i].late
        /\ late' = _TETrace[j].late
        /\ compet  = _TETrace[i].compet
        /\ compet' = _TETrace[j].compet
        /\ sent  = _TETrace[i].sent
        /\ sent' = _TETrace[j].sent
        /\ crossDeliv  = _TETrace[i].crossDeliv
        /\ crossDeliv' = _TETrace[j].crossDeliv
        /\ hout  = _TETrace[i].hout
        /\ hout' = _TETrace[j].hout
        /\ firstK  = _TETrace[i].firstK
        /\ firstK' = _TETrace[j].firstK
        /\ spent  = _TETrace[i].spent
        /\ spent' = _TETrace[j].spent
        /\ role  = _TETrace[i].role
        /\ role' = _TETrace[j].role
        /\ s2c  = _TETrace[i].s2c
        /\ s2c' = _TETrace[j].s2c
        /\ lateUsed  = _TETrace[i].lateUsed
        /\ lateUsed' = _TETrace[j].lateUsed
        /\ closed  = _TETrace[i].closed
        /\ closed' = _TETrace[j].closed
        /\ closeBuf  = _TETrace[i].closeBuf
        /\ closeBuf' = _TETrace[j].closeBuf
        /\ owed  = _TETrace[i].owed
        /\ owed' = _TETrace[j].owed
        /\ order  = _TETrace[i].order
        /\ order' = _TETrace[j].order

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("DM_NoSpent_TTrace_1794535107.json", _TETrace)

=============================================================================

 Note that you can extract this module `DM_NoSpent_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `DM_NoSpent_TEExpression.tla` file takes precedence 
  over the module `DM_NoSpent_TEExpression` below).

---- MODULE DM_NoSpent_TEExpression ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, DM_NoSpent

expression == 
    [
        \* To hide variables of the `DM_NoSpent` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        histSettled |-> histSettled
        ,pendCmd |-> pendCmd
        ,cause |-> cause
        ,histDone |-> histDone
        ,modConf |-> modConf
        ,pendTgt |-> pendTgt
        ,ob |-> ob
        ,by |-> by
        ,labeledN |-> labeledN
        ,out |-> out
        ,nextRef |-> nextRef
        ,pend |-> pend
        ,otherDone |-> otherDone
        ,crossTimed |-> crossTimed
        ,kindCross |-> kindCross
        ,early |-> early
        ,pendTxt |-> pendTxt
        ,buf |-> buf
        ,late |-> late
        ,compet |-> compet
        ,sent |-> sent
        ,crossDeliv |-> crossDeliv
        ,hout |-> hout
        ,firstK |-> firstK
        ,spent |-> spent
        ,role |-> role
        ,s2c |-> s2c
        ,lateUsed |-> lateUsed
        ,closed |-> closed
        ,closeBuf |-> closeBuf
        ,owed |-> owed
        ,order |-> order
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_histSettledUnchanged |-> histSettled = histSettled'
        
        \* Format the `histSettled` variable as Json value.
        \* ,_histSettledJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(histSettled)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_histSettledModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].histSettled # _TETrace[s-1].histSettled
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE DM_NoSpent_TETrace ----
\*EXTENDS IOUtils, TLC, DM_NoSpent
\*
\*trace == IODeserialize("DM_NoSpent_TTrace_1794535107.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE DM_NoSpent_TETrace ----
EXTENDS TLC, DM_NoSpent

trace == 
    <<
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "none"],cause |-> [l1 |-> "none", l2 |-> "none"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "none"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "none"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "pending"],order |-> <<>>,kindCross |-> FALSE,labeledN |-> [l1 |-> 0, l2 |-> 0],s2c |-> <<>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {},nextRef |-> 1,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "none"],cause |-> [l1 |-> "none", l2 |-> "none"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "none"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "none"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "pending"],order |-> <<"l2">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 0, l2 |-> 0],s2c |-> <<>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {"l2"},nextRef |-> 1,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "none"],cause |-> [l1 |-> "none", l2 |-> "none"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "none"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "none"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "pending"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 0, l2 |-> 0],s2c |-> <<>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {"l1", "l2"},nextRef |-> 1,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "none"],cause |-> [l1 |-> "none", l2 |-> "none"],out |-> [l1 |-> <<>>, l2 |-> <<[k |-> "fail", lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l2", role |-> "resp"]>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "none"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "pending"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 0, l2 |-> 0],s2c |-> <<>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {"l1"},nextRef |-> 3,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "none"],cause |-> [l1 |-> "none", l2 |-> "none"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "none"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "pending"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 0, l2 |-> 1],s2c |-> <<[k |-> "fail", lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l2", role |-> "resp"]>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {"l1"},nextRef |-> 3,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "resp"],cause |-> [l1 |-> "none", l2 |-> "fail"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "own"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "failed"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 0, l2 |-> 1],s2c |-> <<>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {"l1"},nextRef |-> 3,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "resp"],cause |-> [l1 |-> "none", l2 |-> "fail"],out |-> [l1 |-> <<[k |-> "note", lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l1", role |-> "resp"], [k |-> "echo", lab |-> "none", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l1", role |-> "unlab"]>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "own"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "failed"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 0, l2 |-> 1],s2c |-> <<>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {},nextRef |-> 5,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "resp"],cause |-> [l1 |-> "none", l2 |-> "fail"],out |-> [l1 |-> <<[k |-> "echo", lab |-> "none", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l1", role |-> "unlab"]>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "own"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "failed"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 1, l2 |-> 1],s2c |-> <<[k |-> "note", lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l1", role |-> "resp"]>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {},nextRef |-> 5,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "resp"],cause |-> [l1 |-> "none", l2 |-> "fail"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "own"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "failed"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 1, l2 |-> 1],s2c |-> <<[k |-> "note", lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l1", role |-> "resp"], [k |-> "echo", lab |-> "none", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l1", role |-> "unlab"]>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {},nextRef |-> 5,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "resp"],cause |-> [l1 |-> "none", l2 |-> "fail"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "own"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "failed"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 1, l2 |-> 1],s2c |-> <<[k |-> "echo", lab |-> "none", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG", id |-> 0, ref |-> 0, bt |-> "none", who |-> "l1", role |-> "unlab"]>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {},nextRef |-> 5,closed |-> FALSE,closeBuf |-> FALSE]),
    ([pendCmd |-> [l1 |-> "PRIVMSG", l2 |-> "PRIVMSG"],compet |-> {},crossDeliv |-> FALSE,role |-> [l1 |-> "none", l2 |-> "resp"],cause |-> [l1 |-> "none", l2 |-> "fail"],out |-> [l1 |-> <<>>, l2 |-> <<>>],otherDone |-> FALSE,firstK |-> [l1 |-> "none", l2 |-> "fail"],histSettled |-> FALSE,ob |-> <<[lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE], [lab |-> "none", on |-> FALSE, root |-> 0, hist |-> FALSE]>>,modConf |-> {},late |-> {},pendTxt |-> [l1 |-> "a", l2 |-> "a"],hout |-> <<>>,by |-> [l1 |-> "none", l2 |-> "own"],early |-> FALSE,pend |-> [l1 |-> "pending", l2 |-> "failed"],order |-> <<"l2", "l1">>,kindCross |-> FALSE,labeledN |-> [l1 |-> 1, l2 |-> 1],s2c |-> <<>>,pendTgt |-> [l1 |-> "chan", l2 |-> "chan"],lateUsed |-> 0,spent |-> {},crossTimed |-> FALSE,histDone |-> "none",sent |-> <<[lab |-> "l2", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"], [lab |-> "l1", txt |-> "a", tgt |-> "chan", cmd |-> "PRIVMSG"]>>,buf |-> <<<<>>, <<>>, <<>>, <<>>, <<>>, <<>>>>,owed |-> {},nextRef |-> 5,closed |-> FALSE,closeBuf |-> FALSE])
    >>
----


=============================================================================

---- CONFIG DM_NoSpent_TTrace_1794535107 ----
CONSTANTS
    Labels = { "l1" , "l2" }
    Texts = { "a" , "b" }
    MaxReq = 2
    Lossy = FALSE
    Deferred = FALSE
    Fallback = TRUE
    ErrFallback = FALSE
    LateErr = FALSE
    OtherSession = FALSE
    SelfMsg = FALSE
    TimeoutOn = FALSE
    MaxLate = 2
    Competing = FALSE
    CloseOn = FALSE
    History = FALSE
    Notice = FALSE
    Modify = FALSE
    SpentLabel = TRUE
    LabelledEchoes = TRUE

PROPERTY
    _prop

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
\* Generated on Fri Nov 13 01:59:01 UTC 2026