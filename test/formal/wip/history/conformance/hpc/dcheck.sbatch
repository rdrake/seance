#!/bin/bash
#SBATCH --job-name=dcheck
#SBATCH --partition=scavenge
#SBATCH --cpus-per-task=16
#SBATCH --mem=48G
#SBATCH --time=0-04:00:00
#SBATCH --requeue
#SBATCH --output=%x-%j.out
# RUN_ROOT=... sbatch dcheck.sbatch OBS.jsonl WORKDIR [extra args]
set -uo pipefail
cd "$RUN_ROOT"
mkdir -p "$2" && cp model/*.tla "$2"/
export TLA_JAR="$RUN_ROOT/tla2tools.jar"
export TLC_JAVA="apptainer exec --bind /project $RUN_ROOT/temurin21.sif java"
export TLC_XMX=2g
python3 check_delivery.py "$1" "$2" -j "$SLURM_CPUS_PER_TASK" "${@:3}" > "$2/summary.txt" 2>&1
