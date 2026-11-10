#!/bin/bash
# Trace validation (conformance/check.py) on the cluster, many traces per job.
#
#   RUN_ROOT=... sbatch tlc-traces.sbatch TRACES.jsonl WORKDIR
#
# RUN_ROOT holds conformance/ (check.py), model/ (SpecHandshake.tla),
# temurin21.sif and tla2tools.jar.  One single-worker TLC per trace,
# SLURM_CPUS_PER_TASK at a time, each with a 3g heap.  check.py writes
# WORKDIR/summary.json.
#SBATCH --job-name=tlc-traces
#SBATCH --partition=scavenge
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time=0-12:00:00
#SBATCH --requeue
#SBATCH --open-mode=append
#SBATCH --output=%x-%j.out
set -uo pipefail
RUN_ROOT="${RUN_ROOT:?set RUN_ROOT}"
cd "$RUN_ROOT"
export TLA_JAR="$RUN_ROOT/tla2tools.jar"
export TLC_JAVA="apptainer exec --bind /project $RUN_ROOT/temurin21.sif java"
export TLC_XMX=3g
python3 conformance/check.py "$1" "$2" -j "$SLURM_CPUS_PER_TASK"
