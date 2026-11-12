#!/bin/sh
# runall.sh [LIST...]: run every line of runs.txt and mutants/runs-mutants.txt
# (or the lists given) with run1.sh, 6 min each, and write results.summary:
#   config | expected | result | distinct states | time | verdict
cd "$(dirname "$0")"
LISTS=${*:-runs.txt mutants/runs-mutants.txt}
OUT=results.summary
echo "# $(git rev-parse --short HEAD) limited runs, TLC -workers ${WORKERS:-3}, 6 min cap" > $OUT
for L in $LISTS; do
  DIR=$(dirname $L)
  cp $L $L.running   # a snapshot: regenerating the list mid-run must not shift it
  while read M C EXP PROP; do
    [ -z "$M" ] && continue
    R=$(cd $DIR && $OLDPWD/run1.sh $M $C 6)
    LOG=$DIR/logs/$C@$M.log
    if grep -q 'No error has been found' $LOG; then GOT=pass
    elif grep -qE "(Invariant|Action property|Temporal properties?) $PROP (is|was|were) violated|$PROP is violated" $LOG; then GOT=fail
    elif grep -q 'is violated' $LOG; then GOT=fail-other
    else GOT=error; fi
    V=$([ "$GOT" = "$EXP" ] && echo ok || echo MISMATCH)
    echo "$R | expected $EXP${PROP:+ $PROP} | $V" >> $OUT
  done < $L.running
  rm -f $L.running
done
grep -c '| ok$' $OUT; grep MISMATCH $OUT
