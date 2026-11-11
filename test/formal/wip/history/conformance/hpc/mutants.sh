#!/bin/bash
#SBATCH --job-name=dmut
#SBATCH --partition=scavenge
#SBATCH --cpus-per-task=16
#SBATCH --mem=48G
#SBATCH --time=0-04:00:00
#SBATCH --output=%x-%j.out
cd $RUN_ROOT
export TLA_JAR=$RUN_ROOT/tla2tools.jar TLC_JAVA="apptainer exec --bind /project $RUN_ROOT/temurin21.sif java" TLC_XMX=2g
for m in DM_IgnoreEcho DM_WrongLabel DM_Early DM_Flip DM_FirstOnly DM_Reverse DM_IgnoreAck DM_IgnoreErr DM_HistorySettles DM_KindBlind DM_HighestRef DM_GlobalHist; do
  mkdir -p mut-$m && cp model/*.tla mut-$m/
  python3 check_delivery.py $1 mut-$m -j 16 --module $m --configs F1D1 > mut-$m/summary.txt 2>&1
  echo "$m diverges_on=$(grep -c -v 'match=F1D1' mut-$m/summary.txt) errors=$(grep -l '^Error\|Semantic' mut-$m/*.log 2>/dev/null | wc -l)" >> mutants-$SLURM_JOB_ID.txt
done
