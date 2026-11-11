#!/usr/bin/env python3
"""TLC trace check of catch-up fixture observations against History.tla (D30).

  history_trace.py OBS.jsonl WORKDIR [-j N]

OBS.jsonl is catchup_fixtures.py's output for one checkout.  For each fixture
a module HT_<name> EXTENDS History with Init pinned (ids in time order, times
as ranks of the fixture's minutes, ord the store order) and a step sequence W
built from the fixture's wire template and the observed requests:

  Q  the client's next observed CHATHISTORY request (CQuery with that query)
  A  the server answers with the fixture's next page (SrvAnswer, page pinned)
  S  StoreLive    R  RelayLive    C  CRecv (the client reads the next item)

A Q with no observed request left drops itself and its page's A and C: the
client stopped there.  Invariants:
  NotStuck  every step of W is enabled: the model's client makes the same
            request, and the model's server can give that page
  SnapOK    after the last step the model's client is done and its buffer is
            Seance's store (the fixture's server-stamped rows, in order)

Needs History.tla in WORKDIR's parent model dir (MODEL_DIR, default ../model
next to this file's wip copy) and TLA_JAR / TLC_JAVA as check_delivery.py.
Writes WORKDIR/summary.txt.
"""
import json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from catchup_fixtures import FIXTURES  # noqa: E402

JAR = os.environ.get("TLA_JAR", os.path.expanduser("~/tools/formal/tla2tools.jar"))
JAVA = os.environ.get("TLC_JAVA", "java").split()

BASE = dict(Mode='"reconnect"', MayFail="FALSE", Fuzz=0, BudgetKind='"pages"', BudgetN=5,
            ExactCount="TRUE", Contiguous="TRUE", TimeOrdered="TRUE", BatchAgrees="TRUE",
            StableAcrossReconnect="TRUE", SendsEnd="FALSE", Dedupe="TRUE", MsgidAnchor="TRUE",
            StopOnHeld="TRUE", InsertMerge="TRUE")


def build(fx, obs):
    held = [m for m, _ in fx["held"]]
    gap = fx["gap"]
    live = fx.get("live")
    names = held + gap + ([live[0]] if live else [])
    mins = {}
    for m, t in fx["held"]:
        mins[m] = t
    for page in fx["pages"]:
        for m, t in page:
            mins[m] = t
    if live:
        mins[live[0]] = live[1]
    num = {m: i + 1 for i, m in enumerate(names)}          # ids in store (time) order
    ranks = {t: i + 1 for i, t in enumerate(sorted(set(mins.values())))}
    times = [ranks[mins[m]] for m in names]
    assert times == sorted(times), "fixture ids must follow time order"

    reqs = list(obs["requests"])
    pages = list(fx["pages"])
    steps, notes = [], []
    toks = fx["wire"].split()
    i = 0
    while i < len(toks):
        t = toks[i]
        if t == "Q":
            if not reqs:
                # the client sent nothing here: drop this page's A and C
                j = i + 1
                dropped = 0
                while j < len(toks) and dropped < 2 and toks[j] in ("A", "C"):
                    dropped += 1
                    j += 1
                pages = pages[1:] if pages else pages
                i = j
                continue
            r = reqs.pop(0)
            mm = re.match(r"CHATHISTORY (LATEST|BEFORE) #seance (\S+) (\d+)$", r)
            if not mm or int(mm.group(3)) != fx["limit"]:
                notes.append("request not modelled: " + r)
                break
            if mm.group(1) == "LATEST" and mm.group(2) == "*":
                steps.append('[a |-> "Q", form |-> "star", sel |-> 0]')
            elif mm.group(1) == "BEFORE" and mm.group(2).startswith("msgid="):
                steps.append('[a |-> "Q", form |-> "msgid", sel |-> %d]' % num[mm.group(2)[6:]])
            else:
                notes.append("selector not modelled: " + r)
                break
        elif t == "A":
            page = pages.pop(0)
            steps.append('[a |-> "A", ms |-> <<%s>>]' % ", ".join(str(num[m]) for m, _ in page))
        else:
            steps.append('[a |-> "%s"]' % t)
        i += 1
    if reqs:
        notes.append("requests past the template: %s" % reqs)

    final = [num[r["msgid"]] for r in obs["store"]
             if r["msgid"] and r["msgid"] in num]
    consts = dict(BASE, NHeld=len(held), NGap=len(gap), LiveOn="TRUE" if live else "FALSE",
                  Times="{%s}" % ", ".join(str(x) for x in sorted(set(times))), Limit=fx["limit"])
    consts.update(fx.get("model", {}))
    name = "HT_" + fx["name"]
    tla = """---- MODULE %s ----
EXTENDS History
VARIABLE k
W == << %s >>
FT == <<%s>>
FinalBuf == <<%s>>
TInit == Init /\\ time = [x \\in Ids |-> FT[x]] /\\ ord = [x \\in 1..NStored |-> x] /\\ k = 0
Step(s) ==
    CASE s.a = "Q" -> CQuery /\\ q'.form = s.form /\\ (s.form = "msgid" => q'.sel = s.sel)
      [] s.a = "A" -> SrvAnswer /\\ s2c'[Len(s2c')].ms = s.ms /\\ ~s2c'[Len(s2c')].end
      [] s.a = "S" -> StoreLive
      [] s.a = "R" -> RelayLive
      [] s.a = "C" -> CRecv
TNext == k < Len(W) /\\ k' = k + 1 /\\ Step(W[k + 1])
NotStuck == k = Len(W) \\/ ENABLED TNext
SnapOK == k = Len(W) => (Done /\\ buf = FinalBuf)
====
""" % (name, ",\n      ".join(steps), ", ".join(str(x) for x in times), ", ".join(str(x) for x in final))
    cfg = "INIT TInit\nNEXT TNext\nCONSTANTS\n" + "".join("  %s = %s\n" % kv for kv in consts.items()) + \
          "INVARIANTS NotStuck SnapOK\nCHECK_DEADLOCK FALSE\n"
    return name, tla, cfg, notes


def run(wd, name):
    p = subprocess.run(JAVA + ["-XX:+UseParallelGC", "-cp", JAR, "tlc2.TLC", "-workers", "1",
                               "-metadir", os.path.join(wd, "st-" + name), "-config", name + ".cfg",
                               name + ".tla"], cwd=wd, capture_output=True, text=True)
    open(os.path.join(wd, name + ".log"), "w").write(p.stdout + p.stderr)
    m = re.search(r"Invariant (\w+) is violated", p.stdout)
    if m:
        return "FAIL " + m.group(1)
    if "No error has been found" in p.stdout:
        return "PASS"
    return "ERROR (see %s.log)" % name


def main():
    obsf, wd = sys.argv[1], sys.argv[2]
    j = int(sys.argv[sys.argv.index("-j") + 1]) if "-j" in sys.argv else 4
    os.makedirs(wd, exist_ok=True)
    model = os.environ.get("MODEL_DIR", os.path.join(HERE, "..", "wip", "history", "model"))
    open(os.path.join(wd, "History.tla"), "w").write(open(os.path.join(model, "History.tla")).read())
    obs = {o["name"]: o for o in map(json.loads, open(obsf)) if "requests" in o}
    jobs = []
    for fx in FIXTURES:
        if fx["name"] not in obs:
            continue
        name, tla, cfg, notes = build(fx, obs[fx["name"]])
        open(os.path.join(wd, name + ".tla"), "w").write(tla)
        open(os.path.join(wd, name + ".cfg"), "w").write(cfg)
        jobs.append((fx["name"], name, notes))
    with ThreadPoolExecutor(j) as ex:
        res = list(ex.map(lambda t: run(wd, t[1]), jobs))
    lines = ["%-16s %s%s" % (n, r, ("  [" + "; ".join(notes) + "]") if notes else "")
             for (n, _, notes), r in zip(jobs, res)]
    open(os.path.join(wd, "summary.txt"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
