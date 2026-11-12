#!/usr/bin/env python3
"""TLC trace check of Seance's reconnect / STS observations against StsReconnect.tla (D14).

  trace_check.py OBS.jsonl WORKDIR

OBS.jsonl is drive.ts's output. For each scenario, a module RT_<name> EXTENDS
StsReconnect with the real-scale schedule, the server's starting state pinned,
and a step sequence: one Tick per second between events, then the model
action each event names (dial with its scheme, port and outcome; ls; upgrade
with what the plain socket carried; drop, throttle, disconnect, new; env
changes), with the policy entry the store held after it. The invariant
NotDone (i < Len) must be VIOLATED: the model can follow the whole trace.
When it cannot, the longest prefix it can follow is found by bisection and
the first step it cannot take is reported.

Each scenario is checked twice: under the spec-conforming switches and with
every Seance* switch on. Needs ../model/StsReconnect.tla; TLA_JAR as in the
other models' checkers (default ~/tools/formal/tla2tools.jar).
Writes WORKDIR/summary.txt.
"""
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, '..', 'model')
JAR = os.environ.get('TLA_JAR', os.path.expanduser('~/tools/formal/tla2tools.jar'))
REAL = dict(Init=1, Cap=60, NQuick=3, Unreached=42, UJit=5, Stable=30, Throttle=42, Window=40,
            IpLimit=4, IpCountRefusals='TRUE')
SW = ['SeanceRetry', 'SeanceStsAfterCaps', 'SeanceReschedule']
S = lambda xs: '{' + ', '.join('"%s"' % x for x in xs) + '}'


def rec(k, n='none', tls=False, port='none', st='none', how='none', sent=(), pol=None,
        what='none', ival=0, sval='none', bval=False):
    pc = pol is not None
    pol = pol or {'has': False}
    return ('[k |-> "%s", n |-> "%s", tls |-> %s, port |-> "%s", st |-> "%s", how |-> "%s", '
            'sent |-> %s, pc |-> %s, phas |-> %s, pport |-> "%s", pexp |-> %d, what |-> "%s", '
            'ival |-> %d, sval |-> "%s", bval |-> %s]'
            % (k, n, B(tls), port, st, how, S(sent), B(pc), B(pol['has']), pol.get('port', 'none'),
               pol.get('exp', 0), what, ival, sval, B(bval)))


B = lambda b: 'TRUE' if b else 'FALSE'


def steps(sc):
    """(record, description) per model step."""
    out, now = [], 0
    init = sc['init']
    if not init['up']:
        out.append((rec('env', what='net', bval=False), 'env net down (start)'))
    for p in ('S1', 'S2'):
        if p not in init['secUp']:
            out.append((rec('env', what='port', sval=p, bval=False), 'env %s down (start)' % p))
    evs = sc['events']
    for j, e in enumerate(evs):
        if e['k'] == 'result':
            continue
        while now < e['t']:
            out.append((rec('tick'), 'tick to %d' % (now + 1)))
            now += 1
        n, k = e.get('n', 'none'), e['k']
        d = '%s %s@%d' % (k, n, e['t'])
        if k == 'dial':
            res = next(r for r in evs[j + 1:] if r['k'] == 'result' and r['n'] == n)
            r = rec('dial', n, e['tls'], e['port'], 'open' if res['open'] else 'wait',
                    e.get('how', 'none'), pol=res['pol'])
            d += ' %s %s -> %s' % ('wss' if e['tls'] else 'ws', e['port'], 'open' if res['open'] else 'fail')
        elif k == 'upgrade':
            r = rec('upgrade', n, port=e['port'], sent=e['sent'], pol=e['pol'])
            d += ' to %s, sent %s' % (e['port'], ','.join(e['sent']))
        elif k in ('ls', 'drop', 'throttle', 'disconnect', 'new'):
            r = rec(k, n, pol=e['pol'])
            d += ' pol=%s' % e['pol']
        elif k == 'env':
            w, v = e['what'], e['val']
            if w == 'dur':
                r = rec('env', what=w, ival=v)
            elif w == 'upg':
                r = rec('env', what=w, sval=v)
            elif w == 'net':
                r = rec('env', what=w, bval=v)
            else:
                r = rec('env', what=w, sval=v[0], bval=v[1])
            d += ' %s=%s' % (w, v)
        else:
            raise ValueError(k)
        out.append((r, d))
    # Quiet to the end: a dial Seance did not make but the model must is caught here.
    while now < sc['end']:
        out.append((rec('tick'), 'tick to %d' % (now + 1)))
        now += 1
    return out


MATCH = r"""PolIs(e) == IF e.phas THEN pol'.has /\ pol'.port = e.pport /\ pol'.exp = e.pexp
               \* Seance prunes expired entries the model keeps (D8): absent = none valid
               ELSE ~pol'.has \/ pol'.exp <= now'
Match(e) ==
    /\ act'.k = e.k
    /\ e.k \notin {"tick", "env"} => act'.n = e.n
    /\ e.k = "dial" => /\ act'.tls = e.tls /\ act'.port = e.port /\ nw'[e.n].st = e.st
                       /\ (e.how = "poke" => act'.how = "poke")
                       \* a dial the driver did not ask for is no user connect or poke
                       /\ (e.how = "none" => env' = env)
    /\ e.k = "upgrade" => act'.port = e.port /\ act'.sent = e.sent
    /\ e.pc => PolIs(e)
    /\ e.k = "env" => CASE e.what = "dur" -> srvDur' = e.ival
                         [] e.what = "upg" -> srvUpg' = e.sval
                         [] e.what = "net" -> netUp' = e.bval
                         [] e.what = "port" -> (e.sval \in secUp') = e.bval
"""


def durs(sc):
    ds = {0}
    if sc['init']['dur'] >= 0:
        ds.add(sc['init']['dur'])
    for e in sc['events']:
        if e['k'] == 'env' and e['what'] == 'dur' and e['val'] >= 0:
            ds.add(e['val'])
    return ds


def write(work, sc, mode, upto):
    name = 'RT_%s_%s' % (sc['name'], mode)
    st = steps(sc)[:upto]
    body = ['---- MODULE %s ----' % name, 'EXTENDS StsReconnect', 'VARIABLE i', MATCH,
            'W == <<%s>>' % ',\n      '.join(r for r, _ in st),
            'TInit == InitState /\\ i = 0',
            "TNext == i < Len(W) /\\ Next /\\ Match(W[i + 1]) /\\ i' = i + 1",
            'TSpec == TInit /\\ [][TNext]_<<vars, i>>', 'NotDone == i < Len(W)', '====']
    open(os.path.join(work, name + '.tla'), 'w').write('\n'.join(body) + '\n')
    init = sc['init']
    c = dict(Nets=S(sc['nets']), PlainNets=S(sc['plain']), SaslNets='{}', SecPorts=S(['S1', 'S2']),
             SavedPort='"S1"', Durs='{%s}' % ', '.join(map(str, sorted(durs(sc)))),
             InitUpg='"%s"' % init['upg'], InitDur='{%d}' % init['dur'] if init['dur'] >= 0 else '{}',
             MaxTime=sc['end'] + 1, EnvKinds=S(['drop', 'throttle', 'user', 'poke', 'net', 'port', 'upg',
                                                 'dur', 'new', 'del', 'reload'] + (['ip'] if sc['ipOn'] else [])),
             MaxEnv=200, Bound=100000, **REAL)
    for s in SW:
        c[s] = 'TRUE' if mode == 'seance' else 'FALSE'
    cfg = ['SPECIFICATION TSpec', 'CONSTANTS'] + ['    %s = %s' % kv for kv in c.items()]
    cfg += ['INVARIANT NotDone', 'CHECK_DEADLOCK FALSE']
    open(os.path.join(work, name + '.cfg'), 'w').write('\n'.join(cfg) + '\n')
    return name


def follows(work, sc, mode, upto):
    name = write(work, sc, mode, upto)
    p = subprocess.run(['java', '-XX:+UseParallelGC', '-cp', JAR, 'tlc2.TLC', '-workers', '1',
                        '-metadir', os.path.join(work, 'meta', name), '-config', name + '.cfg', name + '.tla'],
                       cwd=work, capture_output=True, text=True)
    open(os.path.join(work, name + '.log'), 'w').write(p.stdout + p.stderr)
    if 'Invariant NotDone is violated' in p.stdout:
        return True
    if 'No error has been found' in p.stdout:
        return False
    raise RuntimeError('%s: %s' % (name, p.stdout[-2000:]))


def check(work, sc, mode):
    total = len(steps(sc))
    if follows(work, sc, mode, total):
        return 'follows all %d steps' % total, None
    lo, hi = 0, total          # lo followable (prefix of 0 trivially), hi not
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if follows(work, sc, mode, mid):
            lo = mid
        else:
            hi = mid
    return 'STUCK at step %d of %d' % (hi, total), steps(sc)[hi - 1][1]


def main():
    obs, work = sys.argv[1], sys.argv[2]
    os.makedirs(work, exist_ok=True)
    shutil.copy(os.path.join(MODEL, 'StsReconnect.tla'), work)
    lines = []
    for raw in open(obs):
        sc = json.loads(raw)
        for mode in ('spec', 'seance'):
            verdict, where = check(work, sc, mode)
            line = '%s | expect %s | %s | %s%s' % (sc['name'], sc['expect'], mode, verdict,
                                                   ' | ' + where if where else '')
            print(line, flush=True)
            lines.append(line)
    open(os.path.join(work, 'summary.txt'), 'w').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
