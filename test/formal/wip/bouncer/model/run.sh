#!/bin/sh
# run.sh LIST : TLC, one worker, on each "<module> <config> <pass|fail>" line;
# prints one summary line per check.  Logs in logs/ (not committed).
JAR=${JAR:-$HOME/tools/formal/tla2tools.jar}
META=${META:-/tmp/bouncer-tlc}
mkdir -p logs
while read -r mod c exp; do
  [ -n "$mod" ] || continue
  log=logs/$c.log
  s=$(date +%s)
  java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers 1 -noGenerateSpecTE \
    -metadir "$META/$c" -config "$c.cfg" "$mod.tla" > "$log" 2>&1
  t=$(( $(date +%s) - s ))
  err=$(grep -m1 -E "^Error: " "$log")
  if grep -q "Model checking completed. No error" "$log"; then got=pass; elif grep -q "is violated" "$log"; then got=fail; else got=error; fi
  ds=$(grep -oE "[0-9]+ distinct states found" "$log" | tail -1 | cut -d' ' -f1)
  ok=OK; [ "$got" = "$exp" ] || ok=MISMATCH
  echo "$ok $mod $c expect=$exp got=$got distinct=$ds time=${t}s $err"
done < "$1"
