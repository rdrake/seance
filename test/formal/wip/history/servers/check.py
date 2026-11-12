#!/usr/bin/env python3
"""Check a recorded CHATHISTORY run (drive.py) against what History.tla and
the chathistory text assume of a server.

  check.py OBS.jsonl [--tlc WORKDIR] [-j N] [--tlc-max-page K] [--json OUT]

Python property checks (every query):
  FRAME     the reply is one labeled FAIL, or one `chathistory` batch (type,
            target param, every inner line batch-tagged, closed), maybe
            inside a labeled-response batch; inner lines PRIVMSG/NOTICE only;
            every inner line has msgid and time; chathistory-end only on the
            chathistory BATCH start (LR:53-58, BA:37-54, CH:71-73, CH:136)
  MSGID     a replayed line carries its original msgid (CH:126, MUST) and
            original time (CH:126, SHOULD), and the text the sender sent
  ELIG      PageEligible (D3): every line is eligible for the selector:
            the right side of it, anchor excluded (CH:83, 89, 95, 111)
  EXACT     ExactCount (D3): |page| = min(limit, |eligible|) (CH:69 lets a
            server return more or fewer: latitude, not a violation)
  CONTIG    Contiguous (D10): the page is the eligible lines nearest the
            selector (CH:111's counting rule; D10: no licence for holes)
  ORDER     BatchAgrees (D7): the batch is in the connection's order, and
            that order is time order (CH:126-128, SHOULDs; TimeOrdered is a
            chosen environment, D8)
  END       EndNext (D26): a chathistory-end tag means the next page in the
            same direction, against the same snapshot, is empty (CH:136)
  ENDLIVE   the same, measured: the follow-up query drive.py actually sent
  UNKNOWN   UnknownEmpty (MI-5, D5): an unknown msgid selects nothing: an
            empty batch or FAIL
  AROUND    AROUND (not modelled, D26): a contiguous run of the order around
            the selector, at most limit lines (CH:103)
  TARGETS   draft/chathistory-targets (CH:113-123)
  NOAUTO    no automatic playback on JOIN once chathistory is negotiated
            (CH:41, SHOULD NOT)
  ISUPPORT  CHATHISTORY sent (CH:49, MUST); MSGREFTYPES (CH:51, SHOULD)

The store each query sees is what the harness seeded (echo msgids and
times) plus, per channel, the channel events the querier saw if the server
replays any of them (a server may store JOINs and replay them as PRIVMSG
without event-playback).  The connection's order among equal times is taken
from the server's own full-store answer and then held fixed (CH:128).

TLC (--tlc): for every query of a form History.tla models (LATEST *,
BEFORE msgid=, BEFORE timestamp=) on the channel drive.py seeds for it, a
module that EXTENDS History pins the store (times as ranks, ord as the
server's order), injects the observed query, and asks:
  M (match):  is the observed answer a SrvAnswer/SrvFail step under the
              strict switches (ExactCount, Contiguous, BatchAgrees, SendsEnd)?
  I (inject): with the observed page appended as is, do PageEligible,
              UnknownEmpty, EndNext and EndTruthful hold?
"""
import argparse, json, os, re, shutil, subprocess, sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ircwire import parse  # noqa: E402
from drive import ts2ms  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "..", "model", "History.tla")
JAR = os.environ.get("TLA_JAR", os.path.expanduser("~/tools/formal/tla2tools.jar"))
JAVA = os.environ.get("TLC_JAVA", "java").split()
if os.environ.get("TLC_XMX"):
    JAVA = JAVA + ["-Xmx" + os.environ["TLC_XMX"]]

PROPS = ["FRAME", "MSGID", "ELIG", "EXACT", "CONTIG", "ORDER", "END", "ENDLIVE", "UNKNOWN",
         "AROUND", "TARGETS", "NOAUTO", "ISUPPORT"]


class Item:
    def __init__(self, key, ms, seq, kind, text=None, sender=None, ts=None):
        self.key, self.ms, self.seq, self.kind = key, ms, seq, kind
        self.text, self.sender, self.ts = text, sender, ts

    def __repr__(self):
        return self.text.split()[-1] if self.text else f"{self.kind}:{self.sender}"


def low(s):
    return s.lower() if s else s


class Checker:
    def __init__(self, recs):
        self.recs = recs
        self.meta = next(r for r in recs if r["kind"] == "meta")
        self.qs = [r for r in recs if r["kind"] == "query"]
        self.byi = {r["i"]: r for r in self.qs}
        for q in self.qs:
            q["known"] = {low(k): v for k, v in q["known"].items()}
            q["known_after"] = {low(k): v for k, v in q["known_after"].items()}
        self.res = defaultdict(lambda: {"pass": 0, "fail": 0, "na": 0})
        self.dev = []
        self.items = defaultdict(list)     # chan -> [Item] in observation order
        self.bykey = {}
        self.msgcount = defaultdict(int)   # chan -> number of msg items so far (known index)
        seq = 0
        for r in recs:
            if r["kind"] == "event" and r.get("msgid"):
                seq += 1
                it = Item(r["msgid"], ts2ms(r["time"]), seq, "event", sender=r["nick"], ts=r["time"])
                it.chan = low(r["chan"])
                self.items[it.chan].append(it)
                self.bykey[it.key] = it
            elif r["kind"] == "msg":
                seq += 1
                ch = low(r["chan"]) if r["chan"].startswith("#") else "dm"
                it = Item(r["msgid"], ts2ms(r["time"]), seq, "msg", r["text"], r["sender"], r["time"])
                it.chan = ch
                self.msgcount[ch] += 1
                it.nmsg = self.msgcount[ch]
                self.items[ch].append(it)
                self.bykey[it.key] = it
        self.replayed_events = set()
        self.order = {}

    # ---- reply parsing
    def reply(self, q):
        """-> dict(kind=fail|batch|none, ...) for the query's own reply."""
        lines = [(l, parse(l)) for l in q["lines"]]
        lab = q.get("label")
        errs = []
        top = [(l, m) for l, m in lines if lab and m["tags"].get("label") == lab]
        if lab is None:
            top = [(l, m) for l, m in lines if (m["cmd"] == "BATCH" and m["params"][0].startswith("+")
                                                and "batch" not in m["tags"]) or m["cmd"] == "FAIL"][:1]
        if len(top) != 1:
            errs.append(f"{len(top)} lines carry the label (LR:53 wants exactly one)")
            if not top:
                return {"kind": "none", "errs": errs, "ms": [], "end": False}
        l0, m0 = top[0]
        if m0["cmd"] == "FAIL":
            return {"kind": "fail", "errs": errs, "code": m0["params"][1] if len(m0["params"]) > 1 else "",
                    "ms": [], "end": False, "line": l0}
        if m0["cmd"] != "BATCH" or not m0["params"][0].startswith("+"):
            errs.append(f"labeled reply is {m0['cmd']}, not a BATCH or FAIL")
            return {"kind": "none", "errs": errs, "ms": [], "end": False}
        # collect the batch tree
        opened, closed, members = {}, set(), defaultdict(list)
        root = m0["params"][0][1:]
        opened[root] = m0
        tree = {root}
        for l, m in lines:
            b = m["tags"].get("batch")
            if m["cmd"] == "BATCH" and m["params"][0].startswith("+") and b in tree:
                ref = m["params"][0][1:]
                opened[ref] = m
                tree.add(ref)
                members[b].append(m)
            elif m["cmd"] == "BATCH" and m["params"][0].startswith("-"):
                ref = m["params"][0][1:]
                if ref in tree:
                    closed.add(ref)
                    if b:
                        errs.append(f"BATCH -{ref} carries batch={b}")
            elif b in tree:
                members[b].append(m)
            elif b and b not in tree and b not in opened:
                errs.append(f"line refers to unknown batch {b}: {l[:80]}")
        for ref in tree:
            if ref not in closed:
                errs.append(f"batch {ref} never closed (BA:54)")
        sub = q["cmd"].split()[1].upper()
        want = "draft/chathistory-targets" if sub == "TARGETS" else "chathistory"
        hist = [ref for ref in tree if len(opened[ref]["params"]) > 1 and opened[ref]["params"][1] == want]
        if len(hist) != 1:
            errs.append(f"{len(hist)} batches of type {want} (CH:71 wants one)")
            return {"kind": "none", "errs": errs, "ms": [], "end": False}
        h = hist[0]
        hb = opened[h]
        if h != root and opened[root]["params"][1] != "labeled-response":
            errs.append(f"outer batch type {opened[root]['params'][1]}, not labeled-response (LR:55-58)")
        for ref in tree:
            if ref != h and "draft/chathistory-end" in opened[ref]["tags"]:
                errs.append("chathistory-end on a batch other than the history batch (CH:136)")
        if sub != "TARGETS":
            if len(hb["params"]) != 3:
                errs.append(f"chathistory batch params {hb['params'][1:]} (CH:71: one, the target)")
            elif low(hb["params"][2]) != low(q["cmd"].split()[2]):
                errs.append(f"chathistory batch target {hb['params'][2]} for {q['cmd'].split()[2]}")
        ms = members[h]
        for m in ms:
            if sub == "TARGETS":
                if m["cmd"] != "CHATHISTORY" or m["params"][:1] != ["TARGETS"]:
                    errs.append(f"targets batch line {m['cmd']}")
            else:
                if m["cmd"] not in ("PRIVMSG", "NOTICE"):
                    errs.append(f"{m['cmd']} in a history batch without event-playback (CH:73)")
                if "msgid" not in m["tags"] or "time" not in m["tags"]:
                    errs.append("history line without msgid or time (D11)")
        stray = [m for ref in tree if ref != h for m in members[ref] if m["cmd"] != "BATCH"]
        if stray:
            errs.append(f"{len(stray)} lines outside the history batch in the reply")
        return {"kind": "batch", "errs": errs, "ms": ms, "end": "draft/chathistory-end" in hb["tags"],
                "head": hb}

    def resolve(self, mid):
        """A wire msgid -> store Item.  A replayed event may carry a derived
        id (Ergo's HistServ prefixes '_'); that is matched and reported."""
        if mid in self.bykey:
            return self.bykey[mid], False
        for pre in ("_",):
            if mid.startswith(pre) and mid[len(pre):] in self.bykey:
                return self.bykey[mid[len(pre):]], True
        return None, False

    # ---- the order and the store
    def build_order(self):
        """Per channel: the connection's order.  Distinct times sort by time;
        within a tie, the server's order in its largest answer (the first
        LATEST * 100) wins; lines it never showed sort by observation."""
        for q in self.qs:
            rp = self.reply(q)
            for m in rp["ms"]:
                it, munged = self.resolve(m["tags"].get("msgid", ""))
                if it is not None and it.kind == "event":
                    self.replayed_events.add(it.chan)
        for ch, its in self.items.items():
            full = [q for q in self.qs if q["note"] == "full store" and low(q["chan"]) == ch]
            rank = {}
            if full:
                for k, m in enumerate(self.reply(full[0])["ms"]):
                    it, _ = self.resolve(m["tags"].get("msgid", ""))
                    if it is not None:
                        rank[it.key] = k
            store = [it for it in its if it.kind == "msg" or ch in self.replayed_events]
            self.server_rank = rank
            # time order first (TimeOrdered is the environment we check against;
            # ORDER reports when the server's own order disagrees)
            store.sort(key=lambda it: (it.ms, rank.get(it.key, 10 ** 6), it.seq))
            self.order[ch] = store

    def store_at(self, ch, nmsg):
        return [it for it in self.order.get(ch, []) if it.kind == "event" or it.nmsg <= nmsg]

    # ---- selectors and eligibility
    def sel(self, tok, O):
        """-> ('ts', ms) | ('id', pos) | ('unknown', None) | ('star', None)"""
        if tok == "*":
            return ("star", None)
        k, _, v = tok.partition("=")
        if k == "timestamp":
            return ("ts", ts2ms(v))
        it, _ = self.resolve(v)
        if it is None or it not in O:
            return ("unknown", v)
        return ("id", O.index(it))

    @staticmethod
    def before(O, k, s):
        return s[0] == "id" and k < s[1] or s[0] == "ts" and O[k].ms < s[1]

    @staticmethod
    def after(O, k, s):
        return s[0] == "id" and k > s[1] or s[0] == "ts" and O[k].ms > s[1]

    def eligible(self, sub, sels, O):
        """-> (eligible positions, nearest-first positions, direction) or None
        when the selector is unknown."""
        if any(s[0] == "unknown" for s in sels):
            return None
        idx = range(len(O))
        if sub == "LATEST":
            E = [k for k in idx if sels[0][0] == "star" or self.after(O, k, sels[0])]
            return E, sorted(E, reverse=True), "back"
        if sub == "BEFORE":
            E = [k for k in idx if self.before(O, k, sels[0])]
            return E, sorted(E, reverse=True), "back"
        if sub == "AFTER":
            E = [k for k in idx if self.after(O, k, sels[0])]
            return E, sorted(E), "fwd"
        if sub == "BETWEEN":
            a, b = sels
            fwd = self.cmp_sel(O, a, b)
            if fwd is None:
                return [], [], "fwd"
            if fwd:
                E = [k for k in idx if self.after(O, k, a) and self.before(O, k, b)]
                return E, sorted(E), "fwd"
            E = [k for k in idx if self.before(O, k, a) and self.after(O, k, b)]
            return E, sorted(E, reverse=True), "back"
        return None

    @staticmethod
    def cmp_sel(O, a, b):
        """True if a is earlier than b, False if later, None if the same point."""
        def key(s):
            return (O[s[1]].ms, s[1]) if s[0] == "id" else (s[1], None)
        ka, kb = key(a), key(b)
        if ka[0] != kb[0]:
            return ka[0] < kb[0]
        if a[0] == "id" and b[0] == "id":
            return None if a[1] == b[1] else a[1] < b[1]
        if a[0] == "ts" and b[0] == "ts":
            return None
        # a msgid and a timestamp at the same time: the msgid's line is not
        # after the timestamp (time > t is false), not before it either
        return None

    # ---- the checks
    def note(self, prop, ok, q, expected="", observed="", cls=""):
        if ok is None:
            self.res[prop]["na"] += 1
            return
        self.res[prop]["pass" if ok else "fail"] += 1
        if not ok:
            self.dev.append({"prop": prop, "i": q["i"] if q else None, "cmd": q["cmd"] if q else "",
                             "note": q["note"] if q else "", "expected": expected, "observed": observed,
                             "class": cls})

    def check_query(self, q):
        w = q["cmd"].split()
        sub = w[1].upper()
        rp = self.reply(q)
        self.note("FRAME", not rp["errs"], q, "CH:71-73, BA:37-54, LR:53-58", "; ".join(rp["errs"]))
        if sub == "TARGETS":
            return self.check_targets(q, rp)
        ch = low(w[2]) if w[2].startswith("#") else "dm"
        lim = int(w[-1])
        stores = [self.store_at(ch, q["known"].get(ch, 0)),
                  self.store_at(ch, q["known_after"].get(ch, 0))]
        if not self.items.get(ch):
            # a target with nothing seeded (missing / unjoined) - only FAIL or an empty batch
            ok = rp["kind"] == "fail" or not rp["ms"]
            self.note("ELIG", ok, q, "FAIL or empty batch", f"{rp['kind']} with {len(rp['ms'])} lines")
            return rp
        # MSGID: every line is a stored line, with its original id/time/text
        page = []
        for m in rp["ms"]:
            it, munged = self.resolve(m["tags"].get("msgid", ""))
            if it is None:
                self.note("MSGID", False, q, "a stored msgid", f"unknown msgid {m['tags'].get('msgid')}",
                          "violation: CH:126 MUST")
                page.append(None)
                continue
            probs = []
            if munged:
                probs.append(f"event {it.kind} replayed as {m['cmd']} with msgid {m['tags']['msgid']} "
                             f"(original {it.key})")
            if m["tags"].get("time") != it.ts:
                probs.append(f"time {m['tags'].get('time')} != original {it.ts}")
            if it.kind == "msg" and m["params"][-1] != it.text:
                probs.append("text differs")
            self.note("MSGID", not probs, q, "original msgid, time and text (CH:126)", "; ".join(probs),
                      "event-as-PRIVMSG" if munged else "violation")
            page.append(it)
        if rp["kind"] == "fail":
            for p in ("ELIG", "EXACT", "CONTIG", "ORDER", "END"):
                self.note(p, None, q)
            unk = self.unknown_sel(w, sub, stores[0])
            self.note("UNKNOWN", True if unk else None, q)
            self.note("FAILREPLY", False, q, "a page", rp.get("line", ""), "info: FAIL is a completion (CH-7)")
            return rp
        if rp["kind"] == "none":
            return rp
        # which snapshot: the one the page fits (a racing line may or may not be in)
        verdicts = [self.page_props(q, sub, w, lim, O, page, rp) for O in
                    ([stores[0]] if stores[0] == stores[1] else stores)]
        best = min(verdicts, key=lambda v: sum(1 for x in v.values() if x[0] is False))
        if len(verdicts) > 1:
            self.snap_report.append((q["i"], q["cmd"], ["before", "after"][verdicts.index(best)],
                                     [sum(1 for x in v.values() if x[0] is False) for v in verdicts]))
        for prop, (ok, exp, obs, cls) in best.items():
            self.note(prop, ok, q, exp, obs, cls)
        return rp

    def unknown_sel(self, w, sub, O):
        toks = w[3:-1]
        return any(self.sel(t, O)[0] == "unknown" for t in toks)

    def page_props(self, q, sub, w, lim, O, page, rp):
        out = {}
        sels = [self.sel(t, O) for t in w[3:-1]]
        names = [repr(O[k]) for k in range(len(O))]
        pos = [O.index(it) if it in O else None for it in page]
        shown = [repr(it) for it in page]
        if any(s[0] == "unknown" for s in sels):
            out["UNKNOWN"] = (not page, "empty batch or FAIL (D5, MI-5)", f"{len(page)} lines: {shown}",
                              "violation of the D5 restriction")
            if rp["end"] and page:
                out["END"] = (False, "no end tag", "tagged", "")
            return out
        if sub == "AROUND":
            ok = None not in pos and pos == sorted(pos) and (not pos or pos == list(range(pos[0], pos[-1] + 1)))
            s = sels[0]
            anchor = s[1] if s[0] == "id" else min([k for k in range(len(O)) if O[k].ms >= s[1]] or [len(O)])
            if pos and None not in pos:
                ok = ok and pos[0] <= anchor <= pos[-1] + 1
            avail = len(O) - (1 if s[0] == "id" else 0)
            want = min(lim, avail)
            cnt_ok = len(page) <= lim
            if not page and avail > 0:
                out["AROUNDEMPTY"] = (False, f"lines around the selector ({avail} available)",
                                      "an empty batch" + (" tagged chathistory-end" if rp["end"] else ""),
                                      "latitude (CH:69 lower-case; CH:103 sets no minimum)")
            out["AROUND"] = (bool(ok) and cnt_ok, f"a contiguous run around {names[anchor] if anchor < len(O) else 'end'}, "
                             f"<= {lim} lines", f"{shown}", "")
            out["EXACT"] = (len(page) >= want and len(page) <= lim,
                            f"min(limit, available) = {want} (CH:69 lower-case 'should')",
                            f"{len(page)}: {shown}", "latitude (CH:69 MAY return fewer)")
            if rp["end"]:
                out["END"] = (None, "", "", "")
            return out
        el = self.eligible(sub, sels, O)
        E, near, direction = el
        Eset = set(E)
        inel = [shown[k] for k, p in enumerate(pos) if p not in Eset]
        out["ELIG"] = (not inel, f"only eligible lines; eligible = {[names[k] for k in sorted(E)]}",
                       f"ineligible {inel} in {shown}", "violation (D3: eligibility is mandatory)")
        want = min(lim, len(E))
        out["EXACT"] = (len(page) == want, f"{want} lines", f"{len(page)}: {shown}",
                        "latitude (CH:69 MAY return more or fewer)")
        nearest = set(near[:len(page)])
        out["CONTIG"] = (set(p for p in pos if p is not None) == nearest,
                         f"the {len(page)} eligible lines nearest the selector: {[names[k] for k in sorted(nearest)]}",
                         f"{shown}", "D10 (no licence for holes)")
        ps = [p for p in pos if p is not None]
        tm = [it.ms for it in page if it is not None]
        order_ok = ps == sorted(ps) and tm == sorted(tm)
        out["ORDER"] = (order_ok, "ascending in the connection's order (CH:126-128)", f"{shown}", "SHOULD")
        # EndNext against this snapshot
        if rp["end"]:
            if not ps:
                nxt = E
            elif direction == "back":
                lo = min(ps)
                nxt = [k for k in E if k < lo] if sub != "LATEST" or sels[0][0] == "star" else [k for k in E if k < lo]
            else:
                hi = max(ps)
                nxt = [k for k in E if k > hi]
            out["END"] = (not nxt, "next page in the same direction empty (CH:136, EndNext)",
                          f"next page would hold {[names[k] for k in nxt]}", "violation (D9: a false end tag is a mutant)")
        else:
            out["END"] = (None, "", "", "")
            # SendsEnd is per response and a SHOULD: count untagged last pages
            if ps is not None:
                rest = ([k for k in E if k < min(ps)] if direction == "back" else [k for k in E if k > max(ps)]) if ps else E
                if not rest:
                    self.untagged_last.append(q["i"])
        return out

    def check_targets(self, q, rp):
        w = q["cmd"].split()
        a, b, lim = ts2ms(w[2].split("=", 1)[1]), ts2ms(w[3].split("=", 1)[1]), int(w[4])
        fwd = a < b
        lo, hi = min(a, b), max(a, b)
        # the querier's visible targets: channels it is in, the DM peer
        nmsg_known = q["known"]
        latest = {}
        joined = {low(c) for c in (self.meta["channels"]["hist"], self.meta["channels"]["tlc"],
                                   self.meta["channels"]["empty"], self.meta["channels"]["other"])}
        for ch, its in self.items.items():
            if ch != "dm" and ch not in joined:
                continue
            S = [it for it in self.store_at(ch, nmsg_known.get(ch, 0))
                 if it.kind == "msg" or ch in self.replayed_events]
            if not S:
                continue
            name = self.meta["nicks"]["a"].lower() if ch == "dm" else ch
            latest[name] = max(it.ms for it in S)
        E = sorted([n for n, t in latest.items() if lo < t < hi], key=lambda n: latest[n], reverse=not fwd)
        got = [(low(m["params"][1]), ts2ms(m["params"][2])) for m in rp["ms"] if len(m["params"]) >= 3]
        names = [n for n, _ in got]
        exp = E[:lim]
        tms = [t for _, t in got]
        # selection: the lim targets nearest the first selector (BETWEEN's
        # rule, CH:119); order: by latest time (CH:115 names no direction)
        ok = (sorted(names) == sorted(exp) and all(latest.get(n) == t for n, t in got)
              and (tms == sorted(tms) or tms == sorted(tms, reverse=True)))
        self.note("TARGETS", ok, q, f"{sorted(exp)}, each with its latest time, ordered by time", f"{got}",
                  "selection/order per CH:115-119")
        if ok and len(tms) > 1:
            self.targets_dir.add("ascending" if tms == sorted(tms) else "descending")
        if rp["end"]:
            self.note("END", len(E) <= len(got), q, "no more targets", f"{len(E)} eligible, {len(got)} sent")
        return rp

    def check_followups(self):
        """ENDLIVE: a tagged page's measured next page is empty."""
        for q in self.qs:
            if q["followup_of"] is None:
                continue
            orig = self.byi[q["followup_of"]]
            rp0 = self.reply(orig)
            if not rp0["end"]:
                continue
            sub = orig["cmd"].split()[1].upper()
            if sub == "BETWEEN":
                # only the continuation in the page's own direction counts
                O = self.order[low(orig["cmd"].split()[2])]
                w = orig["cmd"].split()
                sels = [self.sel(t, O) for t in w[3:5]]
                if any(s[0] == "unknown" for s in sels):
                    continue
                fwd = self.cmp_sel(O, *sels)
                if fwd is None:
                    continue
                ms = rp0["ms"]
                anchor = (ms[-1] if fwd else ms[0])["tags"]["msgid"]
                if f"msgid={anchor}" != q["cmd"].split()[3]:
                    continue
            rp = self.reply(q)
            # lines the follow-up returns that are eligible for it; an
            # ineligible line there is reported under that query's ELIG
            el = self.eligible_lines(q, rp)
            ok = rp["kind"] == "batch" and not el
            self.note("ENDLIVE", ok, q, f"no eligible line: #{orig['i']} ({orig['cmd']}) was tagged chathistory-end",
                      f"{el}" if rp["kind"] == "batch" else rp["kind"], "violation (CH:136)")

    def eligible_lines(self, q, rp):
        w = q["cmd"].split()
        ch = low(w[2])
        O = self.store_at(ch, q["known"].get(ch, 0))
        el = self.eligible(w[1].upper(), [self.sel(t, O) for t in w[3:-1]], O)
        if el is None:
            return []
        E = set(el[0])
        out = []
        for m in rp["ms"]:
            it, _ = self.resolve(m["tags"].get("msgid", ""))
            if it in O and O.index(it) in E:
                out.append(repr(it))
        return out

    def check_misc(self):
        isu = self.meta["isupport"]
        self.note("ISUPPORT", "CHATHISTORY" in isu, None, "CHATHISTORY= (CH:49 MUST)", str(sorted(isu)))
        self.note("ISUPPORT", "MSGREFTYPES" in isu, None, "MSGREFTYPES (CH:51 SHOULD)", "absent")
        for r in self.recs:
            if r["kind"] == "join":
                bad = [l for l in r["lines"] if parse(l)["cmd"] in ("PRIVMSG", "NOTICE")
                       or (parse(l)["cmd"] == "BATCH" and "chathistory" in l)]
                self.note("NOAUTO", not bad, None, "no playback on JOIN (CH:41)", f"{bad[:3]}")
        # the server's own order agrees with time
        for ch, O in self.order.items():
            full = [q for q in self.qs if q["note"] == "full store" and low(q["chan"]) == ch]
            if not full:
                continue
            seen = [self.resolve(m["tags"]["msgid"])[0] for m in self.reply(full[0])["ms"]]
            tm = [it.ms for it in seen if it]
            self.note("ORDER", tm == sorted(tm), full[0], "the full store in time order (TimeOrdered, D8)", f"{seen}")
            # informational: the order within ties against the querier's relay order
            msgs = [it for it in seen if it and it.kind == "msg"]
            self.tie_report.append((ch, [repr(it) for it in msgs],
                                    [repr(it) for it in sorted(msgs, key=lambda it: it.seq)]))

    def walks(self):
        """CH:192-208's loop without a floor, as drive.py ran it: what it
        retrieved against the store (a client-side witness, D5)."""
        out = {}
        series = defaultdict(list)
        for q in self.qs:
            if q["note"].startswith("walk-"):
                series[q["note"].rsplit(" page", 1)[0]].append(q)
        for name, qs in series.items():
            ch = low(qs[0]["chan"])
            O = self.store_at(ch, qs[0]["known"].get(ch, 0))
            seen = []
            for q in qs:
                for m in self.reply(q)["ms"]:
                    it, _ = self.resolve(m["tags"].get("msgid", ""))
                    seen.append(it)
            missing = [repr(it) for it in O if it not in seen]
            dup = len(seen) - len(set(seen))
            out[f"{name} ({len(qs)} pages)"] = (len(seen), missing, dup)
        return out

    def run(self):
        self.untagged_last = []
        self.tie_report = []
        self.targets_dir = set()
        self.snap_report = []
        self.build_order()
        for q in self.qs:
            self.check_query(q)
        self.check_followups()
        self.check_misc()


# ------------------------------------------------------------------ TLC
def tla_seq(xs):
    return "<<" + ", ".join(str(x) for x in xs) + ">>"


def tlc_cases(ck):
    """The modelled queries on the TLC channel, mapped to History's vocabulary."""
    ch = low(ck.meta["channels"]["tlc"])
    cases = []
    full_O = ck.order[ch]
    for q in ck.qs:
        if low(q.get("chan") or "") != ch:
            continue
        w = q["cmd"].split()
        sub, lim = w[1].upper(), int(w[-1])
        if sub not in ("LATEST", "BEFORE") or (sub == "LATEST" and w[3] != "*"):
            continue
        rp = ck.reply(q)
        if rp["kind"] not in ("batch", "fail"):
            continue
        nmsg = q["known"].get(ch, 0)
        O = ck.store_at(ch, nmsg)
        live = nmsg == max(it.nmsg for it in full_O if it.kind == "msg") and any(
            it.kind == "msg" and it.text.endswith(" t5") for it in O)
        # ids: time order, ties by observation (TimeFns: ids non-decreasing in time)
        ids = sorted(O, key=lambda it: (it.ms, it.seq))
        idof = {it.key: k + 1 for k, it in enumerate(ids)}
        dist = sorted({it.ms for it in O})
        rank = {t: k + 1 for k, t in enumerate(dist)}
        times = [rank[it.ms] for it in ids]
        n = len(O)
        if live:
            # the live line must be the newest id and the newest in the order
            lv = [it for it in O if it.text and it.text.endswith(" t5")][0]
            if idof[lv.key] != n or O[-1] is not lv:
                continue
            ord0 = [idof[it.key] for it in O if it is not lv]
        else:
            ord0 = [idof[it.key] for it in O]
        if sub == "LATEST":
            qq = '[NoQ EXCEPT !.k = "latest", !.form = "star"]'
        else:
            s = ck.sel(w[3], O)
            if s[0] == "ts":
                tsv = sum(1 for t in dist if t < s[1]) + 1
                qq = f'[NoQ EXCEPT !.k = "before", !.form = "ts", !.ts = {tsv}]'
            elif s[0] == "id":
                qq = f'[NoQ EXCEPT !.k = "before", !.form = "msgid", !.sel = {idof[O[s[1]].key]}]'
            else:
                qq = f'[NoQ EXCEPT !.k = "before", !.form = "msgid", !.sel = {2 * n}]'
        page = []
        for m in rp["ms"]:
            it, _ = ck.resolve(m["tags"].get("msgid", ""))
            page.append(idof[it.key] if it is not None and it.key in idof else 2 * n)
        cases.append({"i": q["i"], "cmd": q["cmd"], "n": n, "live": live, "times": times, "ord": ord0,
                      "qq": qq, "page": page, "end": rp["end"], "fail": rp["kind"] == "fail",
                      "limit": lim, "maxt": len(dist) + 1})
    return cases


def tlc_controls(cases):
    """Tampered copies of real cases; each must be rejected (harness check)."""
    out = []
    pick = lambda f: next((c for c in cases if f(c)), None)
    c = pick(lambda c: "latest" in c["qq"] and len(c["page"]) >= 2 and not c["live"])
    if c:
        out.append(dict(c, page=c["page"][::-1], i=900001, cmd="CONTROL reversed batch: " + c["cmd"],
                        expect="M_strict NO MATCH (BatchAgrees)"))
    c = pick(lambda c: '"msgid", !.sel' in c["qq"] and len(c["page"]) >= 1 and int(c["qq"].split("!.sel = ")[1].rstrip("]")) <= c["n"])
    if c:
        sel = int(c["qq"].split("!.sel = ")[1].rstrip("]"))
        out.append(dict(c, page=c["page"] + [sel], i=900002, cmd="CONTROL anchor included: " + c["cmd"],
                        expect="I VIOLATES PageEligible"))
    c = pick(lambda c: "latest" in c["qq"] and not c["end"] and len(c["page"]) < c["n"] and c["page"])
    if c:
        out.append(dict(c, end=True, i=900003, cmd="CONTROL false end tag: " + c["cmd"],
                        expect="I VIOLATES EndNext/EndTruthful"))
    c = pick(lambda c: '"msgid", !.sel' in c["qq"] and not c["live"])
    if c:
        qq = c["qq"].split("!.sel = ")[0] + f"!.sel = {2 * c['n']}]"
        out.append(dict(c, qq=qq, page=[c["n"]], end=False, i=900004,
                        cmd="CONTROL unknown msgid answered with a line: " + c["cmd"],
                        expect="I VIOLATES (UnknownEmpty or PageEligible)"))
    c = pick(lambda c: "latest" in c["qq"] and len(c["page"]) >= 2 and len(c["page"]) < c["n"] and not c["live"])
    if c:
        hole = sorted(set(c["page"][1:]) | {min(c["page"]) - 1})
        out.append(dict(c, page=hole, i=900005, cmd="CONTROL hole in page: " + c["cmd"],
                        expect="M_strict NO MATCH (Contiguous)"))
    return out


def tlc_module(name, c):
    s0 = 1 if c["live"] else 0
    UNCH = "<<time, ord, liveSt, liveRel, s2c, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>"
    ans = (f'SrvFail /\\ s2c\'[Len(s2c\')].k = "fail"' if c["fail"] else
           f'SrvAnswer /\\ s2c\'[Len(s2c\')].ms = Page /\\ s2c\'[Len(s2c\')].end = {"TRUE" if c["end"] else "FALSE"}')
    inj = ("FALSE" if c["fail"] else
           f'/\\ s2c\' = Append(s2c, [k |-> "page", ms |-> Page, end |-> {"TRUE" if c["end"] else "FALSE"},\n'
           f'                          qq |-> q, el |-> Elig(q, ord), so |-> ord])\n'
           f'       /\\ q\' = NoQ\n'
           f'       /\\ UNCHANGED <<time, ord, liveSt, liveRel, buf, pgSeen, liveSeen, phase, anchor, pages, got, why, pg1, unkEmpty>>')
    live = (f"    \\/ ti = 0 /\\ StoreLive /\\ ti' = 1\n" if c["live"] else "")
    return f"""---- MODULE {name} ----
\\* {c['cmd']}  (observation #{c['i']})
EXTENDS History
VARIABLE ti
TimesV == 1..{c['maxt']}
T0 == {tla_seq(c['times'])}
O0 == {tla_seq(c['ord'])}
QQ == {c['qq']}
Page == {tla_seq(c['page'])}
TInit == time = T0 /\\ ord = O0 /\\ Init /\\ ti = 0
Ask == /\\ ti = {s0} /\\ q = NoQ /\\ q' = QQ /\\ ti' = {s0 + 1}
       /\\ UNCHANGED {UNCH}
MNext ==
{live}    \\/ Ask
    \\/ ti = {s0 + 1} /\\ {ans} /\\ ti' = {s0 + 2}
INext ==
{live}    \\/ Ask
    \\/ ti = {s0 + 1} /\\ ti' = {s0 + 2}
       {inj}
MSpec == TInit /\\ [][MNext]_<<vars, ti>>
ISpec == TInit /\\ [][INext]_<<vars, ti>>
TDone == ti = {s0 + 2}
NotDone == ~TDone
====
"""


def tlc_cfg(c, spec, strict=True):
    b = lambda v: "TRUE" if v else "FALSE"
    inv = "NotDone" if spec == "MSpec" else "PageEligible\n  UnknownEmpty\n  EndNext\n  EndTruthful"
    n = c["n"]
    return f"""SPECIFICATION {spec}
CONSTANTS
  Mode = "join"
  MayFail = TRUE
  NOld = 0
  NHeld = 0
  Holes = {{}}
  Skew = 0
  NGap = {n - (1 if c['live'] else 0)}
  LiveOn = {b(c['live'])}
  Times <- TimesV
  Fuzz = 0
  Limit = {c['limit']}
  BudgetKind = "pages"
  BudgetN = 1
  ExactCount = {b(strict)}
  Contiguous = {b(strict)}
  TimeOrdered = TRUE
  BatchAgrees = {b(strict)}
  StableAcrossReconnect = FALSE
  SendsEnd = TRUE
  Dedupe = TRUE
  MsgidAnchor = TRUE
  StopOnHeld = FALSE
  InsertMerge = TRUE
INVARIANT
  {inv}
CHECK_DEADLOCK FALSE
"""


def run_tlc(d, name, cfgname, timeout):
    try:
        p = subprocess.run(JAVA + ["-XX:+UseParallelGC", "-cp", JAR, "tlc2.TLC", "-workers", "1",
                                   "-metadir", os.path.join(d, "st-" + cfgname), "-config", cfgname + ".cfg",
                                   name + ".tla"], cwd=d, capture_output=True, text=True, timeout=timeout)
        out = p.stdout
    except subprocess.TimeoutExpired:
        return "TIMEOUT", None, ""
    st = re.findall(r"(\d+) distinct states found", out)
    states = int(st[-1]) if st else None
    return out, states, out


def tlc_one(args):
    c, work, timeout = args
    name = f"HSrv_{c['i']:04d}"
    d = os.path.join(work, name)
    os.makedirs(d, exist_ok=True)
    shutil.copy(MODEL, d)
    open(os.path.join(d, name + ".tla"), "w").write(tlc_module(name, c))
    res = {"i": c["i"], "cmd": c["cmd"], "page": len(c["page"]), "n": c["n"], "live": c["live"]}
    s0 = 1 if c["live"] else 0
    for tag, spec, strict in (("M_strict", "MSpec", True), ("I", "ISpec", True)):
        open(os.path.join(d, tag + ".cfg"), "w").write(tlc_cfg(c, spec, strict))
        out, states, _ = run_tlc(d, name, tag, timeout)
        open(os.path.join(d, tag + ".log"), "w").write(out)
        if out == "TIMEOUT":
            res[tag] = "TIMEOUT"
        elif spec == "MSpec":
            res[tag] = ("match" if "Invariant NotDone is violated" in out else
                        "NO MATCH" if "No error has been found" in out else "ERROR")
        else:
            v = re.findall(r"Invariant (\w+) is violated", out)
            res[tag] = (f"VIOLATES {v[0]}" if v else
                        ("holds" if states and states >= s0 + 3 else f"vacuous ({states} states)")
                        if "No error has been found" in out else "ERROR")
        res[tag + "_states"] = states
        if res[tag] == "ERROR":
            res[tag + "_err"] = (re.findall(r"Error:.*|Assumption.*|Attempted.*", out) or [out[-400:]])[:2]
    if res["M_strict"] == "NO MATCH":
        tag = "M_loose"
        open(os.path.join(d, tag + ".cfg"), "w").write(tlc_cfg(c, "MSpec", False))
        out, states, _ = run_tlc(d, name, tag, timeout)
        open(os.path.join(d, tag + ".log"), "w").write(out)
        res[tag] = ("TIMEOUT" if out == "TIMEOUT" else "match" if "Invariant NotDone is violated" in out
                    else "NO MATCH" if "No error has been found" in out else "ERROR")
        res[tag + "_states"] = states
    return res


def shape(cmd):
    """A query's shape: subcommand and selector kinds, e.g. BETWEEN msgid,ts."""
    if not cmd:
        return "-"
    w = cmd.split()
    if w[1].upper() == "TARGETS":
        return "TARGETS"
    return w[1].upper() + " " + ",".join(t.split("=")[0].replace("timestamp", "ts") for t in w[3:-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("obs")
    ap.add_argument("--tlc", metavar="WORKDIR")
    ap.add_argument("-j", type=int, default=2)
    ap.add_argument("--tlc-max-page", type=int, default=100,
                    help="run TLC locally only when the page has at most this many lines (History's "
                         "InOrd/Perms enumerate |page|^|page| functions)")
    ap.add_argument("--tlc-timeout", type=int, default=600)
    ap.add_argument("--json")
    a = ap.parse_args()
    recs = [json.loads(l) for l in open(a.obs)]
    ck = Checker(recs)
    ck.run()
    m = ck.meta
    print(f"server: {m['server_label']}  version: {m['version']}")
    print(f"caps: {' '.join(m['caps'])}")
    print(f"queries: {len(ck.qs)} ({sum(1 for q in ck.qs if q['followup_of'])} follow-ups)")
    print(f"events replayed in history (no event-playback) on: {sorted(ck.replayed_events)}")
    for ch, O in sorted(ck.order.items()):
        groups = defaultdict(list)
        for it in O:
            groups[it.ms].append(repr(it))
        ties = [g for g in groups.values() if len(g) > 1]
        print(f"ties {ch}: {ties}")
    for ch, srv, relay in ck.tie_report:
        print(f"order {ch}: server {srv}")
        if srv != relay:
            print(f"   querier's relay order differs: {relay}")
    print(f"untagged last pages (SendsEnd is a SHOULD): {len(ck.untagged_last)}")
    print(f"TARGETS order: {sorted(ck.targets_dir)}")
    for i, cmd, which, fails in ck.snap_report:
        print(f"racing query #{i} ({cmd}): fits the snapshot {which} the racing line was stored "
              f"(failed checks before/after: {fails})")
    for wk, (got, missing, dup) in sorted(ck.walks().items()):
        print(f"walk {wk}: {got} lines retrieved, missing {missing}, duplicates {dup}")
    print()
    print(f"{'property':10s} {'pass':>6s} {'fail':>6s} {'n/a':>6s}")
    for p in PROPS + sorted(set(ck.res) - set(PROPS)):
        r = ck.res[p]
        print(f"{p:10s} {r['pass']:6d} {r['fail']:6d} {r['na']:6d}")
    print()
    groups = defaultdict(list)
    for d in ck.dev:
        groups[(d["prop"], shape(d["cmd"]), d["class"])].append(d)
    for (p, sh, cls), ds in sorted(groups.items()):
        d = ds[0]
        print(f"[{p}] {sh}  x{len(ds)}  ({cls})")
        print(f"    e.g. #{d['i']} {d['cmd']}  [{d['note']}]")
        print(f"    expected: {d['expected']}")
        print(f"    observed: {d['observed']}")
    out = {"meta": {k: m[k] for k in ("server_label", "version", "caps", "runid")},
           "queries": len(ck.qs), "props": ck.res, "deviations": ck.dev,
           "untagged_last": ck.untagged_last, "events_replayed": sorted(ck.replayed_events)}
    if a.tlc:
        work = os.path.abspath(a.tlc)
        os.makedirs(work, exist_ok=True)
        cases = tlc_cases(ck) + tlc_controls(tlc_cases(ck))
        small = [c for c in cases if len(c["page"]) <= a.tlc_max_page]
        big = [c for c in cases if len(c["page"]) > a.tlc_max_page]
        print(f"\nTLC: {len(cases)} modelled queries on {m['channels']['tlc']}; running {len(small)} "
              f"(page <= {a.tlc_max_page}); {len(big)} left for the cluster")
        with ThreadPoolExecutor(a.j) as ex:
            rs = sorted(ex.map(tlc_one, [(c, work, a.tlc_timeout) for c in small]), key=lambda r: r["i"])
        for c in big:
            name = f"HSrv_{c['i']:04d}"
            d = os.path.join(work, name)
            os.makedirs(d, exist_ok=True)
            shutil.copy(MODEL, d)
            open(os.path.join(d, name + ".tla"), "w").write(tlc_module(name, c))
            for tag, spec, strict in (("M_strict", "MSpec", True), ("I", "ISpec", True), ("M_loose", "MSpec", False)):
                open(os.path.join(d, tag + ".cfg"), "w").write(tlc_cfg(c, spec, strict))
        for r in rs:
            if r["i"] >= 900000:
                r["expect"] = next(c["expect"] for c in cases if c["i"] == r["i"])
            print(f"  #{r['i']:4d} n={r['n']} page={r['page']} live={int(r['live'])} M_strict={r['M_strict']}"
                  f"({r['M_strict_states']}) I={r['I']}({r['I_states']})"
                  + (f" M_loose={r['M_loose']}" if "M_loose" in r else "") + f"  {r['cmd']}" + (f"   [expected: {r['expect']}]" if "expect" in r else ""))
        for c in big:
            print(f"  #{c['i']:4d} n={c['n']} page={len(c['page'])} NOT RUN (cluster)  {c['cmd']}")
        out["tlc"] = {"ran": rs, "cluster": [{"i": c["i"], "cmd": c["cmd"], "page": len(c["page"])} for c in big]}
        json.dump(rs, open(os.path.join(work, "summary.json"), "w"), indent=1)
    if a.json:
        json.dump(out, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
