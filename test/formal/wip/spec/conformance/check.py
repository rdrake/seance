#!/usr/bin/env python3
"""Trace validation: is each recorded run (drive.py) a behaviour of the spec
model?  For every trace this writes a module that EXTENDS SpecHandshake,
pins Init to the run's environment, and constrains Next so that every line
the server sends is the next observed server line and every client line is
the next recorded client line, sent after the client has read exactly the
lines it had read on the wire.  TLC then looks for a state where the whole
run has been reproduced and the server owes nothing more (no fair server
action enabled).  Reaching it = the run is a model behaviour.

Each trace is checked with Reauth = FALSE and TRUE; every other switch is
set to its most permissive value.

Usage: check.py traces.jsonl WORKDIR [-j N]
"""
import json, os, re, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "..", "model", "SpecHandshake.tla")
JAR = os.environ.get("TLA_JAR", os.path.expanduser("~/tools/formal/tla2tools.jar"))
# On the cluster: TLC_JAVA="apptainer exec --bind /project temurin21.sif java"
JAVA = os.environ.get("TLC_JAVA", "java").split()
# Heap per TLC run (one per trace, -j at a time): TLC_XMX="3g" on the cluster.
if os.environ.get("TLC_XMX"):
    JAVA = JAVA + ["-Xmx" + os.environ["TLC_XMX"]]


def tset(caps):
    return "{" + ", ".join(f'"{c}"' for c in caps) + "}"


def tmsg(m):
    return f'Msg("{m["t"]}", {tset(m.get("caps", []))}, {"TRUE" if m.get("more") else "FALSE"})'


def module(name, tr):
    e = tr["env"]
    b = lambda v: "TRUE" if v else "FALSE"
    # dropAt k (drive.py --services): the services link went after the k-th
    # model server line, so every later line is sent with sasl withdrawn
    # (S2-1, CN-21): a server that sends no DEL diverges right there.
    k = tr.get("dropAt")
    droppin = "" if k is None else (
        f"    /\\ (ti' > {k}) => (\"sasl\" \\notin srv'.offered)\n")
    # env None (irctest traces): every allowed environment is tried.
    envpin = "" if e is None else (
        f'    /\\ env = [creds |-> {b(e["creds"])}, wantSasl |-> {b(e["wantSasl"])},\n'
        f'              required |-> {b(e["required"])}, svcOk |-> {b(e["svcOk"])}]\n')
    obs = ",\n    ".join(tmsg(m) for m in tr["obs"])
    cli = ",\n    ".join(f'[m |-> {tmsg(c["m"])}, r |-> {c["r"]}]' for c in tr["cli"])
    return f"""---- MODULE {name} ----
EXTENDS SpecHandshake
VARIABLES ti, cj, rd
tv == <<vars, ti, cj, rd>>
Obs == <<
    {obs}
>>
Cl == <<
    {cli}
>>
TInit ==
    /\\ Init
{envpin}    /\\ srv.offered = {tset(tr["offered"])}
    /\\ ti = 0 /\\ cj = 0 /\\ rd = 0
TNext ==
    /\\ Next
    /\\ Len(NewOut) <= Len(Obs) - ti
    /\\ \\A k \\in 1..Len(NewOut) : NewOut[k] = Obs[ti + k]
    /\\ ti' = ti + Len(NewOut)
    /\\ rd' = rd + (IF Len(s2c') < Len(s2c) THEN 1 ELSE 0)
    /\\ Len(NewC2S) <= Len(Cl) - cj
    /\\ \\A k \\in 1..Len(NewC2S) : NewC2S[k] = Cl[cj + k].m /\\ Cl[cj + k].r = rd'
    /\\ cj' = cj + Len(NewC2S)
{droppin}TSpec == TInit /\\ [][TNext]_tv
\\* The server owes nothing: no action it must eventually take is enabled.
Settled == ~ENABLED (SRecv \\/ SrvSend \\/ SrvLsRest \\/ SrvChallenge \\/ SrvAnswer \\/ SrvAckRest
                     \\/ SrvDecide \\/ Srv900 \\/ Srv903 \\/ SrvRegister \\/ Srv001)
\\* NRead: lines the client read (fewer than Obs when it quit and the server
\\* sent more).
Done == ti = Len(Obs) /\\ cj = Len(Cl) /\\ rd = {tr.get("nread", len(tr["obs"]))} /\\ Settled
NotDone == ~Done
\\* How far a failing trace gets: the longest observed prefix reproduced.
====
"""


def cfg(reauth, tr):
    nreq = sum(1 for c in tr["cli"] if c["m"]["t"] == "REQ")
    natt = sum(1 for c in tr["cli"] if c["m"]["t"] == "AUTHMECH")
    return f"""SPECIFICATION TSpec
CONSTANTS
  MaxReq = {max(nreq, 1)}
  MaxSasl = {max(natt, 1)}
  MaxEnv = {max(sum(1 for m in tr["obs"] if m["t"] in ("NEW", "DEL")), 1 if tr.get("dropAt") is not None else 0)}
  MultiLine = TRUE
  ArbitraryNak = TRUE
  Reauth = {"TRUE" if reauth else "FALSE"}
  AbortOnReg = FALSE
  LsCapNotify = TRUE
  ReqCapNotify = TRUE
  ReorderReplies = TRUE
  OtherCaps = {tset(tr.get("other", ["a"]))}
INVARIANT NotDone
CHECK_DEADLOCK FALSE
"""


def frontier(d, name, tr):
    """Rerun with -dump and find the furthest reproduced prefix.  Returns
    where it stopped and whose move could not be made:
      server   - the client was waiting for Obs[ti+1] and no model server
                 step emits it (a server divergence or a model gap);
      client   - the client had read every line its next line needed and
                 the model client cannot send it (client outside the model);
      settle   - the whole run is reproduced but the model server still owes
                 something (the run stopped before the server finished)."""
    subprocess.run(JAVA + ["-XX:+UseParallelGC", "-cp", JAR, "tlc2.TLC", "-workers", "1",
                    "-metadir", os.path.join(d, "st2"), "-dump", os.path.join(d, "states"),
                    "-config", name + ".cfg", name + ".tla"], cwd=d, capture_output=True, text=True)
    txt = open(os.path.join(d, "states.dump")).read()
    best = None
    for blk in txt.split("State ")[1:]:
        g = {k: int(v) for k, v in re.findall(r"/\\ (ti|cj|rd) = (\d+)", blk)}
        if len(g) == 3:
            key = (g["ti"] + g["cj"], g["rd"])
            if best is None or key > best[0]:
                best = (key, g)
    if best is None:
        return {"who": "init", "ti": 0, "cj": 0, "nextObs": "-", "nextCli": "-"}
    g = best[1]
    obs, cl = tr["obs"], tr["cli"]
    ti, cj, rd = g["ti"], g["cj"], g["rd"]
    if ti == len(obs) and cj == len(cl):
        who = "settle"
    elif cj < len(cl) and cl[cj]["r"] <= ti:
        who = "client"
    else:
        who = "server"
    nxt_s = obs[ti]["t"] + str(obs[ti].get("caps") or "") if ti < len(obs) else "-"
    nxt_c = cl[cj]["m"]["t"] + str(cl[cj]["m"].get("caps") or "") if cj < len(cl) else "-"
    return {"who": who, "ti": ti, "cj": cj, "nextObs": nxt_s, "nextCli": nxt_c}


def check_one(args):
    i, tr, work = args
    res, diag = {}, {}
    for reauth in (False, True):
        d = os.path.join(work, f"t{i:03d}_{int(reauth)}")
        os.makedirs(d, exist_ok=True)
        shutil.copy(MODEL, d)
        name = f"T{i:03d}"
        open(os.path.join(d, name + ".tla"), "w").write(module(name, tr))
        open(os.path.join(d, name + ".cfg"), "w").write(cfg(reauth, tr))
        out = subprocess.run(JAVA + ["-XX:+UseParallelGC", "-cp", JAR, "tlc2.TLC", "-workers", "1",
                              "-metadir", os.path.join(d, "st"), "-config", name + ".cfg", name + ".tla"],
                             cwd=d, capture_output=True, text=True).stdout
        open(os.path.join(d, "tlc.log"), "w").write(out)
        if "Invariant NotDone is violated" in out:
            res[reauth] = "match"
        elif "No error has been found" in out:
            res[reauth] = "NO MATCH"
            diag[reauth] = frontier(d, name, tr)
        else:
            res[reauth] = "ERROR: " + (re.findall(r"Error:.*", out) or [out[-300:]])[0]
    return i, tr["name"], res, diag


def main():
    traces = [json.loads(l) for l in open(sys.argv[1])]
    work = os.path.abspath(sys.argv[2])
    j = int(sys.argv[sys.argv.index("-j") + 1]) if "-j" in sys.argv else 4
    os.makedirs(work, exist_ok=True)
    with ThreadPoolExecutor(j) as ex:
        results = sorted(ex.map(check_one, [(i, t, work) for i, t in enumerate(traces)]))
    summary = []
    for i, name, res, diag in results:
        verdict = ("match" if "match" in res.values() else
                   "error" if any(v.startswith("ERROR") for v in res.values()) else "DIVERGES")
        dg = diag.get(False) if verdict == "DIVERGES" else None
        summary.append({"i": i, "name": name, "reauthFalse": res[False], "reauthTrue": res[True],
                        "verdict": verdict, "frontier": diag})
        extra = f"  stuck({dg['who']}) at obs {dg['ti']}/cli {dg['cj']}: next {dg['nextObs']} / {dg['nextCli']}" if dg else ""
        print(f"{i:3d} {verdict:8s} R=F:{res[False]:9s} R=T:{res[True]:9s} {name}{extra}")
    json.dump(summary, open(os.path.join(work, "summary.json"), "w"), indent=1)
    n = len(summary)
    print(f"{n} traces: {sum(s['verdict'] == 'match' for s in summary)} match, "
          f"{sum(s['verdict'] == 'DIVERGES' for s in summary)} diverge, "
          f"{sum(s['verdict'] == 'error' for s in summary)} errors")
    # A server must fit one Reauth setting across all its runs.
    for k in ("reauthFalse", "reauthTrue"):
        print(f"  {k}: {sum(s[k] == 'match' for s in summary)}/{n} match")


if __name__ == "__main__":
    main()
