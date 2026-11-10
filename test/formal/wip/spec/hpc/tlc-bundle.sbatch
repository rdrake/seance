#!/bin/bash
# Run a list of small TLC checks one after another in one scavenge job.
#
#   sbatch -c 16 --mem=80G tlc-bundle.sbatch LIST
#
# LIST (in $RUN_ROOT) has one check per line: "<module> <config> [expect]",
# where expect is "pass" (default; no error must be found) or "fail" (a
# witness or mutant: a violation must be found).  Each check writes
# tlc-<config>@<module>.log; the job ends with one summary line per check in
# bundle-<LIST>.summary.  A requeued job (preemption) skips checks whose log
# already has a final verdict.
#SBATCH --job-name=tlc-bundle
#SBATCH --partition=scavenge
#SBATCH --cpus-per-task=16
#SBATCH --mem=80G
#SBATCH --time=1-00:00:00
#SBATCH --requeue
#SBATCH --open-mode=append
#SBATCH --output=%x-%j.out

set -uo pipefail
LIST="${1:?list file}"
RUN_ROOT="${RUN_ROOT:?set RUN_ROOT}"
cd "$RUN_ROOT"
HEAP=$(( SLURM_MEM_PER_NODE * 70 / 100 / 1024 ))
SUM="bundle-$(basename "$LIST").summary"

while read -r MOD CFG EXPECT; do
  [ -z "${MOD:-}" ] && continue
  case "$MOD" in \#*) continue ;; esac
  EXPECT="${EXPECT:-pass}"
  LOG="tlc-$CFG@$MOD.log"
  if [ -f "$LOG" ] && grep -qE "No error has been found|(is|was|were) violated|^Error:" "$LOG"; then
    continue
  fi
  rm -rf "states-$CFG@$MOD"
  echo "$(date -Is) $MOD $CFG ($EXPECT), ${SLURM_CPUS_PER_TASK} workers, ${HEAP}g" > "$LOG"
  apptainer exec --bind "$RUN_ROOT" temurin21.sif \
    java -XX:+UseParallelGC -Xmx"${HEAP}"g -cp tla2tools.jar tlc2.TLC \
      -workers "$SLURM_CPUS_PER_TASK" -metadir "states-$CFG@$MOD" \
      -config "$CFG.cfg" "$MOD.tla" >> "$LOG" 2>&1
  if grep -q "No error has been found" "$LOG"; then got=pass
  elif grep -qE "(is|was|were) violated" "$LOG"; then got=fail
  else got=error; fi
  ok=$([ "$got" = "$EXPECT" ] && echo OK || echo UNEXPECTED)
  states=$(grep -E "distinct states found" "$LOG" | tail -1 | sed 's/.*generated, //; s/ distinct.*//')
  viol=$(grep -oE "(Invariant|Temporal property|Action property) [A-Za-z0-9_]+ (is|was) violated" "$LOG" | head -1)
  echo "$ok $MOD $CFG expect=$EXPECT got=$got distinct=${states:-?} ${viol:-}" >> "$SUM"
  rm -rf "states-$CFG@$MOD"
done < "$LIST"
echo "$(date -Is) bundle $LIST done" >> "$SUM"
