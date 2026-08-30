#!/usr/bin/env bash
# run.sh — build and run the source-generator demo, then show what it generated.
#
# A generator cannot be a `dotnet run file.cs` script: it must be a separate
# netstandard2.0 project, referenced with OutputItemType="Analyzer". That
# two-project shape IS the lesson, so the fixture is a real solution.
set -eu
cd "$(dirname "$0")/generator-demo"

echo "=== building (this runs the generator) ==="
dotnet build Ledger.App/Ledger.App.csproj -c Release

echo ""
echo "=== running the consumer ==="
dotnet run --project Ledger.App -c Release --no-build

echo ""
echo "=== what the generator wrote ==="
gen="Ledger.App/generated/Ledger.Generators/Ledger.Generators.AuditLogGenerator"
for f in "$gen"/*.cs; do
  echo ""
  echo "--- $(basename "$f") ---"
  cat "$f"
done
