#!/usr/bin/env bash
# Proves that an optional parameter's default value is baked into the CALLER at
# compile time, not read from the library at run time.
#
#   bash run-demo.sh
#
# Requires: .NET 10 SDK. Leaves the tree exactly as it found it.

set -euo pipefail
cd "$(dirname "$0")"

export DOTNET_NOLOGO=1
export DOTNET_CLI_TELEMETRY_OPTOUT=1

cleanup() {
  sed -i 's/int feePercent = 5/int feePercent = 2/; s/CurrentDefaultPercent() => 5/CurrentDefaultPercent() => 2/' LedgerFees/Fees.cs 2>/dev/null || true
  rm -rf app libout LedgerFees/bin LedgerFees/obj Billing/bin Billing/obj
}
trap cleanup EXIT

echo "1. Build everything with the library default at 2%, then run."
dotnet build Billing/Billing.csproj -c Release -o app > /dev/null
./app/Billing.exe
echo ""

echo "2. Change ONLY the library: the default becomes 5%."
sed -i 's/int feePercent = 2/int feePercent = 5/; s/CurrentDefaultPercent() => 2/CurrentDefaultPercent() => 5/' LedgerFees/Fees.cs
echo ""

echo "3. Rebuild ONLY the library and drop the new DLL beside the unchanged app."
dotnet build LedgerFees/LedgerFees.csproj -c Release -o libout > /dev/null
cp libout/LedgerFees.dll app/LedgerFees.dll
echo ""

echo "4. Run the UNCHANGED app against the NEW library:"
./app/Billing.exe
echo "   ^ the library reports 5%, but the fee charged is still 2%."
echo ""

echo "5. Rebuild the consumer (no source change) and run again:"
dotnet build Billing/Billing.csproj -c Release -o app > /dev/null
./app/Billing.exe
echo "   ^ only now does the new default take effect."
echo ""

echo "Expected output:"
echo "  step 1: default 2%, returned 102"
echo "  step 4: default 5%, returned 102   <-- the trap"
echo "  step 5: default 5%, returned 105"
