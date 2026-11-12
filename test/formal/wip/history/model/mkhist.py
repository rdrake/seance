#!/usr/bin/env python3
"""Write History.tla's configs, mutants and list-h1 (v1, D26; NOld, D35).  Run from model/.

Each witness is the positive config Tiny with the named changes; its comment
says why it is reachable (DESIGN.md).  Mutants: History.tla with one anchor
replaced (the anchor must occur exactly once).
"""
BASE = dict(Mode='"reconnect"', MayFail="FALSE", NOld=0, NHeld=1, NGap=2, LiveOn="TRUE", Times="{1, 3}", Fuzz=0, Limit=1,
            BudgetKind='"pages"', BudgetN=5, ExactCount="TRUE", Contiguous="TRUE",
            TimeOrdered="TRUE", BatchAgrees="TRUE", StableAcrossReconnect="FALSE",
            SendsEnd="TRUE", Dedupe="TRUE", MsgidAnchor="TRUE", StopOnHeld="FALSE",
            InsertMerge="TRUE")
SAFE = ("TypeOK NoLoss NoDup ContentOnce ReplayIdStable Order HeldOrder PageEligible EndTruthful"
        " EndNext UnknownEmpty JoinRecovers MoreRecovers")
JOIN = dict(Mode='"join"', NHeld=0, NGap=3, Limit=2)
MORE = dict(Mode='"more"', NHeld=2, NGap=3, Limit=2, StableAcrossReconnect="TRUE")
# D35, the belowHeld fixture's shape: one line stored before everything held,
# one LATEST page holding all of it, and Seance's appending reconnect client
BELOW = dict(NOld=1, NGap=1, LiveOn="FALSE", Limit=3, InsertMerge="FALSE")
CFGS = {
  # positives
  "HTiny": ({}, SAFE, "Terminates", "pass"),
  "HTiny2": (dict(NHeld=2, Limit=2), SAFE, "Terminates", "pass"),
  "HHeldStop": (dict(NHeld=2, NGap=2, StopOnHeld="TRUE", StableAcrossReconnect="TRUE"), SAFE, "Terminates", "pass"),
  "HMsgs": (dict(BudgetKind='"msgs"', BudgetN=4), SAFE, "Terminates", "pass"),
  # witnesses: each breaks NoLoss, NoDup or Order with one switch flipped
  "W_EmptyPage": (dict(ExactCount="FALSE"), "NoLoss", None, "fail"),
  "W_TimeOrdered": (dict(NHeld=2, NGap=1, TimeOrdered="FALSE"), "NoLoss", None, "fail"),
  "W_D7Reorder": (dict(NHeld=2, NGap=2, Limit=2, StopOnHeld="TRUE"), "NoLoss", None, "fail"),
  "W_TsTie": (dict(MsgidAnchor="FALSE"), "NoLoss", None, "fail"),
  "W_Budget": (dict(NGap=3, Limit=1, BudgetN=2, LiveOn="FALSE"), "NoLoss", None, "fail"),
  "W_Holes": (dict(Contiguous="FALSE", Limit=2), "NoLoss", None, "fail"),
  # v0 finding: with msgid anchors, Contiguous and ExactCount, a batch in another
  # order costs pages but skips nothing; with pages(5) that loses nothing here.
  # W_BatchBudget pairs it: with pages(2) the wasted pages lose a gap message.
  "HNoBatchAgrees": (dict(BatchAgrees="FALSE", Limit=2, NGap=3), SAFE, "Terminates", "pass"),
  # the same budget with batches in order recovers everything (the pair's positive)
  # (v0.2 run: without Stable, a reconnect may order a gap message before the
  # held one at a time tie, and pages(2) then misses it; the pair pins Stable)
  "HBatchAgreesBudget": (dict(Limit=2, NGap=3, BudgetN=2, StableAcrossReconnect="TRUE"), SAFE, "Terminates", "pass"),
  "W_BatchBudget": (dict(BatchAgrees="FALSE", Limit=2, NGap=3, BudgetN=2, StableAcrossReconnect="TRUE"), "NoLoss", None, "fail"),
  # the live message relayed and also replayed in a page, held twice
  "W_NoDedupe": (dict(Dedupe="FALSE"), "NoDupLive", None, "fail"),
  # an append client puts older history after newer held or received messages
  # (DESIGN's live-at-time-1 story cannot occur: store times are non-decreasing)
  "W_Append": (dict(InsertMerge="FALSE"), "Order", None, "fail"),
  "HFuzz": (dict(Fuzz=1, NHeld=2), SAFE, "Terminates", "pass"),
  # covers on the positive configs (each must be violated)
  "CoverDone": ({}, "CoverDone", None, "fail"),
  "CoverMultiPage": ({}, "CoverMultiPage", None, "fail"),
  # the floor stop needs a held message older than the newest held one
  "CoverFloor": (dict(NHeld=2), "CoverFloor", None, "fail"),
  "CoverEmpty": ({}, "CoverEmpty", None, "fail"),
  "CoverEnd": ({}, "CoverEnd", None, "fail"),
  "CoverLiveInPage": ({}, "CoverLiveInPage", None, "fail"),
  "CoverLiveBoth": ({}, "CoverLiveBoth", None, "fail"),
  "CoverBudget": (dict(BudgetN=1), "CoverBudget", None, "fail"),
  # ---- v1 (D26) ----
  # FAIL ends a reconnect catch-up unrecovered; NoLoss excludes it
  "HFail": (dict(MayFail="TRUE"), SAFE, "Terminates", "pass"),
  "W_FailLoss": (dict(MayFail="TRUE"), "NoLossEvenOnFail", None, "fail"),
  "CoverFail": (dict(MayFail="TRUE"), "CoverFail", None, "fail"),
  # first JOIN: LATEST * Limit on an empty buffer
  "HJoin": (JOIN, SAFE, "Terminates", "pass"),
  "HJoinFail": (dict(JOIN, MayFail="TRUE"), SAFE, "Terminates", "pass"),
  "W_JoinHoles": (dict(JOIN, Contiguous="FALSE"), "JoinRecovers", None, "fail"),
  "CoverJoinDone": (JOIN, "CoverJoinDone", None, "fail"),
  # "more": BEFORE <oldest held> Limit
  "HMore": (MORE, SAFE, "Terminates", "pass"),
  "W_MoreHoles": (dict(MORE, Contiguous="FALSE"), "MoreRecovers", None, "fail"),
  # a timestamp selector excludes an older message tied with the oldest held
  "W_MoreTsTie": (dict(MORE, MsgidAnchor="FALSE"), "MoreRecovers", None, "fail"),
  "CoverMoreDone": (MORE, "CoverMoreDone", None, "fail"),
  # HISTORY-REVIEW-4: FAIL in each one-page mode, with its own covers
  "HMoreFail": (dict(MORE, MayFail="TRUE"), SAFE, "Terminates", "pass"),
  "CoverFail_HJoinFail": (dict(JOIN, MayFail="TRUE"), "CoverFail", None, "fail"),
  "CoverFail_HMoreFail": (dict(MORE, MayFail="TRUE"), "CoverFail", None, "fail"),
  "CoverJoinDone_HJoinFail": (dict(JOIN, MayFail="TRUE"), "CoverJoinDone", None, "fail"),
  "CoverMoreDone_HMoreFail": (dict(MORE, MayFail="TRUE"), "CoverMoreDone", None, "fail"),
  # D25's last bullet, named: without Stable, a reconnect tie puts a gap
  # message before the held one and pages(2) misses it
  "W_TieReconnect": (dict(Limit=2, NGap=3, BudgetN=2), "NoLoss", None, "fail"),
  # the reversed-batch regression: a page that reaches the oldest message with
  # its batch reversed is reachable (HS_EndLast must then tag it falsely)
  "CoverEndReversed": (dict(BatchAgrees="FALSE", Limit=2, NGap=3), "CoverEndReversed", None, "fail"),
  "CoverHeldStop": (dict(NHeld=2, NGap=2, StopOnHeld="TRUE", StableAcrossReconnect="TRUE"), "CoverHeldStop", None, "fail"),
  # ---- D35: NOld, lines stored before everything held ----
  "HOld": (dict(NOld=1), SAFE, "Terminates", "pass"),
  "HOld2": (dict(NOld=1, NHeld=2, Limit=2), SAFE, "Terminates", "pass"),
  # Times {1, 2, 3}: with {1, 3} a Fuzz of 1 decides no stop and drops nothing
  # differently from Fuzz 0 (HOld2 and HOldFuzz then have the same state count)
  "HOldFuzz": (dict(NOld=1, NHeld=2, Limit=2, Fuzz=1, Times="{1, 2, 3}"), SAFE, "Terminates", "pass"),
  # first run of HOldFuzz at Limit 1: every time tied, so Fuzz puts the floor
  # at 0 and no page stops the walk; without Stable a gap line is ordered
  # before the old one, and six lines at one per page outrun pages(5).  The
  # D25 tie-and-budget story (W_TieReconnect), with the old line as the extra
  "W_OldTieBudget": (dict(NOld=1, NHeld=2, Fuzz=1), "NoLoss", None, "fail"),
  "HBelowHeld": (BELOW, SAFE, "Terminates", "pass"),
  # Seance's own stop (a held msgid on the page) with an old line in the store
  "HOldHeldStop": (dict(NOld=1, NHeld=2, NGap=2, StopOnHeld="TRUE", StableAcrossReconnect="TRUE"), SAFE, "Terminates", "pass"),
  # a page reaches below everything held and a line is dropped
  "CoverOldDropped": (dict(NOld=1), "CoverOldDropped", None, "fail"),
  "CoverOldDropped_HBelowHeld": (BELOW, "CoverOldDropped", None, "fail"),
  # the cutoff is min(floor, oldest held): with one held line the FUZZ window
  # lies below it, so an old line inside the window is kept and an appending
  # client puts it after the held line (no skew in the model, so it is old)
  "W_FuzzBelow": (dict(BELOW, Fuzz=1, Times="{1, 2}"), "HeldOrder", None, "fail"),
}
KEEP = ('Placed(m) == ~(Mode = "reconnect" /\\ NHeld > 0 /\\ T(m) < Cutoff)', 'Placed(m) == TRUE')
MINT = ('Replay(c) == c ', 'Replay(c) == c + N ')
MUTS = {
  # CH-18: the server mints a new msgid on replay; a deduping client then
  # holds the same content twice
  "HS_NewId": ([MINT], "HTiny", "ContentOnce"),
  "HS_NewIdR": ([MINT], "HTiny", "ReplayIdStable"),
  # D26: a minted replay id becomes the next BEFORE selector, which is unknown
  # to the server, so the loop stops on an empty page and loses the gap
  "HS_NewIdAnchor": ([MINT], "HTiny", "NoLoss"),
  "HS_NewIdUnknown": ([MINT], "HTiny", "CoverUnknownSel"),
  # HISTORY-REVIEW-4: the chain in one state (unknown BEFORE, empty page, loss)
  "HS_NewIdChain": ([MINT], "HTiny", "CoverUnknownLoss"),
  # an unknown msgid answered as if it were LATEST (MI-5 says nothing)
  "HS_UnknownLatest": ([MINT, ('IF qq.sel \\in Range(o) THEN {o[i] : i \\in 1..(Pos(o, qq.sel) - 1)} ELSE {}',
                               'IF qq.sel \\in Range(o) THEN {o[i] : i \\in 1..(Pos(o, qq.sel) - 1)} ELSE Range(o)')],
                       "HTiny", "UnknownEmpty"),
  # the end regressions, checked by EndNext (not EndOK): the last element of a
  # reversed batch, and a tagged empty page while messages remain
  "HS_EndLast": ([('ELSE Pos(o, p[1]) = 1', 'ELSE Pos(o, p[Len(p)]) = 1')], "HNoBatchAgrees", "EndNext"),
  "HS_EndEmpty": ([('IF p = << >> THEN E = {}', 'IF p = << >> THEN TRUE')], "W_EmptyPage", "EndNext"),
  # "more" anchored at the newest held message instead of the oldest
  "HC_MoreNewest": ([('FirstAnchor == NGap + 1 ', 'FirstAnchor == NStored ')], "HMore", "MoreRecovers"),
  # server puts the anchor itself in a BEFORE page (CH:83 excludes it)
  "HS_Anchor": ([('    /\\ LET E == Elig(q, ord)\n', '    /\\ LET E == Elig(q, ord) \\cup (IF q.form = "msgid" THEN {q.sel} ELSE {})\n')], "HTiny", "PageEligible"),
  # server tags chathistory-end whatever remains (D9)
  "HS_FalseEnd": ([('(IF SendsEnd /\\ EndOK(E, p, ord) THEN BOOLEAN ELSE {FALSE})', '(IF SendsEnd THEN BOOLEAN ELSE {FALSE})')], "HTiny", "EndTruthful"),
  # client ignores the floor and stops after the first page
  "HC_OnePage": ([('ELSE "none"', 'ELSE "floor"')], "HTiny", "NoLoss"),
  # client stops at the floor on a tie (<= instead of <, CH-23)
  "HC_FloorLe": ([('ELSE IF T(ms[1]) < Floor THEN "floor"', 'ELSE IF T(ms[1]) <= Floor THEN "floor"')], "HTiny", "NoLoss"),
  # D35, Seance before #282: page lines below everything held are appended
  # (the belowHeld fixture on d0322ffa7: Order h,o,a)
  "HC_KeepOld": ([KEEP], "HBelowHeld", "HeldOrder"),
  "HC_KeepOldOrder": ([KEEP], "HBelowHeld", "Order"),
}
def cfg(over, inv, prop, spec_fair):
    c = dict(BASE, **over)
    out = ["SPECIFICATION " + ("FairSpec" if spec_fair else "Spec"), "CONSTANTS"]
    out += [f"  {k} = {v}" for k, v in c.items()]
    out += ["INVARIANT " + inv]
    if prop: out += ["PROPERTY " + prop]
    out += ["CHECK_DEADLOCK FALSE", ""]
    return "\n".join(out)
# HISTORY-REVIEW-2: completion with every gap message held, on every positive
for pos in ["HTiny2", "HHeldStop", "HMsgs", "HFuzz", "HNoBatchAgrees", "HBatchAgreesBudget", "HFail",
            "HOld", "HOld2", "HBelowHeld"]:
    CFGS["CoverDone_" + pos] = (CFGS[pos][0], "CoverDone", None, "fail")
lst = []
for n, (over, inv, prop, exp) in CFGS.items():
    open(n + ".cfg", "w").write(cfg(over, inv, prop, prop is not None))
    lst.append(f"History {n} {exp}")
src = open("History.tla").read()
for n, (reps, base, prop) in MUTS.items():
    m = src
    for old, new in reps:
        assert m.count(old) == 1, (n, old, m.count(old))
        m = m.replace(old, new)
    open(n + ".tla", "w").write(m.replace("MODULE History", "MODULE " + n))
    over, _, _, _ = CFGS[base]
    open(n + "_" + base + ".cfg", "w").write(cfg(over, prop, None, False))
    lst.append(f"{n} {n}_{base} fail")
open("list-h1", "w").write("\n".join(lst) + "\n")
print(len(lst), "checks")
