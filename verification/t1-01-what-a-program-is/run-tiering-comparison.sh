#!/usr/bin/env bash
# Harness for the numbers quoted in t1-01, "Why this matters in a real system".
#
# Measures TOTAL PROCESS wall-clock — runtime startup plus JIT plus work — which
# is what a cold container start actually costs. Timing a single run of anything
# this short is meaningless, so it takes the median of many runs.
#
#   bash run-tiering-comparison.sh
#
# Requires: .NET 10 SDK.

set -euo pipefail
cd "$(dirname "$0")"

RUNS="${RUNS:-13}"

echo "building the workload in Release..."
BUILD_OUTPUT=$(dotnet build -c Release 05-tiering-workload.cs 2>&1)
EXE=$(echo "$BUILD_OUTPUT" | grep -oE '[A-Za-z]:\\[^ ]*\\bin\\release\\05-tiering-workload\.dll' | head -1)

if [ -z "$EXE" ]; then
  echo "could not find the build output. Full build log:"
  echo "$BUILD_OUTPUT"
  exit 1
fi

# Convert the Windows path the SDK printed into something this shell can run,
# and swap the .dll for the .exe launcher next to it.
EXE=$(echo "$EXE" | sed 's|\\|/|g; s|^\([A-Za-z]\):|/\L\1|' | sed 's|\.dll$|.exe|')
echo "running: $EXE"
echo ""

measure() {
  local label="$1"; shift
  local times=""
  for _ in $(seq 1 "$RUNS"); do
    local s e
    s=$(date +%s%N)
    env "$@" "$EXE" > /dev/null
    e=$(date +%s%N)
    times="$times $(( (e - s) / 1000000 ))"
  done
  local sorted median
  sorted=$(echo "$times" | tr ' ' '\n' | grep -v '^$' | sort -n)
  median=$(echo "$sorted" | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}')
  printf "  %-32s median %4s ms   all:%s\n" "$label" "$median" "$times"
}

echo "total process wall-clock, median of $RUNS runs each:"
measure "default"                      DUMMY=1
measure "DOTNET_TieredCompilation=0"   DOTNET_TieredCompilation=0
measure "DOTNET_TieredPGO=0"           DOTNET_TieredPGO=0
measure "DOTNET_ReadyToRun=0"          DOTNET_ReadyToRun=0

echo ""
echo "Expect: ReadyToRun=0 is consistently the slowest, because turning it off"
echo "forces the JIT to compile the framework's own code instead of loading the"
echo "precompiled native version. The magnitude is noisy on a desktop machine"
echo "(1.3x to 1.9x observed); the direction is stable."
