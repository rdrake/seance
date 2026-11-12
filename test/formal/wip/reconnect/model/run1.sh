#!/bin/sh
# run1.sh MODULE CONFIG [minutes]: one TLC run, metadir in /tmp-ish scratch, summary line
M=$1; C=$2; T=${3:-6}
D=${TLC_META:-/tmp/claude-0/-home-claude/3003878e-827b-5005-af4d-2f294219450f/scratchpad/tlc}/$C@$M
mkdir -p $D logs
timeout ${T}m java -XX:+UseParallelGC -cp $HOME/tools/formal/tla2tools.jar tlc2.TLC -workers 3 \
  -metadir $D -config $C.cfg $M.tla > logs/$C@$M.log 2>&1
echo "$C | $(grep -E 'No error has been found|Error: |is violated|Temporal properties were violated|Action property|Invariant .* is violated' logs/$C@$M.log | head -2 | tr '\n' ' ') | $(grep -oE '[0-9]+ distinct states found' logs/$C@$M.log | tail -1) | $(grep -oE 'Finished in [0-9a-z]+' logs/$C@$M.log | tail -1)"
