#!/usr/bin/env python3
"""Write History.tla's configs, mutants and list-h1 (v1, D26; NOld, D35; Holes, Skew, D36).  Run from model/.

Each witness is the positive config Tiny with the named changes; its comment
says why it is reachable (DESIGN.md).  Mutants: History.tla with one anchor
replaced (the anchor must occur exactly once).
"""
BASE = dict(Mode='"reconnect"', MayFail="FALSE", NOld=0, NHeld=1, Holes="{}", Skew=0, NGap=2, LiveOn="TRUE", Times="{1, 3}", Fuzz=0, Limit=1,
            BudgetKind='"pages"', BudgetN=5, ExactCount="TRUE", Contiguous="TRUE",
            TimeOrdered="TRUE", BatchAgrees="TRUE", StableAcrossReconnect="FALSE",
            SendsEnd="TRUE", Dedupe="TRUE", MsgidAnchor="TRUE", StopOnHeld="FALSE",
            InsertMerge="TRUE")
SAFE = ("TypeOK NoLoss NoDup ContentOnce ReplayIdStable Order HeldOrder PageEligible EndTruthful"
        " EndNext UnknownEmpty JoinRecovers MoreRecovers HoleKept HoleOrder OldByTime")
# D36: Seance's own reconnect appends (InsertMerge off), which W_Append and
# W_HoleAppend show breaks Order and HoleOrder; everything else must hold
SEANCE = ("TypeOK NoLoss NoDup ContentOnce ReplayIdStable HeldOrder PageEligible EndTruthful"
          " EndNext UnknownEmpty HoleKept OldByTime")
JOIN = dict(Mode='"join"', NHeld=0, NGap=3, Limit=2)
MORE = dict(Mode='"more"', NHeld=2, NGap=3, Limit=2, StableAcrossReconnect="TRUE")
# D35, the belowHeld fixture's shape: one line stored before everything held,
# one LATEST page holding all of it, and Seance's appending reconnect client
BELOW = dict(NOld=1, NGap=1, LiveOn="FALSE", Limit=3, InsertMerge="FALSE")
# D36: two held lines with a hole between them (span h1, x, h2), one gap line,
# one LATEST page holding all of it; Times {1, 2, 3} so that the hole can lie
# strictly between the held lines
HOLE = dict(NHeld=2, Holes="{2}", NGap=1, LiveOn="FALSE", Times="{1, 2, 3}", Limit=4)
# D36: a server clock that stamps the gap line up to one earlier than the held
# line, the store kept in arrival order (Stable), Seance's appending client
SKEW = dict(NGap=1, LiveOn="FALSE", Times="{1, 2}", Fuzz=1, Skew=1, Limit=2,
            StableAcrossReconnect="TRUE", TimeOrdered="FALSE", InsertMerge="FALSE")
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
  # ---- D36: Holes and Skew ----
  # the same hole with two held lines a moment apart (within FUZZ of each
  # other): Seance's cutoff min(newest held - FUZZ, oldest held) leaves the
  # window open whenever the oldest held line is less than FUZZ older than
  # the newest (evilnet/seance#290)
  "W_FuzzBelow2": (dict(BELOW, NHeld=2, Fuzz=1, Times="{1, 2, 3}"), "HeldOrder", None, "fail"),
  # time-merging client: a hole a page carries is kept once, between its held
  # neighbours
  "HHole": (HOLE, SAFE, "Terminates", "pass"),
  "HHoleFuzz": (dict(HOLE, Fuzz=1), SAFE, "Terminates", "pass"),
  # Times {2, 3}: with Fuzz 1 the floor is never above the oldest time, so a
  # cutoff of the floor alone drops nothing; it tells HC_FloorCut from HC_NewestCut
  "HHoleFuzzHi": (dict(HOLE, Fuzz=1, Times="{2, 3}"), SAFE, "Terminates", "pass"),
  # several pages (Limit 2), a live line, an old line
  "HHolePages": (dict(HOLE, Limit=2, LiveOn="TRUE"), SAFE, "Terminates", "pass"),
  "HHoleOld": (dict(HOLE, NOld=1, Limit=5), SAFE, "Terminates", "pass"),
  # Seance's shape: appending; the hole is kept once (no loss, no dup) ...
  "HHoleSeance": (dict(HOLE, InsertMerge="FALSE"), SEANCE, "Terminates", "pass"),
  "HHoleSeanceFuzz": (dict(HOLE, InsertMerge="FALSE", Fuzz=1), SEANCE, "Terminates", "pass"),
  # ... but shown below the newest held line (Seance numbers the gap from a
  # block above every held row, and insertMessage places by id)
  "W_HoleAppend": (dict(HOLE, InsertMerge="FALSE"), "HoleOrder", None, "fail"),
  "CoverHoleKept": (HOLE, "CoverHoleKept", None, "fail"),
  "CoverHoleBelowFloor": (dict(HOLE, Fuzz=1), "CoverHoleBelowFloor", None, "fail"),
  # Skew: the current rule (cutoff at most newest held - FUZZ, FUZZ >= Skew)
  # keeps a skewed gap line; HV_MsgidSettle drops it
  "HSkew": (SKEW, "NoLoss NoDup HoleKept", "Terminates", "pass"),
  "CoverSkew": (SKEW, "OldByTime", None, "fail"),
  # Skew against the current rule: a hole stamped up to Skew below the oldest
  # held line is under min(newest held - FUZZ, oldest held) and is dropped
  "W_SkewHole": (dict(HOLE, Fuzz=1, Skew=1, StableAcrossReconnect="TRUE", TimeOrdered="FALSE"), "HoleKept", None, "fail"),
  # ---- D38: configs for HV_PlaceByTime (each also run on the current rule) ----
  # Seance's appending client over several pages, a live line and a hole
  "HHoleSeancePages": (dict(HOLE, Limit=2, LiveOn="TRUE", InsertMerge="FALSE"), SEANCE, "Terminates", "pass"),
  # #290 over two pages: Seance's appending client, an old line inside the
  # FUZZ window, two held lines, Limit 2
  "W_FuzzBelowPages": (dict(NOld=1, NHeld=2, Limit=2, Fuzz=1, Times="{1, 2, 3}", InsertMerge="FALSE", LiveOn="FALSE", NGap=1), "HeldOrder", None, "fail"),
  # Skew with two held lines (which may arrive out of time order), Times {1, 2, 3}
  "HSkew2": (dict(SKEW, NHeld=2, Times="{1, 2, 3}", Limit=3), "NoLoss NoDup HoleKept", "Terminates", "pass"),
  # Skew with a live line, relayed before or after the page
  "HSkewLive": (dict(SKEW, LiveOn="TRUE"), "NoLoss NoDup HoleKept", "Terminates", "pass"),
  # a live line stamped below the oldest held line is appended (live lines are
  # not placed): HeldOrder breaks under Skew whatever the page rule
  "W_SkewLive": (dict(SKEW, LiveOn="TRUE"), "HeldOrder", None, "fail"),
  # Skew with a hole and Fuzz 1 but times the cutoff cannot reach (Times {2, 3})
  "HSkewHole": (dict(HOLE, Fuzz=1, Skew=1, Times="{2, 3}", StableAcrossReconnect="TRUE", TimeOrdered="FALSE", InsertMerge="FALSE"), "NoLoss NoDup HoleKept", "Terminates", "pass"),
}
KEEP = ('Placed(m) == ~(Mode = "reconnect" /\\ NHeld > 0 /\\ T(m) < Cutoff)', 'Placed(m) == TRUE')
# D36, the cutoff in Seance's resolve(): Math.min(floorMs, holdsFrom), floorMs = floor - FUZZ
CUT = 'Cutoff == IF Floor < HoldsFrom THEN Floor ELSE HoldsFrom'
PLACED = KEEP[0]
# D38: page lines placed by time (after the last row no newer than the line)
MERGEALL = ('MergeAll(b, ms) == IF ms = <<>> THEN b ELSE MergeAll(Merge1(b, Head(ms)), Tail(ms))\n',
            'MergeAll(b, ms) == IF ms = <<>> THEN b ELSE MergeAll(Merge1(b, Head(ms)), Tail(ms))\n'
            'PlaceAt(b, m) == IF \\E i \\in DOMAIN b : T(b[i]) <= T(m)\n'
            '                 THEN CHOOSE i \\in DOMAIN b : T(b[i]) <= T(m) /\\ \\A j \\in DOMAIN b : j > i => T(b[j]) > T(m)\n'
            '                 ELSE 0\n'
            'Merge1P(b, m) == IF Dedupe /\\ m \\in Range(b) THEN b\n'
            '                 ELSE SubSeq(b, 1, PlaceAt(b, m)) \\o <<m>> \\o SubSeq(b, PlaceAt(b, m) + 1, Len(b))\n'
            'RECURSIVE MergeAllP(_, _)\n'
            'MergeAllP(b, ms) == IF ms = <<>> THEN b ELSE MergeAllP(Merge1P(b, Head(ms)), Tail(ms))\n')
RECV = "buf' = MergeAll(buf, Kept(it))"
# D38: what can hold under Skew (HoleOrder and Order compare against store order or a sorted start)
SKEWINV = "TypeOK NoLoss NoDup ContentOnce HoleKept PlacedOrder HeldOrder"
# with a live line: HeldOrder is left out, since a live line stamped below the
# oldest held line is appended whatever the page rule (W_SkewLive)
SKEWINVL = "TypeOK NoLoss NoDup ContentOnce HoleKept PlacedOrder"
LOSS = "NoLoss NoDup ContentOnce HoleKept"
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
  # ---- D36 ----
  # in-range unknown lines dropped, as if the cutoff were the newest held line
  "HC_NewestCut": ([(CUT, 'Cutoff == MaxT(Held)')],
                   [("HHole", "HoleKept", "fail"), ("HHoleFuzz", "HoleKept", "fail"),
                    ("HHoleFuzzHi", "HoleKept", "fail"), ("HHoleSeance", "HoleKept", "fail")]),
  # the cutoff of the floor alone (newest held - FUZZ), not min(it, oldest held)
  "HC_FloorCut": ([(CUT, 'Cutoff == Floor')],
                  [("HHole", "HoleKept", "fail"), ("HHoleFuzz", "HoleKept", "fail"),
                   ("HHoleFuzzHi", "HoleKept", "pass"), ("HHoleSeance", "HoleKept", "fail"),
                   # without holes it cannot be told from the correct rule (D35)
                   ("HOld2", SAFE, "pass"), ("HOldFuzz", SAFE, "pass"), ("HBelowHeld", SAFE, "pass")]),
  # evilnet/seance#290's proposal: settle by msgid.  A page line older than the
  # oldest held line and not itself held is old, whatever FUZZ says
  "HV_MsgidSettle": ([(PLACED, 'Placed(m) == ~(Mode = "reconnect" /\\ NHeld > 0 /\\ (T(m) < Cutoff \\/ (T(m) < HoldsFrom /\\ Content(m) \\notin Held)))')],
                     [("W_FuzzBelow", "HeldOrder", "pass"), ("W_FuzzBelow2", "HeldOrder", "pass"),
                      ("HBelowHeld", SAFE, "pass"), ("HOld", SAFE, "pass"), ("HOld2", SAFE, "pass"),
                      ("HOldFuzz", SAFE, "pass"), ("HHoleFuzz", SAFE, "pass"), ("HHoleOld", SAFE, "pass"),
                      ("HHoleSeanceFuzz", SEANCE, "pass"),
                      ("HSkew", "NoLoss", "fail"),
                      # D38: the same comparison configs as HV_PlaceByTime
                      ("W_HoleAppend", "PlacedOrder", "fail"), ("HHoleSeancePages", "PlacedOrder", "fail"),
                      ("W_FuzzBelowPages", "HeldOrder", "pass"),
                                            # under Skew it loses before order matters (one config file per base)
                      ("HSkew2", LOSS, "fail"), ("HSkewLive", LOSS, "fail"), ("HSkewHole", LOSS, "fail")]),
  # D38: the current rule, unchanged, on the D38 comparison runs
  "HR_Current": ([],
                 [("W_HoleAppend", "PlacedOrder", "fail"), ("HHoleSeancePages", "PlacedOrder", "fail"),
                  ("W_FuzzBelow", "PlacedOrder", "fail"),
                  # D38's first run expected these three to pass: the current rule
                  # appends a gap line stamped below the held line (PlacedOrder)
                  ("HSkew", SKEWINV, "fail"), ("HSkew2", SKEWINV, "fail"), ("HSkewLive", SKEWINVL, "fail"),
                  ("HSkewHole", SKEWINV, "fail")]),
  # D38, the candidate fix for #290 and #292: the drop is unchanged (below
  # min(newest held - FUZZ, oldest held)), but every page line kept is placed
  # by server time among the rows (after the last row no newer than it), not
  # appended by its reserved id.  Live lines are still appended (InsertMerge).
  "HV_PlaceByTime": ([MERGEALL, (RECV, 'buf\' = IF it.k = "page" THEN MergeAllP(buf, Kept(it)) ELSE MergeAll(buf, Kept(it))')],
                     [("W_FuzzBelow", SAFE + " PlacedOrder", "pass"), ("W_FuzzBelow2", SAFE + " PlacedOrder", "pass"),
                      ("W_HoleAppend", SAFE + " PlacedOrder", "pass"),
                      ("HHole", SAFE + " PlacedOrder", "pass"), ("HHoleSeance", SAFE + " PlacedOrder", "pass"),
                      ("HHoleSeanceFuzz", SAFE + " PlacedOrder", "pass"), ("HHoleFuzz", SAFE + " PlacedOrder", "pass"),
                      ("HHoleFuzzHi", SAFE + " PlacedOrder", "pass"), ("HHoleOld", SAFE + " PlacedOrder", "pass"),
                      ("HHolePages", SAFE + " PlacedOrder", "pass"), ("HHoleSeancePages", SAFE + " PlacedOrder", "pass"),
                      ("HOld", SAFE + " PlacedOrder", "pass"), ("HOld2", SAFE + " PlacedOrder", "pass"),
                      ("HOldFuzz", SAFE + " PlacedOrder", "pass"), ("HBelowHeld", SAFE + " PlacedOrder", "pass"),
                      ("W_FuzzBelowPages", SAFE + " PlacedOrder", "pass"),
                      # Skew 1: the msgid-settling loss config, and skew with two held lines and with a live line
                      ("HSkew", SKEWINV, "pass"), ("HSkew2", SKEWINV, "pass"), ("HSkewLive", SKEWINVL, "pass"),
                      ("HSkewHole", SKEWINV, "pass"),
                      # the drop is unchanged, so a hole stamped below the oldest held line is still dropped
                      ("W_SkewHole", "HoleKept", "fail")]),
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
            "HOld", "HOld2", "HBelowHeld", "HHole", "HHoleSeance"]:
    CFGS["CoverDone_" + pos] = (CFGS[pos][0], "CoverDone", None, "fail")
lst = []
for n, (over, inv, prop, exp) in CFGS.items():
    open(n + ".cfg", "w").write(cfg(over, inv, prop, prop is not None))
    lst.append(f"History {n} {exp}")
import os
seen = set()
src = open("History.tla").read()
for n, (reps, *runs) in MUTS.items():
    m = src
    for old, new in reps:
        assert m.count(old) == 1, (n, old, m.count(old))
        m = m.replace(old, new)
    open(n + ".tla", "w").write(m.replace("MODULE History", "MODULE " + n))
    # (base, prop) expects a failure; D36 adds [(base, invariants, expect), ...]
    runs = [(runs[0], runs[1], "fail")] if isinstance(runs[0], str) else runs[0]
    for base, prop, exp in runs:
        over, _, _, _ = CFGS[base]
        assert not os.path.exists(n + "_" + base + ".cfg") or n + "_" + base not in seen, (n, base)
        seen.add(n + "_" + base)
        open(n + "_" + base + ".cfg", "w").write(cfg(over, prop, None, False))
        lst.append(f"{n} {n}_{base} {exp}")
open("list-h1", "w").write("\n".join(lst) + "\n")
print(len(lst), "checks")
