#!/bin/sh
# run.sh CFG...  : TLC, one worker, on MC.tla; prints one summary line per config.
JAR=${JAR:-$HOME/tools/formal/tla2tools.jar}
META=${META:-/tmp/session-tlc}
for c in "$@"; do
  c=${c%.cfg}
  log=logs/$c.log; mkdir -p logs
  java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers 1 -noGenerateSpecTE -metadir "$META/$c" -config "$c.cfg" MC.tla > "$log" 2>&1
  res=$(grep -m1 -E "^Error: (Invariant|Temporal|Deadlock)|^Model checking completed. No error|^Error:" "$log")
  ds=$(grep -oE "[0-9]+ distinct states found" "$log" | tail -1)
  echo "$c | $ds | $res"
done
