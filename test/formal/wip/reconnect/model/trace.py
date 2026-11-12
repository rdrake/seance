#!/usr/bin/env python3
"""trace.py LOG: one line per state of a TLC counterexample of StsReconnect."""
import re, sys
log = open(sys.argv[1]).read()
for st in re.split(r'\nState \d+: ', log)[1:]:
    g = lambda p, d='': (re.search(p, st, re.S) or [None, d])[1]
    k, n = g(r'act = \[.*?\bk \|-> "(\w+)"'), g(r'act = \[.*?\bn \|-> "(\w+)"')
    if k == 'tick':
        continue
    nets = re.findall(r'(n\d) \|->\s*\[(.*?)\]', g(r'nw = (.*?)\n/\\', ''), re.S)
    desc = []
    for name, body in nets:
        f = dict(re.findall(r'(\w+) \|-> ("?[\w-]+"?)', body))
        desc.append('%s:%s/%s%s due=%s %s' % (name, f['st'].strip('"'), 'tls' if f['tls'] == 'TRUE' else 'plain',
                                              f['port'], f['due'], f['why'].strip('"')))
    print('t=%-4s %-10s %-4s %s %s | %s | pol=%s' % (g(r'now = (\d+)'), k, n,
          'REFUSED' if g(r'refused \|-> (\w+)') == 'TRUE' and k == 'dial' else '',
          'tls' if g(r'act = \[.*?tls \|-> (\w+)') == 'TRUE' else '', '; '.join(desc),
          re.sub(r'\s+', ' ', g(r'pol = (\[.*?\])'))))
