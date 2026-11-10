#!/bin/bash
# Run TLC on one config of SpecHandshake in the scavenge partition, resuming
# from TLC's own checkpoint after a preemption (scavenge requeues the job
# from the start).
#
#   sbatch tlc-scavenge.sbatch <config-name>        e.g. Reference
#   TLC_EXTRA="-fpmem 0.05" sbatch ...               extra TLC options
#   TLC_MODULE=RefSafety_e10 sbatch ... RefSafety_e10   a split slice (split-env.py)
#
# Expects, in $RUN_ROOT: SpecHandshake.tla, <config>.cfg, tla2tools.jar and
# temurin21.sif.  Writes states/ and tlc-<config>.log there.
#SBATCH --job-name=tlc-spec
#SBATCH --partition=scavenge
#SBATCH --cpus-per-task=96
#SBATCH --mem=600G
#SBATCH --time=2-00:00:00
#SBATCH --requeue
#SBATCH --open-mode=append
#SBATCH --output=%x-%j.out

set -euo pipefail
CFG="${1:?config name, e.g. Reference}"
RUN_ROOT="${RUN_ROOT:-/project/def-rdrake/rdrake/formal/spec-handshake}"
cd "$RUN_ROOT"

META="$RUN_ROOT/states-$CFG"
mkdir -p "$META"
HEAP=$(( SLURM_MEM_PER_NODE * 70 / 100 / 1024 ))   # MB -> GB, 70% of the job's memory

# Resume from the newest checkpoint, if a previous run of this job left one.
RECOVER=()
LAST=$(find "$META" -name '*.chkpt' -printf '%T@ %h\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2- || true)
if [ -n "$LAST" ]; then
  echo "$(date -Is) resuming from $LAST (restart ${SLURM_RESTART_COUNT:-0})"
  RECOVER=(-recover "$LAST")
fi

echo "$(date -Is) job $SLURM_JOB_ID on $(hostname): $CFG, ${SLURM_CPUS_PER_TASK} workers, ${HEAP}g heap"
exec apptainer exec --bind "$RUN_ROOT" temurin21.sif \
  java -XX:+UseParallelGC -Xmx"${HEAP}"g -cp tla2tools.jar tlc2.TLC \
    -workers "$SLURM_CPUS_PER_TASK" -checkpoint 15 -metadir "$META" \
    ${TLC_EXTRA:-} \
    "${RECOVER[@]}" -config "$CFG.cfg" "${TLC_MODULE:-SpecHandshake}.tla" \
    >> "tlc-$CFG.log" 2>&1
