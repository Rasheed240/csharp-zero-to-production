#!/usr/bin/env bash
# sweep.sh — build and run every file-based app in a module folder.
#
# Three things this guards against, each of which has produced a false "clean"
# in this project:
#
#   1. Counting only real compiler diagnostics. Those carry a
#      "file.cs(line,col): " prefix. Matching a bare "error CS" also matches a
#      program that PRINTS an error code in its own output.
#   2. Argument order. `dotnet run` needs the file BEFORE the flags, or it
#      looks for a .csproj, fails to find one, and prints a message containing
#      no diagnostics at all. The notbuilt column catches that.
#   3. The file-based app build cache. A file-based app caches its build in
#      %TEMP%/dotnet/runfile/<name>-<hash>. Deleting obj/ and bin/ does NOT
#      clear it, so re-running an UNCHANGED file reuses the cached result and
#      reports zero warnings without compiling anything. Each file's cache
#      entry is deleted below so every sweep is a genuine compile.
#
# Usage: verification/sweep.sh t1-21-delegates
set -u
dir="${1:?usage: sweep.sh <module-folder>}"
cd "$(dirname "$0")/$dir" || exit 1

cache="${TEMP:-/tmp}/dotnet/runfile"
fail=0

# Compile-error probes are meant NOT to build, and two files crash by design.
# Both are documented in README.md; skip them rather than report them forever.
skip='compile-error|compile-errors|compile-vs-runtime-errors'

# t1-01/02-reading-il.cs emits IL2026 deliberately — the lesson quotes that
# warning. It is expected, so it is reported but does not fail the sweep.
expected_warn='02-reading-il'

for f in [0-9]*.cs; do
  [ -e "$f" ] || continue
  if printf '%s' "$f" | grep -qE "$skip"; then
    printf '%-36s (skipped: fails or crashes by design)
' "$f"
    continue
  fi
  rm -rf "$cache/${f%.cs}-"* 2>/dev/null
  out=$(dotnet run "$f" -c Release --no-incremental 2>&1)
  w=$(printf '%s' "$out" | grep -cE '\.cs\([0-9]+,[0-9]+\): warning (CS|IL|CA)')
  e=$(printf '%s' "$out" | grep -cE '\.cs\([0-9]+,[0-9]+\): error (CS|IL|CA)')
  c=$(printf '%s' "$out" | grep -c 'Unhandled exception')
  n=$(printf '%s' "$out" | grep -c "Couldn't find a project")
  printf '%-36s warn:%s err:%s crash:%s notbuilt:%s\n' "$f" "$w" "$e" "$c" "$n"
  if printf '%s' "$f" | grep -qE "$expected_warn"; then w=0; fi
  [ "$w" != 0 ] || [ "$e" != 0 ] || [ "$c" != 0 ] || [ "$n" != 0 ] && fail=1
done

echo ""
[ "$fail" = 0 ] && echo "clean" || echo "PROBLEMS FOUND"
exit "$fail"
