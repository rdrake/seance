#!/usr/bin/env python3
"""Check delivery-client observations against Delivery.tla (v2.2).

Usage: check_delivery.py OBS.jsonl WORKDIR [-j N] [--module M] [--configs FD,..]

For each observed scenario run (SCHEMA.md) two checks:

1. Refinement (TLC).  The scenario's wire is replayed through the model's
   client under each switch setting (F = Fallback, D = Deferred; default all
   four).  A trace module pins the sends, injects each server line, lets the
   model's client read it, and after every step compares the model's outcome
   of each request with the observed one (invariant SnapOK).  NotStuck fails
   when a step the scenario needs is not enabled.  A setting "matches" when
   TLC finds no violation.  --module runs the same against a mutant.

2. Properties (here, on the observation and the scenario's ghosts).  Which
   line or event moved each request out of pending, and was that allowed:
   ConfirmedByOwn, OutcomeMatchesCause, SameKind, HistoryNeverSettles,
   NoCrossFromTimedOut, Absorbing, and "resolved" (a guaranteed scenario
   leaves nothing pending).

Writes WORKDIR/summary.json and prints one line per observation.
"""
import json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
JAR = os.environ.get("TLA_JAR", os.path.expanduser("~/tools/formal/tla2tools.jar"))
JAVA = os.environ.get("TLC_JAVA", "java").split()
if os.environ.get("TLC_XMX"):
    JAVA = JAVA + ["-Xmx" + os.environ["TLC_XMX"]]

VARS = ["sent", "pend", "pendTxt", "pendTgt", "pendCmd", "order", "ob", "buf", "closed", "owed",
        "out", "late", "lateUsed", "s2c", "nextRef", "otherDone", "histDone", "hout", "closeBuf",
        "labeledN", "firstK", "compet", "by", "cause", "role", "modConf", "early", "crossTimed",
        "crossDeliv", "histSettled", "kindCross"]

def s(x): return '"%s"' % x

def lab(v):                       # scenario label placeholder -> model label
    return "l" + v[1:] if v.startswith("L") else v

def who(v):
    return "l%d" % v if isinstance(v, int) else v

def line_tla(m, refmap):
    r = lambda x: refmap.get(x, 0) if x else 0
    return "Ln(%s, %s, %s, %s, %s, %d, %d, %s, %s, %s)" % (
        s(m["k"]), s(lab(m["lab"])), s(m["txt"]), s(m["tgt"]), s(m["cmd"]),
        r(m["id"]), r(m["ref"]), s(m["bt"]), s(who(m["who"])), s(m["role"]))

def micro(sc):
    """Expand scenario steps into model steps; map each to its scenario step."""
    refs = sorted({st["line"]["m"][f] for st in sc["steps"] if "line" in st
                   for f in ("id", "ref") if st["line"]["m"][f]})
    refmap = {x: i + 1 for i, x in enumerate(refs)}
    out = []                      # (tla step, scenario step index or None)
    for j, st in enumerate(sc["steps"]):
        if "send" in st:
            p = st["send"]
            out.append(('[kind |-> "send", i |-> %d, t |-> %s, g |-> %s, c |-> %s]'
                        % (p["i"], s(p["txt"]), s(p["tgt"]), s(p["cmd"])), j))
        elif "line" in st:
            out.append(('[kind |-> "inject", ln |-> %s]' % line_tla(st["line"]["m"], refmap), None))
            out.append(('[kind |-> "recv"]', j))
        elif "timeout" in st:
            out.append(('[kind |-> "timeout", i |-> %d]' % st["timeout"], j))
        elif "close" in st:
            out.append(('[kind |-> "close"]', j))
    return out, refmap

def module(name, base, sc, obs):
    steps, refmap = micro(sc)
    snaps = {x["after"]: x["out"] for x in obs["snap"]}
    rows = []
    for _, j in steps:
        o = snaps.get(j) if j is not None else None
        if o is None:
            rows.append("[skip |-> TRUE]")
        else:
            rows.append("[skip |-> FALSE, o |-> [%s]]" % ", ".join(
                "l%s |-> %s" % (i, s(v)) for i, v in sorted(o.items())))
    nsend = sum(1 for st in sc["steps"] if "send" in st)
    others = ", ".join(v for v in VARS if v != "s2c")
    return nsend, len(refmap), """---- MODULE %s ----
EXTENDS %s
VARIABLE k
Lab(i) == IF i = 1 THEN "l1" ELSE IF i = 2 THEN "l2" ELSE "l3"
W == << %s >>
Obs == << %s >>
TInit == Init /\\ k = 0
Step(st) ==
    CASE st.kind = "send" -> CSend(st.t, st.g, st.c) /\\ sent'[Len(sent')].lab = Lab(st.i)
      [] st.kind = "inject" -> s2c' = Append(s2c, st.ln) /\\ UNCHANGED <<%s>>
      [] st.kind = "recv" -> CRecv
      [] st.kind = "timeout" -> CTimeout(Lab(st.i))
      [] OTHER -> CClose
TNext == k < Len(W) /\\ k' = k + 1 /\\ Step(W[k + 1])
SnapOK == k = 0 \\/ Obs[k].skip \\/ \\A f \\in DOMAIN Obs[k].o : pend[f] = Obs[k].o[f]
NotStuck == k = Len(W) \\/ ENABLED TNext
====
""" % (name, base, ",\n       ".join(t for t, _ in steps), ",\n         ".join(rows), others)

def cfg(nsend, nref, F, D):
    return """INIT TInit
NEXT TNext
CONSTANTS
  Labels = {"l1", "l2", "l3"}
  Texts = {"a", "b"}
  MaxReq = %d
  MaxLate = 2
  Lossy = TRUE
  Deferred = %s
  Fallback = %s
  OtherSession = TRUE
  SelfMsg = TRUE
  TimeoutOn = TRUE
  Competing = TRUE
  CloseOn = TRUE
  History = TRUE
  Notice = TRUE
  Modify = TRUE
INVARIANTS SnapOK NotStuck
CHECK_DEADLOCK FALSE
""" % (max(nsend, (nref + 1) // 2), "TRUE" if D else "FALSE", "TRUE" if F else "FALSE")

def run_tlc(wd, name):
    p = subprocess.run(JAVA + ["-XX:+UseParallelGC", "-cp", JAR, "tlc2.TLC", "-workers", "1",
                               "-metadir", os.path.join(wd, "st-" + name), "-config", name + ".cfg",
                               name + ".tla"], cwd=wd, capture_output=True, text=True)
    o = p.stdout + p.stderr
    open(os.path.join(wd, name + ".log"), "w").write(o)
    if "No error has been found" in o:
        return "match", None
    m = re.search(r"Invariant (\w+) is violated", o)
    if m:
        ks = re.findall(r"^/\\ k = (\d+)", o, re.M)
        return "diverges", "%s at model step %s" % (m.group(1), ks[-1] if ks else "?")
    return "error", (re.findall(r"^(?:Error|Semantic|Parse).*$", o, re.M) or ["?"])[0]

# --- properties on the observation -------------------------------------------
def batch_cause(sc, j, i):
    """For a root batch closed at step j: its first settling line answering i,
    else its first settling line (D2: deferred processing at the root's end)."""
    end = sc["steps"][j]["line"]["m"]
    if end["ref"]:
        return None
    inside, open_ = [], {end["id"]}
    start = max(x for x in range(j) if "line" in sc["steps"][x]
                and sc["steps"][x]["line"]["m"]["k"] == "bstart" and sc["steps"][x]["line"]["m"]["id"] == end["id"])
    for st in sc["steps"][start + 1:j]:
        if "line" not in st:
            continue
        m = st["line"]["m"]
        if m["ref"] in open_:
            if m["k"] == "bstart":
                open_.add(m["id"])
            elif m["k"] in ("echo", "ack", "fail", "err"):
                inside.append(m)
    own = [m for m in inside if m["who"] == i]
    return (own or inside or [None])[0]


def properties(sc, obs):
    sends = {st["send"]["i"]: st["send"] for st in sc["steps"] if "send" in st}
    snaps = {x["after"]: x["out"] for x in obs["snap"]}
    prev, viol, timed = {}, [], set()
    for j, st in enumerate(sc["steps"]):
        cur = snaps.get(j, prev)
        for i_, v in cur.items():
            i = int(i_)
            was = prev.get(i_, "pending")
            if was != "pending" and v != was:
                viol.append("Absorbing: request %d %s -> %s at step %d" % (i, was, v, j))
            if was == "pending" and v != "pending":
                if "line" in st:
                    m = st["line"]["m"]
                    if m["k"] == "bend":      # Deferred: the batch's buffered lines settle at its end
                        m = batch_cause(sc, j, i) or m
                    if v == "confirmed":
                        if m["k"] != "echo":
                            viol.append("OutcomeMatchesCause: %d confirmed by a %s line (step %d)" % (i, m["k"], j))
                        if m["who"] != i:
                            viol.append("ConfirmedByOwn: %d confirmed by a %s line answering %s (step %d)"
                                        % (i, m["role"], m["who"], j))
                        if m["cmd"] != sends[i]["cmd"]:
                            viol.append("SameKind: %s %d confirmed by a %s (step %d)" % (sends[i]["cmd"], i, m["cmd"], j))
                    if v == "failed" and m["k"] not in ("fail", "err"):
                        viol.append("OutcomeMatchesCause: %d failed by a %s line (step %d)" % (i, m["k"], j))
                    if v == "accepted" and m["k"] != "ack":
                        viol.append("OutcomeMatchesCause: %d accepted by a %s line (step %d)" % (i, m["k"], j))
                    if v == "timedout":
                        viol.append("OutcomeMatchesCause: %d timed out on a line (step %d)" % (i, j))
                    if m["role"] == "hist":
                        viol.append("HistoryNeverSettles: %d settled by history (step %d)" % (i, j))
                    if m["role"] == "late" and m["who"] != i and m["who"] in timed:
                        viol.append("NoCrossFromTimedOut: %d settled by %s's late echo (step %d)" % (i, m["who"], j))
                elif "timeout" in st:
                    if st["timeout"] != i:
                        viol.append("OutcomeMatchesCause: %d settled by %d's timeout" % (i, st["timeout"]))
                    elif v != "timedout":
                        viol.append("OutcomeMatchesCause: %d %s on its timeout" % (i, v))
                elif "close" in st and v not in ("failed",):
                    viol.append("OutcomeMatchesCause: %d %s on close" % (i, v))
                elif "send" in st:
                    viol.append("%d settled when %d was sent" % (i, st["send"]["i"]))
            if v == "timedout":
                timed.add(i)
        prev = cur
    if sc["tag"] == "guaranteed":
        left = [i for i, v in prev.items() if v == "pending"]
        if left:
            viol.append("Resolved: %s still pending at the end" % ",".join(left))
    return viol

def main():
    obsf, wd = sys.argv[1], sys.argv[2]
    j = int(sys.argv[sys.argv.index("-j") + 1]) if "-j" in sys.argv else 4
    base = sys.argv[sys.argv.index("--module") + 1] if "--module" in sys.argv else "Delivery"
    confs = (sys.argv[sys.argv.index("--configs") + 1].split(",") if "--configs" in sys.argv
             else ["F0D0", "F0D1", "F1D0", "F1D1"])
    os.makedirs(wd, exist_ok=True)
    scen = {json.loads(l)["name"]: json.loads(l) for l in open(os.path.join(HERE, "scenarios.jsonl"))}
    obs = [json.loads(l) for l in open(obsf) if l.strip()]
    jobs, res = [], []
    for o in obs:
        if o.get("skipped"):
            res.append({"name": o["name"], "skipped": o["skipped"]})
            continue
        sc = scen[o["name"]]
        r = {"name": o["name"], "tag": sc["tag"], "props": properties(sc, o), "refine": {}}
        res.append(r)
        for c in confs:
            F, D = c[1] == "1", c[3] == "1"
            name = "DT_%s_%s_%s" % (re.sub(r"\W", "_", o["name"]), c, base)
            nsend, nref, text = module(name, base, sc, o)
            open(os.path.join(wd, name + ".tla"), "w").write(text)
            open(os.path.join(wd, name + ".cfg"), "w").write(cfg(nsend, nref, F, D))
            jobs.append((r, c, name))
    with ThreadPoolExecutor(j) as ex:
        for (r, c, name), v in zip(jobs, ex.map(lambda x: run_tlc(wd, x[2]), jobs)):
            r["refine"][c] = v
    json.dump(res, open(os.path.join(wd, "summary.json"), "w"), indent=1)
    for r in res:
        if "skipped" in r:
            print("%-18s skipped (%s)" % (r["name"], r["skipped"]))
            continue
        m = [c for c, v in r["refine"].items() if v[0] == "match"]
        print("%-18s %-11s match=%s  props=%s" % (r["name"], r["tag"], ",".join(m) or "-",
                                                 "; ".join(r["props"]) or "ok"))

if __name__ == "__main__":
    main()
