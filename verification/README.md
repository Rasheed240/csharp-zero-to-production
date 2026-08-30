# verification/

Every C# snippet published in a module is compiled and run before the module is
marked `written`. This folder holds those runnable sources, one directory per
module, so any claim in the lesson can be re-checked later without
reconstructing it from the page.

`STYLE-CONTRACT.md` §11 makes this a release gate, not an optional extra.

## Running them

These are **.NET 10 file-based apps** — a single `.cs` file runs directly, with no
`.csproj` and no `dotnet new`:

```bash
cd verification/t1-03-value-vs-reference
dotnet run 01-copy-semantics.cs
```

Anything measuring time should be run in Release, or the numbers are noise:

```bash
dotnet run -c Release 06-struct-equality-cost.cs
```

> File-based apps (`dotnet run file.cs`) are a .NET 10 feature. On .NET 8 or 9,
> create a console project and drop the file in as `Program.cs` instead.

## Re-checking everything at once

To verify every source still builds clean, **force a non-incremental build**. This matters:
an incremental build reuses a cached result and does not re-emit warnings, so a sweep over
already-built files can report clean when it is not.

```bash
cd verification
for f in $(find . -name '*.cs' | grep -v compile-error-probe | grep -v -- -demo); do
  dotnet build -c Release --no-incremental "$f" 2>&1 |
    grep -E '(error|warning) (CS|CA|IL)[0-9]+' && echo "  ^ in $f"
done
```

Exclude the two probe files (which fail by design) and the two project directories
(`ledger-publish-demo`, `optional-default-demo`), which build through their `.csproj` rather
than as standalone file-based apps.

One warning is **expected and intentional**: `t1-01-what-a-program-is/02-reading-il.cs` emits
`IL2026`, which the lesson quotes deliberately. Everything else should be silent.

### Two ways a sweep lies to you

Both of these have produced a false "all clean" in this project. A sweep that cannot fail is
worse than no sweep, so guard against both.

**1. Argument order, for `dotnet run` only.** The file must come *before* the flags:

```bash
dotnet run 01-invariants.cs -c Release --no-incremental   # correct
dotnet run --no-incremental -c Release 01-invariants.cs   # does NOT run the file
```

The second form makes `dotnet run` look for a `.csproj` in the current directory, fail to find
one, and print `Couldn't find a project to run` — which contains no `error CS`, no `warning CS`
and no `Unhandled exception`. A sweep grepping for those reports every file clean while
compiling nothing. `dotnet build` accepts either order; only `run` is affected.

Always count the "not built" case explicitly:

```bash
for f in 0*.cs; do
  out=$(dotnet run "$f" -c Release --no-incremental 2>&1)
  printf '%-32s warn:%s err:%s crash:%s notbuilt:%s\n' "$f" \
    "$(echo "$out" | grep -cE 'warning (CS|IL)')" \
    "$(echo "$out" | grep -cE 'error (CS|IL)')" \
    "$(echo "$out" | grep -c 'Unhandled exception')" \
    "$(echo "$out" | grep -c "Couldn't find a project")"
done
```

**2. Stale assemblies in multi-project demos.** For anything under `binary-break/` or
`across-assemblies/`, deleting `obj/` and `bin/` is not optional — `--no-incremental` alone does
not stop a previously built dependency `.dll` being reused from an output directory. This
produced a wrong published result once: a probe reported `CS0103` for `private protected` from a
friend assembly, when a clean build shows it **compiles**, because `InternalsVisibleTo` grants
the friend "same assembly" identity. Delete the trees between configurations:

```bash
rm -rf lib/obj lib/bin consumer/obj consumer/bin out*
```

## Contents

### `t1-01-what-a-program-is/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-hello.cs` | The smallest complete program. | Debug |
| `02-reading-il.cs` | `a + b` compiles to 4 bytes of IL (`0203582A`), and parameter names survive compilation. Emits `IL2026` **on purpose** — the lesson quotes that warning. | Debug |
| `03-strings-in-the-binary.cs` | A hard-coded API key is recoverable from the compiled assembly by a byte search. | Debug |
| `04-jit-warmup.cs` | The first call to a method costs ~18x the second, measured via `JitInfo`. | **Release** |
| `05-tiering-workload.cs` | Fixed workload used by the tiering harness below. Not interesting on its own. | **Release** |
| `run-tiering-comparison.sh` | Median process wall-clock under different JIT settings. Produces the numbers in "Why this matters in a real system". | **Release** |
| `06-compile-vs-runtime-errors.cs` | The same file contains one error the compiler catches (CS0029) and one it cannot (`IndexOutOfRangeException`). **Crashes by design.** | Debug |
| `ledger-publish-demo/` | The project published three ways to produce the size table. Build outputs are deleted after measuring — they are 158 MB. | **Release** |

To reproduce the publish-size table:

```bash
cd verification/t1-01-what-a-program-is/ledger-publish-demo
dotnet publish -c Release -o out/framework-dependent
dotnet publish -c Release -r win-x64 --self-contained true -o out/self-contained
dotnet publish -c Release -r win-x64 --self-contained true \
    -p:PublishReadyToRun=true -p:PublishSingleFile=true -o out/r2r-singlefile
du -sm out/*
rm -rf out bin obj      # 158 MB; do not commit
```

Measured: 1 MB / 5 files, 78 MB / 192 files, 80 MB / 2 files. The app's own DLL is 5,120 bytes
in every case.

`06-compile-vs-runtime-errors.cs` exits non-zero by design. Uncomment the line marked `(A)` to
see the build fail instead of the program crashing.

### `t1-02-variables-and-types/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-declaring.cs` | Declaration, assignment, default values, `const` vs `readonly`. | Debug |
| `02-type-sizes.cs` | Real sizes and ranges of every built-in numeric type. | Debug |
| `03-integer-behaviour.cs` | `1000 / 3 == 333`; an `int` pence total wraps negative past £21,474,836.47; `checked` turns that into an exception. | Debug |
| `04-floating-point.cs` | `0.1 + 0.2 != 0.3`; 0.1 added ten times is not 1.0; one million additions of 0.01 drift by 0.0000001719. | Debug |
| `05-ledger-money.cs` | Three ordinary prices, rounded per line, total **12.30 in `double` and 12.31 in `decimal`**. | Debug |
| `06-parsing-and-culture.cs` | `"1.234"` parses to 1.234 in en-GB and **1234** in de-DE, with no exception. | Debug |
| `07-var-inference.cs` | What `var` infers for each literal form, including `10.5` → `double`. | Debug |
| `08-dates.cs` | Three `DateTime` values printing identically; `DateTimeOffset` comparing correctly across zones. | Debug |
| `09-compile-error-probe.cs` | The exact CS0165 / CS0266 / CS0131 / CS0818 / CS0128 diagnostics quoted. **Does not compile by design.** | n/a |
| `10-exercise-split.cs` | Exercise 4's worked solution: money split by weights, summing exactly, across six cases. | Debug |
| `11-exercise-payment-and-culture.cs` | Exercises 2 and 3: the rewritten `Payment`, and the culture test failing against the broken code and passing against the fixed one. | Debug |

Two results in here contradicted the author's first guess and are worth knowing:

- **`10-exercise-split.cs`** — splitting 100.00 three ways gives `33.33, 33.34, 33.33`. The extra
  penny lands on the **middle** party, not the last. The boundary-rounding method guarantees an
  exact sum and a deterministic result; it does *not* let you choose who gets the remainder.
- **`09-compile-error-probe.cs`** — `int truncated = 3.7;` is **CS0266**, not CS0029, and
  `var undecided;` is **CS0818**, not CS0821.

A third, found while writing Exercise 1: `Console.WriteLine(int.MaxValue + 1);` does **not**
compile (CS0220). Constant expressions are checked by default; runtime arithmetic is unchecked by
default. Assigning to a variable first makes it wrap silently.

### `t1-03-value-vs-reference/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-copy-semantics.cs` | Assignment copies a value type and shares a reference type; `ref` changes that. | Debug |
| `02-sizes-and-boxing.cs` | Actual type sizes, and that boxing one `int` costs 24 bytes. | Debug |
| `03-allocation-pressure.cs` | `List<object>` vs `List<int>` for 1,000,000 ints — 30.5 MB vs 3.8 MB. | Debug |
| `04-ledger-money-and-invoice.cs` | The production example: `Money` as a value, `Invoice` as an identity. | Debug |
| `05-defensive-copies.cs` | The four places a hidden copy silently discards a mutation. | Debug |
| `06-struct-equality-cost.cs` | Default `ValueType.Equals` vs a `record struct` — about 5x on dictionary lookups. | **Release** |
| `07-compile-error-probe.cs` | Confirms the exact CS1612 diagnostics quoted in the lesson. **Does not compile by design.** | n/a |

`07-compile-error-probe.cs` is expected to fail. Its whole purpose is to
produce the two `CS1612` errors the module quotes verbatim:

```
error CS1612: Cannot modify the return value of 'List<MutableCounter>.this[int]' because it is not a variable
error CS1612: Cannot modify the return value of 'Box.Counter' because it is not a variable
```

### `t1-04-control-flow/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-branching.cs` | if/else ordering, the conditional operator, nested vs guard-clause shape producing identical results. | Debug |
| `02-loops.cs` | The four loops, break vs continue, and the `while`+`continue` loop that never advances. | Debug |
| `03-switch.cs` | switch statement vs switch expression; stacked empty labels as the only permitted grouping. | Debug |
| `04-short-circuit.cs` | `&&` calls the right side 0 times, `&` calls it 1 time; `&` throws NullReferenceException on a null check. | Debug |
| `05-modifying-while-iterating.cs` | Which collections actually throw during enumeration — the answer is not what most guides say. | Debug |
| `06-branch-prediction.cs` | Same data, same work: **262 ms unsorted vs 35 ms sorted (7.5x)**, and 53 ms branchless on the unsorted data. | **Release** |
| `07-nested-loops.cs` | Quadratic scaling: 5 → 49 → 219 → 927 ms as input doubles, against 0–2 ms for a dictionary lookup. | **Release** |
| `08-compile-error-probe.cs` | CS0163, CS0029, CS0139, CS0162, CS8509 verbatim. **Does not compile by design.** | n/a |
| `09-exercise-solutions.cs` | All of exercises 1, 2 and 4, including six `FindFirstGap` cases against both implementations. | Debug |

The collection-mutation table is the one most likely to contradict what you have read
elsewhere. Measured on .NET 10:

```
List<string>.Remove              throws InvalidOperationException
Dictionary.Remove                allowed
Dictionary.Add                   throws InvalidOperationException
Dictionary update existing key   allowed
HashSet.Remove                   allowed
```

`Dictionary` and `HashSet` have permitted `Remove` during enumeration since .NET Core 3.0.
The lesson still tells you not to rely on it, because the permission does not transfer when the
collection type changes.

### `t1-05-methods-and-parameters/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-methods-basics.cs` | Signature, parameters vs arguments, expression-bodied members, local functions, a recursive method with a base case. | Debug |
| `02-ref-out-in.cs` | The four passing modes, and that `ref` on a reference type is a second, separate level. | Debug |
| `03-overloads.cs` | `Describe(a)` picks the `int` overload; `Log(null)` picks `string`; argument evaluation is left to right. | Debug |
| `04-optional-and-named.cs` | Optional/named argument behaviour, and that named arguments do **not** change evaluation order. | Debug |
| `05-params-allocation.cs` | **40.7 bytes/call** for `params int[]`, **96 bytes/call** for `params object[]`, **0** for `params ReadOnlySpan<T>` and for an empty call. | **Release** |
| `06-recursion-depth.cs` | ~13,765 frames before the stack runs out, and that `catch (Exception)` never fires. **Crashes by design.** | **Release** |
| `07-compile-error-probe.cs` | CS7036, CS1620, CS1739, CS0177, CS0111, CS1737 verbatim. **Does not compile by design.** | n/a |
| `08-exercise-solutions.cs` | Exercises 2, 3 and 4, including cycle detection in both the recursive and iterative walkers. | Debug |
| `optional-default-demo/` | Two assemblies proving an optional default is baked into the **caller**. See below. | **Release** |

The two-assembly demo is the centrepiece of the module. Run it with:

```bash
cd verification/t1-05-methods-and-parameters/optional-default-demo
bash run-demo.sh
```

It builds a library with a 2% default fee and a consumer that omits the argument, changes the
library to 5%, rebuilds **only the library**, and runs the unchanged consumer:

```
step 1: library default 2%, ApplyFee(100m) returned 102
step 4: library default 5%, ApplyFee(100m) returned 102   <-- the trap
step 5: after rebuilding the consumer,        returned 105
```

The script restores the tree on exit, so it leaves no build output behind.

Two findings worth carrying forward:

- **Local functions cannot be overloaded** (CS0128), and a `static` method written at the top
  level of a file *is* a local function. Overloads must live in a class. This is why
  `03-overloads.cs` uses `public static class Api`.
- **The compiler reports declaration errors before call-site errors.** `07-compile-error-probe.cs`
  emits only CS0111 and CS1737 until the `Broken` class is commented out, at which point the
  call-site diagnostics appear.

### `t1-06-arrays/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-array-basics.cs` | Creation forms, zeroing, reference semantics, `Array.Empty` sharing, and `BinarySearch` returning nonsense on unsorted input. | Debug |
| `02-bounds-checking.cs` | The exception message names neither index nor length; and the two loop forms measure **identically** (1.00x, 1.02x, 1.04x). | **Release** |
| `03-cache-locality.cs` | Row-major vs column-major over a 2,000x2,000 grid: **21 ms vs 112 ms**. Ratios of 5.3x, 5.7x, 3.1x across runs. | **Release** |
| `04-jagged-vs-multidim.cs` | flat `int[]` 11 ms, jagged `int[][]` 16 ms, rectangular `int[,]` 22 ms. The rectangular array is the **slowest**. | **Release** |
| `05-covariance.cs` | `ArrayTypeMismatchException` from a line that compiles, with the exact message. | Debug |
| `06-large-object-heap.cs` | Searches for the exact LOH boundary: `int[21,244]` and `string[10,622]`, both 84,976 payload bytes + a 24-byte header = exactly 85,000. | **Release** |
| `07-resize-and-copy.cs` | `Array.Resize` allocates a new array; growing per item is quadratic (17 → 73 → 319 → 2,011 ms) against 0 ms for `List<T>`. | **Release** |
| `08-compile-error-probe.cs` | CS0022, CS0029, CS0178, CS0200, CS1586 verbatim. **Does not compile by design.** | n/a |
| `09-exercise-solutions.cs` | Exercises 1, 2 and 4, including the `RingBuffer` across empty / partial / full / wrapped / capacity-1 / 1,000,000-add cases. | **Release** |

Three results here are worth carrying forward, because two of them contradict common advice:

- **`int[,]` is the slowest of the three grid layouts**, not the fastest. It is a distinct
  runtime type whose indexing the JIT optimises far less than single-dimension arrays.
- **Writing `i < array.Length` buys nothing on .NET 10.** Measured against a loop bounded by a
  separate variable, the ratio was 1.00x–1.04x. This mattered on older runtimes; it is now
  folklore.
- **The LOH boundary is exact and verifiable**: 84,976 bytes of elements plus the 24-byte array
  header (16-byte object header + 8-byte length). For `decimal` that is 5,311 elements, which
  `09-exercise-solutions.cs` confirms against the arithmetic.

### `t1-07-strings-and-interning/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-string-basics.cs` | Immutability, null vs empty vs whitespace, `Substring` 48 bytes vs `AsSpan` 0, and the string LOH boundary at 42,486 chars. | **Release** |
| `02-utf16-internals.cs` | `Length` vs runes vs graphemes. A flag emoji is Length 4; a man-technologist emoji is Length 5, 3 runes, 1 grapheme. | Debug |
| `03-building-strings.cs` | `+=` in a loop is quadratic: **14.5 GB** for 40,000 lines against 1.5 MB. Also the operand-count table and the StringBuilder capacity result. | **Release** |
| `04-comparison-and-culture.cs` | The Turkish I letting `ADMIN` past a blocklist containing `admin`; Swedish sorting; Unicode normalisation. | Debug |
| `05-interning-and-hashing.cs` | Literals are interned, runtime-built strings are not, and `GetHashCode()` differs between processes. | Debug |
| `06-compile-error-probe.cs` | CS0200 and CS0029 verbatim. **Does not compile by design.** | n/a |
| `07-exercise-solutions.cs` | Exercises 1, 2 and 4, including `SplitFields` at **0 bytes/line** against `string.Split` at 152. | **Release** |

Four results here contradict common advice or first expectations:

- **`StringBuilder` is the WORST choice for a fixed handful of pieces** — 152 bytes per call
  against 48 for interpolation.
- **`a + "-" + b + "-" + c` (5 pieces) costs 112 bytes** where four pieces cost 48, because the
  compiler falls back to `String.Concat(string[])`. Writing `string.Concat(...)` explicitly
  stays at 48, binding to the `params ReadOnlySpan<string>` overload added in .NET 9.
- **Pre-sizing a `StringBuilder` barely helps and hurts if you over-estimate**: exact capacity
  saved 2%, a 2x over-estimate cost 47% more than not sizing at all. It holds a linked list of
  chunks, not one buffer it doubles — the opposite of `List<T>`.
- **`stackalloc` inside a loop really does crash.** Writing `07-exercise-solutions.cs` produced
  a genuine `Stack overflow.` before the CA2014 warning was heeded. Stack memory is released
  when the method returns, not when the iteration ends.

### `t1-08-classes-and-objects/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-classes-and-instances.cs` | One class, many objects; static vs instance state; constructor chaining; `required`; identity vs contents. | Debug |
| `02-initialisation-order.cs` | The exact order: **derived field initialisers, base field initialisers, base constructor, derived constructor, object initialiser**. | Debug |
| `03-virtual-call-in-constructor.cs` | A `NullReferenceException` thrown from inside a base constructor, because the derived override ran too early. | Debug |
| `04-static-constructors.cs` | Lazy, exactly-once, thread-safe — and that a throwing static constructor **poisons the type even after the cause is fixed**. | Debug |
| `05-object-lifetime.cs` | 24 bytes for an empty object; generation promotion; finalisers needing two steps; reachability vs scope. | **Release** |
| `06-compile-error-probe.cs` | CS0191, CS0200, CS7036, CS9035 verbatim. **Does not compile by design.** | n/a |
| `07-exercise-solutions.cs` | Exercises 1, 2 and 4, plus the `Lazy<T>` exception-caching measurement. | **Release** |

Three results worth carrying forward:

- **A poisoned type is never revived.** `04-static-constructors.cs` sets the missing environment
  variable at run time and retries: the static constructor does not re-run, and the same cached
  `TypeInitializationException` is replayed. Only a restart clears it.
- **`Lazy<T>` caches exceptions by default.** Measured over three accesses to an always-throwing
  factory: the default ran the factory **once**, `LazyThreadSafetyMode.PublicationOnly` ran it
  **three times**. The default has the same permanent-failure problem as a static constructor.
- **`IReadOnlyList<T>` is a compile-time contract only.** The runtime type is still `List`1`,
  so a determined caller can cast back and mutate it.


### `t1-09-encapsulation/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-invariants.cs` | The same data with public fields accepts a negative quantity and a negative price; with the rules attached to the type, both are rejected, at construction and at assignment. | Debug |
| `02-what-a-property-is.cs` | A property compiles to `get_X`/`set_X` methods plus a `<X>k__BackingField` whose name cannot be typed in C#. A computed property has no backing field at all. | Debug |
| `03-property-cost.cs` | Field, auto-property and validating-property reads are indistinguishable across 200M reads. A `virtual` property costs ~6x once a second type is in play. | **Release** |
| `04-leaking-state.cs` | Returning the `List` breaks the invariant; `IReadOnlyList` is castable back to `List<T>`; `ReadOnlyCollection` blocks it but is a live view, not a snapshot. Also the cost of each defence. | **Release** |
| `05-private-is-not-security.cs` | Reflection reads a private field, writes a `readonly` one, and resets a quota. | Debug |
| `06-property-side-effects.cs` | One LINQ chain over 1,000 objects calls a computed getter 1,670 times; the stored equivalent is 138x faster. | **Release** |
| `07-access-modifiers.cs` | All six levels read back off compiled metadata, plus the defaults (members `private`, top-level types `internal`). | Debug |
| `08-throwing-property.cs` | A getter that divides by zero surfaces as `TargetInvocationException` from the serialiser, naming no property, and takes a whole batch with it. | Debug |
| `09-production-order.cs` | The complete worked example: four invariants enforced rather than documented, with an `internal InvariantsHold()` a test can assert. | Debug |
| `10-exercises.cs` | Every answer claimed in the module's exercises. Includes the `double`-vs-`decimal` division-by-zero difference and where the resulting `Infinity` actually fails. | Debug |

Three multi-assembly demonstrations build through `.csproj` files rather than as
file-based apps, so **exclude them from the file-based sweep**:

| Directory | What it proves |
| --- | --- |
| `binary-break/` | Field → property is source-compatible and **binary-incompatible**. Build the app against v1, swap in a v2 `Contracts.dll`, and the untouched `App.exe` dies with `MissingFieldException` (exit 127). Then v3 adds validation *inside* the property and the same untouched exe keeps working. |
| `across-assemblies/` | Where `internal`, `protected`, `protected internal` and `private protected` actually diverge, plus `InternalsVisibleTo`. Swapping in a library built without the attribute makes an untouched consumer fail at runtime with `FieldAccessException` — proof the CLR enforces this, not only the compiler. |
| `file-modifier/` | Two `file class Formatter` declarations coexist in one assembly; the compiler renames them with a per-file hash. |

`across-assemblies/probe/` is a **compile-error probe**: it is not meant to build.
`probe/README.txt` records which error each line produces, with and without
`InternalsVisibleTo`, from clean trees.

To reproduce the `binary-break` sequence:

```bash
cd verification/t1-09-encapsulation/binary-break
cp contracts/PricingConfig.v1.txt contracts/PricingConfig.cs
dotnet build app/App.csproj -c Release -o out-v1 --no-incremental
./out-v1/App.exe                      # works

cp contracts/PricingConfig.v2.txt contracts/PricingConfig.cs
dotnet build contracts/Contracts.csproj -c Release -o out-v2 --no-incremental
cp out-v2/Contracts.dll out-v1/Contracts.dll
./out-v1/App.exe                      # MissingFieldException, exit 127
```


### `t1-10-inheritance/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-you-inherit.cs` | A derived instance carries its base's private fields (they occupy memory) while being unable to name them. Constructors are not inherited. | Debug |
| `02-constructor-chaining.cs` | Across three levels, field initialisers run derived→base and constructor bodies run base→derived; `base(...)` arguments are evaluated before the base constructor. `: this(...)` runs the other constructor's body first. | Debug |
| `03-fragile-base-class.cs` | A subclass overriding both `Add` and `AddRange` double-counts, because the base's `AddRange` routes through `Add` — a fact invisible from the public surface. | Debug |
| `04-base-and-hiding.cs` | `base.M()` is a non-virtual call. A hidden member gives one object two answers depending on the reference's declared type. | Debug |
| `05-compile-errors.cs.txt` | **Compile-error probe, not meant to build.** Records CS7036, CS0509, CS0122, CS0108 (warning only), CS0506, CS1721. Each verified in isolation as well, because a hard error suppresses later analysis. | — |
| `06-production-hierarchy.cs` | Template method done properly: non-virtual `Process` owning validation, audit and error handling; one `abstract` hook; private audit trail a subclass cannot reach even when it throws. | Debug |
| `07-protected-state.cs` | Two `protected` members let a subclass produce entries summing to 150 against a total of 75. The private version with one `protected virtual` decision hook cannot be broken. | Debug |
| `08-exercises.cs` | Every answer claimed in the exercises. Includes the sharpened constructor result: a virtual call from a base constructor sees derived **field initialisers** already run and the derived **constructor body** not. | Debug |

`fragile-across-versions/` is a two-assembly demonstration and builds through `.csproj` files, so
**exclude it from the file-based sweep**. It is the module's centrepiece: BagLib v1 implements
`AddRange` as a loop over `Add`; v2 writes to the backing list directly, a reasonable performance
fix with an identical public surface. The untouched application's audit count goes from 3 to 0,
with no exception, no warning, and no log line — **and a full clean rebuild does not fix it**,
which is the contrast with the `MissingFieldException` in `t1-09-encapsulation/binary-break/`.

```bash
cd verification/t1-10-inheritance/fragile-across-versions
cp baglib/ItemBag.v1.txt baglib/ItemBag.cs
dotnet build app/App.csproj -c Release -o out --no-incremental
./out/App.exe                       # audit recorded : 3

cp baglib/ItemBag.v2.txt baglib/ItemBag.cs
rm -rf baglib/obj baglib/bin
dotnet build baglib/BagLib.csproj -c Release -o out-v2 --no-incremental
cp out-v2/BagLib.dll out/BagLib.dll
./out/App.exe                       # audit recorded : 0, silently
```

### `t1-11-polymorphism/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-dispatch-basics.cs` | `override` reaches base-class callers; `new` does not. The diagnostic signature of hiding: `GetType()` reports the derived type while the base behaviour runs. | Debug |
| `02-dispatch-cost.cs` | With one type at a call site every shape (non-virtual, virtual, interface, abstract) is indistinguishable — 94–131 ms per 100M calls. With four types, virtual is ~3.5× and interface ~5–6×. Includes a same-loop single-type control. Pass `-- poly` for the multi-type run. | **Release** |
| `03-the-method-table.cs` | The first word of every object equals `GetType().TypeHandle.Value`. Two `Dog`s share it, a `Cat` differs. Uses `unsafe`; a demonstration of CoreCLR internals, never a technique. | **Release** |
| `04-override-new-sealed.cs` | What each declaration does to the slot, read from metadata: `override` → `IsVirtual=True`; `sealed override` → `IsFinal=True`; `new` → **`IsVirtual=False`**, never in the slot. Also covariant return types. | Debug |
| `05-production-rules.cs` | A four-rule validator, genuinely polymorphic, at 366 ns per order — of which dispatch is about **3%**. The number that makes the 3.5× multiplier interpretable. | **Release** |
| `06-exercises.cs` | Every answer claimed in the exercises, including overload-resolution-before-dispatch: the same object and argument giving different results through different reference types. | **Release** |

> **Benchmarking note, learned the hard way.** The first version of `02-dispatch-cost.cs` reported
> that a `sealed` class was *four times slower* than an unsealed one. Two scenarios shared one loop
> method, so they shared a call site and therefore one dynamic-PGO type profile; the second
> scenario was measuring guard failures. Every scenario now has its own loop method, the
> polymorphic cases run in a separate process, and there is a single-type control using the
> identical loop shape. Sharing a call site between benchmarks silently measures the wrong thing.

### `t1-12-abstraction-and-interfaces/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-abstract-vs-virtual.cs` | `abstract` vs `virtual` vs neither, read off metadata. An abstract class may inherit from another and leave members unimplemented; only a concrete class must complete them. | Debug |
| `02-explicit-implementation.cs` | One object with three different `Write` methods. Explicit members are absent from the class's public surface and appear in metadata as private and final. | Debug |
| `03-default-interface-methods.cs` | A default is a member of the **interface**: `typeof(Payment).GetMethod("AuditLine")` is `null`. Also that two interfaces sharing a method *name* are **not** a diamond, and what a real one looks like. | Debug |
| `04-compile-errors.cs.txt` | **Compile-error probe, not meant to build.** CS1061, CS8705, CS0144, CS0534, CS0535, CS0106. CS1061, CS8705 and CS0144 were each verified in isolation. | — |
| `05-static-abstract.cs` | `static abstract` interface members let a generic method call `T.Parse(...)` with no instance and no reflection. Plus `INumber<T>` generic math — note `Mean(2,4,6,9)` returns 5, because `T` is `int`. | **Release** |
| `06-production.cs` | Interfaces for boundaries (`IClock`, `IDeliveryLog`) and an abstract class for shared mechanism, in one component, with test doubles showing why the interfaces exist. | Debug |
| `07-exercises.cs` | Every answer claimed in the exercises. | Debug |

`interface-versioning/` is a two-assembly demonstration built through `.csproj` files, so
**exclude it from the file-based sweep**. It shows that adding a member to a published interface
is both a source break and a binary break, and that a default implementation avoids both:

```bash
cd verification/t1-12-abstraction-and-interfaces/interface-versioning
cp lib/INotifier.v1.txt lib/INotifier.cs
dotnet build app/App.csproj -c Release -o out --no-incremental
./out/App.exe                       # works

# v2: a new member, no default
cp lib/INotifier.v2.txt lib/INotifier.cs
rm -rf lib/obj lib/bin
dotnet build lib/Lib.csproj -c Release -o out-v2 --no-incremental
cp out-v2/Lib.dll out/Lib.dll
./out/App.exe                       # TypeLoadException, exit 127
dotnet build app/App.csproj -c Release -o out-rc --no-incremental   # CS0535

# v3: the same member WITH a default
cp lib/INotifier.v3.txt lib/INotifier.cs
rm -rf lib/obj lib/bin
dotnet build lib/Lib.csproj -c Release -o out-v3 --no-incremental
cp out-v3/Lib.dll out/Lib.dll
./out/App.exe                       # works, app never rebuilt
```

> **A correction worth keeping.** The first draft of that module claimed two interfaces declaring
> a method with the same name produce `CS8705`. The probe compiled cleanly, which is how the error
> was caught: they are *different members* that share a spelling, and a class may implement both
> while declaring nothing. A real diamond needs one base interface member with two competing
> implementations in unrelated derived interfaces. The wrong intuition matters because it sends
> you looking for the conflict in the wrong place.


### `t1-13-composition-over-inheritance/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-combinatorial-explosion.cs` | 2 destinations × *n* behaviours needs 2×2^n classes by inheritance (32 at n=4, 128 at n=6) against 2+n by composition. Also that layer ordering becomes a run-time choice. | Debug |
| `02-refactor.cs` | A four-level hierarchy and its composed equivalent, run side by side: outputs and traces identical, plus a combination the hierarchy could not express. | Debug |
| `03-cost.cs` | Each delegation layer costs ~2.5 ns (0.77, 3.19, 8.38, 23.14 ns for 0/1/3/8 layers). Zero wrappers is free — the JIT devirtualises and inlines. | **Release** |
| `04-what-wrapping-costs.cs` | Wrapping hides optional interfaces (`wrapped is IBatchCapable` → false), breaks reference identity, changes `GetType()`, and adds a stack frame per layer. Forwarding fixes the false negative by creating a false positive. | Debug |
| `05-delegates.cs` | Inheritance, interface and delegate all cost the same (25.6–25.9 ns/call) once the work is real `decimal` arithmetic. Type counts: 3 / 4 / 1. | **Release** |
| `06-production.cs` | Composition assembled from configuration, with a composition root. Note 4 charges produce only 3 audit entries — the ordering hazard in the module's own example. | Debug |
| `07-exercises.cs` | Every answer claimed in the exercises, including the layer-ordering result: `Cache(Audit(Work))` audits once for two requests, `Audit(Cache(Work))` audits twice. | Debug |

> **Benchmark caveat in `03-cost.cs`.** The no-call control measured consistently *slower*
> (1.16 ns) than a loop with one inlined virtual call (0.75 ns), across three samples. That is a
> codegen difference between two loop bodies, not a real cost of not calling a method. Only compare
> rows that share a loop shape — the four wrapper rows do, which is what makes the per-layer figure
> trustworthy.

### `t1-14-static-and-lifetime/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-static-basics.cs` | One slot per type; `const` vs `static readonly` vs mutable static in metadata; a static class compiles to abstract + sealed. Shows `const decimal` reporting `IsLiteral=False`. | Debug |
| `02-beforefieldinit.cs` | An **empty** static constructor removes `beforefieldinit` and changes when initialisation runs: calling a field-free static method initialised one class and not the other. | **Release** |
| `03-static-ctor-threading.cs` | 16 concurrent threads → 1 initialisation, no lock written. Four threads each blocked 307 ms for a 300 ms initialiser. And what a cycle really does. | **Release** |
| `04-static-state.cs` | Two concurrent requests both read `[globex]`; a shared `Dictionary` throws and ends with **524 entries for 500 keys**; `CultureInfo.CurrentCulture` changes formatting for every library on the thread. | **Release** |
| `05-production.cs` | The four replacements: `static readonly` for immutable data, `Lazy<T>` for expensive setup, an injected instance for shared mutable state, `AsyncLocal<T>` for per-operation context. | **Release** |
| `06-exercises.cs` | Every answer claimed in the exercises, including the measured `LazyThreadSafetyMode` comparison. | **Release** |

`const-versioning/` is a two-assembly demonstration built through `.csproj` files, so **exclude it
from the file-based sweep**. It shows that a changed `const` is silently stale in a consumer that
was not rebuilt, while `static readonly` in the same class updates:

```bash
cd verification/t1-14-static-and-lifetime/const-versioning
cp lib/Config.v1.txt lib/Config.cs
dotnet build app/App.csproj -c Release -o out --no-incremental
./out/App.exe                       # 3 / 0.20 / 3 / 0.20

cp lib/Config.v2.txt lib/Config.cs
rm -rf lib/obj lib/bin
dotnet build lib/Lib.csproj -c Release -o out-v2 --no-incremental
cp out-v2/Lib.dll out/Lib.dll
./out/App.exe                       # 3 / 0.20 / 5 / 0.25  <-- consts stale
```

> **Two corrections this folder records.** First, **cyclic static initialisation does not deadlock**
> on .NET 10 — measured single-threaded and with two threads forced in simultaneously by a barrier.
> The runtime returns the *default value* of the field whose initialiser has not completed, so one
> value is silently built on a zero. Second, **`Lazy<T>` caches failures by default**:
> `ExecutionAndPublication` and `None` both rethrow the original exception forever; only
> `PublicationOnly` retries, at the cost of allowing the factory to run on several threads.

### `t1-15-structs-and-records/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-a-record-generates.cs` | Every generated member listed from metadata: `Equals`, `op_Equality`, `GetHashCode`, `ToString`, `PrintMembers`, `<Clone>$`, `EqualityContract`, `Deconstruct`. | Debug |
| `02-equality-traps.cs` | A record holding a `List` is not equal to one holding an identical list; nor are arrays; **nor `ImmutableArray<T>` or `ImmutableList<T>`**. `with` is a shallow copy. `EqualityContract` makes base and derived records unequal. | Debug |
| `03-struct-cost.cs` | Structs allocate **0 bytes and cause 0 gen0 collections**; the classes allocated 24/80 bytes and caused 918/3,060. But the small **class was faster** in all three samples. | **Release** |
| `04-readonly-and-mutation.cs` | No measurable defensive-copy cost when the JIT can inline; ~50% when it cannot (64-byte struct, inlining prevented). `list[0].Increment()` does nothing while `arr[0].Increment()` works. | **Release** |
| `05-production.cs` | `readonly record struct` for small values, `sealed record` for larger ones, custom `Equals`/`GetHashCode` for the one holding a collection, and a `with` that copies the array. Also that `default(Sku)` bypasses validation. | Debug |
| `06-exercises.cs` | Every answer claimed in the exercises. | Debug |

> **A correction worth keeping.** The first draft of that module claimed
> `ImmutableArray<T>` gives a record value equality. It does not: it is a struct wrapping an array
> and its `Equals` compares that array **by reference**, so two records holding separately created
> immutable arrays are not equal. `ImmutableList<T>` behaves the same way. **No built-in collection
> type gives a record value equality** — the fix is a custom `Equals`/`GetHashCode` pair, or a
> member type that already has value equality such as `string`.


### `t1-16-equality-and-hashing/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-the-contract.cs` | Equal objects with different hash codes: `ContainsKey` returns false **without ever calling `Equals`**, and a `HashSet` of two equal items has `Count == 2`. Emits `CS0659` on purpose (suppressed). | Debug |
| `02-mutable-keys.cs` | A key mutated after insertion is unreachable by *any* lookup including its own object, `Remove` fails, and inserting an equal key adds a **second** entry printing identically. | Debug |
| `03-hash-quality.cs` | A constant hash code is legal and **1,300× slower to insert, 6,000× slower to look up** at 40,000 keys. Quadratic scaling shown across three sizes. Also `A^B` colliding for swapped pairs. | **Release** |
| `04-struct-equality.cs` | A struct without `IEquatable<T>` compares through reflection: **134 ns vs 1.6 ns** (80–95×), and 176 bytes allocated per boxed comparison. Prints which comparer `EqualityComparer<T>.Default` picked. | **Release** |
| `05-comparers.cs` | `==` vs `Equals` diverging for the same two strings held as `object`. Custom vs built-in `StringComparer`. An inconsistent `IComparer` producing an unsorted array **with no exception**. | Debug |
| `06-production.cs` | A key type built to the contract, with the equality test and a hash-distribution check (892 of 1,024 buckets used). | **Release** |
| `07-exercises.cs` | Every answer claimed. Includes `List.Contains → True` while `Dictionary.ContainsKey → False` for the same pair, and `X^Y` giving **128 distinct hashes for 10,000 keys**. | **Release** |

### `t1-17-generics/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-why-not-object.cs` | `ArrayList` allocated **120 MB for 5M ints** (24 bytes each) against zero for a pre-sized `List<int>`; reads 2.92 vs 0.83 ns. | **Release** |
| `02-specialisation.cs` | Each closed generic type has its **own static fields** — the clearest evidence a closed type is a real type. Also `default(T)` per kind. | Debug |
| `03-variance.cs` | `out`/`in` demonstrated, `List<T>` invariance explained by `Add`, and array covariance throwing `ArrayTypeMismatchException` at run time. | Debug |
| `04-compile-errors.cs.txt` | **Compile-error probe.** CS1503, CS0029, CS1961, CS0019, CS0411, and CS0266 for a variance conversion with a **struct** argument. Four verified in isolation. | — |
| `05-production.cs` | A covariant `Result<T>`, a generic `Cache<TKey,TValue>`, and the demonstration that variance does **not** work for value type arguments. | Debug |
| `06-exercises.cs` | Every answer claimed. Includes `List<object>` allocating **48 MB — identical to `ArrayList`** — and the array-covariance store check measuring as a null result. | **Release** |

### `t1-18-generic-constraints/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-each-unlocks.cs` | Every constraint and the exact capability it grants, plus `T?` meaning `Nullable<T>` under `struct` and an annotation under `class` (`typeof(string?)` is `CS8639`). | Debug |
| `02-what-constraints-cost.cs` | **`new()` is not free**: about the same as `Activator.CreateInstance` and ~40% slower than a `Func<T>` factory. The struct constraint's win is **24 bytes → 0**, not time. | **Release** |
| `03-compile-errors.cs.txt` | **Compile-error probe.** CS1061, CS0304, CS0310, CS0315, CS0401, CS0449, and CS8714 — which is a **warning**, and only with nullable enabled. | — |
| `04-production.cs` | A repository whose four constraints each unlock exactly one line, and `INumber<T>` statistics over four numeric types. | Debug |
| `05-exercises.cs` | Every answer claimed. | **Release** |

### `t1-19-collections-overview/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-lookup-cost.cs` | Five collections at five sizes. `List` goes 1.2 → 595 ms while `HashSet` stays flat — **540× at 100,000**. The shape is visible down the columns. | **Release** |
| `02-insert-and-grow.cs` | `Insert(0,…)` is **550× slower** than `Add`. Pre-sizing halves the time and cuts allocation 60%. `LinkedList` at 48 bytes/element. Capacity doubling shown. | **Release** |
| `03-iteration-and-order.cs` | Iteration is cheap for everything except trees. And a `Dictionary` reusing a removed key's slot, so `cherry` appears **in the middle** where `banana` was. | **Release** |
| `04-production.cs` | The same catalogue twice: **321×**, **31×** and **15,000×**, and **1.05 GB → 40 bytes**, with identical calling code. | **Release** |
| `05-exercises.cs` | Every answer claimed, including bytes per element across five collection types (4.0 to 48.0). | **Release** |

> **A benchmark-design note.** Exercise 1's first version probed with `i % n` and 20,000 lookups,
> which only touches the first 20,000 values once n exceeds that — so the scan found them early and
> the linear growth was hidden (n=10,000 and n=100,000 measured the same). It now uses a prime
> stride so lookups spread across the whole collection at every size.

### `t1-20-ienumerable-vs-icollection/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-the-hierarchy.cs` | Which members each interface declares, read from metadata. A LINQ query implements **only `IEnumerable<T>`**. And `ReadOnlyCollection<T>` **does** implement `IList<T>` — the type test passes and `Add` throws. | Debug |
| `02-deferred-execution.cs` | Five hazards: nothing runs until iteration; three passes cost three evaluations; a lazy sequence sees later changes; side effects and exceptions surface inside `foreach`; modifying during enumeration throws. | Debug |
| `03-what-the-type-costs.cs` | Declaring a variable `IEnumerable` costs **nothing** — LINQ type-tests and finds the `ICollection`. Wrapping a list in an iterator method costs **8.9× and 2.1× the allocation** on `ToList()`. | **Release** |
| `04-production.cs` | Four return-type decisions with their consequences, including a deferred query reporting 3 then 4, and a materialised top-3 staying stable. | Debug |
| `05-exercises.cs` | Every answer claimed. `Any()` runs the predicate **once**; three chained calls run it **25** times. | **Release** |

### `t1-21-delegates/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-a-delegate-is.cs` | A delegate is an object with `Target` and `Method`. Two delegates over the same instance method on the same object are **equal but not the same reference** — C# 11+ caches static method-group conversions, so those *are* reference-equal, which is why the demo uses instance methods. | Debug |
| `02-multicast.cs` | `MulticastDelegate`'s invocation list: `+=` builds a new list, only the **last** return value survives, an exception in one handler stops the rest, and `-=` on an unmatched target silently does nothing. Nullable typing (`Func<int,int>?`) is part of the lesson — `-=` can return null. | Debug |
| `03-invocation-cost.cs` | Delegate call **≈2.8 ns vs 1.5 ns** direct, and a 3-entry multicast chain ≈5× a 1-entry one. Every target is `[MethodImpl(NoInlining)]`: an earlier version marked only the direct target, so the lambda inlined and measured *faster than a direct call*. | **Release** |
| `04-production.cs` | Composition and ordering. `Compose(discount, vat, round)` and the reverse give **108.00 vs 110.00** — an earlier version used commutative multiplication and both orders agreed, proving nothing. | Debug |
| `05-exercises.cs` | Every answer claimed in the exercises. | Debug |

### `t1-22-lambdas-and-closures/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-the-closure-class.cs` | The generated types read from metadata: `<>c` for a cached non-capturing lambda, `<>c__DisplayClass` holding captured variables as fields. Needs `#:property NoWarn=IL2026;IL2070;IL2075` — `Assembly.GetTypes()` is trim-unsafe. | Debug |
| `02-loop-capture.cs` | `foreach` gives a fresh variable per iteration (C# 5+); `for` shares one. The classic "all the same value" result, and the per-iteration-copy fix. | Debug |
| `03-allocation.cs` | Non-capturing lambda **0 bytes** (cached), capturing **88 bytes per creation**, static method group **0 bytes**. Capturing an outer-scope local is 0 across 1,000 iterations because the closure hoists — the demo makes the captured value differ per iteration to show the real 88,000. | **Release** |
| `04-production.cs` | Capturing `this` keeps the whole object alive through a full GC; capturing a local copy does not. | **Release** |
| `05-exercises.cs` | Every answer claimed. | **Release** |

### `t1-23-events/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-event-vs-field.cs` | The `add_`/`remove_` accessors and the private backing field, read from metadata. External assignment to an event is **CS0070**, and a public delegate field lets any caller clear every subscriber. | Debug |
| `02-the-leak.cs` | 5 of 5 dropped widgets still alive after a full GC (**10 MB retained**) because the publisher holds them; dead subscribers still run their handlers. A naive weak-event attempt **survived the GC here too** — recorded as the hazard it is, not as an observed failure. | **Release** |
| `03-raising-and-fixes.cs` | The null-race and the `?.Invoke` fix, one bad subscriber silencing the rest, and the isolated raise site that keeps the remaining handlers running. | Debug |
| `04-exercises.cs` | Every answer claimed. Exercise 2 needs its `GC.Collect()` — without it the unsubscribe comparison reported 5 of 5 alive either way and was meaningless. | **Release** |

### `t1-24-linq-fundamentals/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-two-syntaxes.cs` | Query and method syntax produce the **same runtime type** (`IEnumerableSelectIterator\`2`), not merely the same results. Also what `let` lowers to, and the operators query syntax has no keyword for. | Debug |
| `02-operator-families.cs` | The three families by return type, and that `Single` on three matches throws `InvalidOperationException: Sequence contains more than one matching element` where `First` silently returns a row. | Debug |
| `03-production.cs` | The same report in both syntaxes, identical output; the composite anonymous-type key working because of generated value equality. | Debug |
| `04-exercises.cs` | Every answer claimed, including the full `First`/`Single`/`*OrDefault` matrix and `default(Sale) == returned : True` for a struct sequence. | Debug |
| `05-joins-and-flattening.cs` | Two `from` clauses consider **12 pairs for 3 results** where `join` builds a lookup; `join … into` is a **group join** (`Ada=2, Grace=1, Linus=0`) against a plain join's `Ada, Ada, Grace`; left outer join via `DefaultIfEmpty`; and an orphan row (`O-4`) that no join on the customer side can show. | Debug |

### `t1-25-deferred-execution/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-when-it-runs.cs` | **Zero** lambda calls after defining a query. The call log `where(1) where(2) select(2) …` shows element-at-a-time pulling. `Take(3)` pulls **6** elements from a million-element source; the same `Take(3)` after an `OrderBy` pulls **all 1,000,000** — deferred but buffering. | Debug |
| `02-multiple-enumeration.cs` | Three uses of one query = **6,003 predicate calls**; behind a method boundary, **9,000**. `Any()` **3 calls** vs `Count() > 0` **3,000**. `Count()` on a list seen as `IEnumerable<int>` **34 ms** vs **1,765.7 ms** with one `Where` in front. | **Release** |
| `03-allocation-and-cost.cs` | A three-operator pipeline over 200,000 elements allocates **144 bytes** — the loop allocates **0**. Projection to an anonymous type: **6,400,088 bytes**. Time **2.7×** the loop (12.9 ns vs 4.8 ns per element) but **4.6 µs** total over 100 elements. The harness stores results in a `double` field: `GC.KeepAlive` boxes, and added 24 bytes to every reading. | **Release** |
| `04-capture-in-queries.cs` | One query variable, never reassigned, gives `4, 5, 6` then `6` after a captured local changes. `foreach` vs `for` in query-building loops. A query enumerated after its `using` closes throws `ObjectDisposedException`. A `Select` nobody enumerates leaves its flag `False`. | Debug |
| `05-exercises.cs` | Every answer claimed: **202** predicate calls for three reads of a 100-element source; `Where`-then-`Select` runs **100** projections against **100,000**; the loop is **3.8× faster, saving 4.15 ms per pass**. | **Release** |
| `06-queryable-vs-enumerable.cs` | The same lambda text becomes a `Func<Order,bool>` over `IEnumerable<T>` and the readable tree `Order[].Where(o => (o.Region == "eu"))` over `IQueryable<T>`. Assigning mid-chain to an `IEnumerable<Order>` variable moves the next operator in-process — **identical results, no warning**. Needs `#:property NoWarn=IL2026;IL3050` for `AsQueryable`. | Debug |

### `t1-26-iterators-and-yield/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-the-state-machine.cs` | The generated class read from metadata: **one** class implementing both `IEnumerable<T>` and `IEnumerator<T>`, with `<>1__state`, `<>2__current` and `<>l__initialThreadId`. The first `GetEnumerator` returns the object **itself**; the second returns a copy. | Debug |
| `02-deferred-validation.cs` | Called with an invalid argument, an iterator method **returns an object without throwing**. The null case is worse: `NullReferenceException` from `MoveNext`. The validating-wrapper fix throws at the call site with `ParamName`. | Debug |
| `03-try-finally-and-dispose.cs` | `finally` runs for a complete `foreach`, a `break`, and an exception in the body. It does **not** run for an abandoned enumerator — verified through `GC.Collect()`, `WaitForPendingFinalizers()` and a second collect. | Debug |
| `04-production.cs` | Streaming a 300,000-row invoice export: **7 KB live against 47 MB (6,607×)** and **0.34 ms against 451.83 ms** to the first row — while *total* allocation is nearly identical (112 MB vs 120 MB), which is the claim people get wrong. | **Release** |
| `05-exercises.cs` | Every answer claimed. The reused-buffer trap: `ToList()` over chunks of 1..9 gives `7,8,9 \| 7,8,9 \| 7,8,9`, and allocating per chunk costs **792×** (536 vs 424,560 bytes). | **Release** |
| `06-compile-errors.cs.txt` | `CS1626`, `CS1631`, `CS1623` — what an iterator method may not contain. Stored as `.txt` because it is meant not to build. | — |
| `07-minimal-example.cs` | The module's infinite-`Fibonacci` example. | Debug |
| `08-async-iterators.cs` | `IAsyncEnumerable<T>`, and the cancellation trap: without `[EnumeratorCancellation]`, a 50 ms deadline over ~160 ms of work delivered **8 of 8 pages and no exception**. `CS8425` is quoted and suppressed so the file builds clean. | Debug |

### `t1-27-pattern-matching/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-the-pattern-kinds.cs` | All nine pattern kinds matching and not matching. `null is object` is **False** — a type pattern never matches null. Slice patterns bind the middle: `first=1 middle=[2,3,4] last=5`. | Debug |
| `02-switch-expressions.cs` | Covering every enum *name* is still not exhaustive (`CS8524`), and neither is covering every subtype of an abstract record (`CS8509`) — **C# has no closed hierarchies**. `SwitchExpressionException` names the value and nothing else. | Debug |
| `03-compile-errors.cs.txt` | `CS8510` (subsumption — an **error**) for relational, property and base-type arms; `CS8524`/`CS8509` (non-exhaustiveness — **warnings**); `CS8985`+`CS0021` for a list pattern on `IEnumerable<T>`. | — |
| `04-production.cs` | A 12-rule gateway router in one switch expression. Honest finding: the switch expression is **1.11–2.05× slower** than the if/else version across four runs (8–26 ns per event), because repeated arms of the same type re-do work an `if` chain does once. | **Release** |
| `05-what-goes-wrong.cs` | Eight failure modes that survive compilation, including `== null` throwing `NullReferenceException` from an overloaded operator while `is null` returns True, and a guard in the first arm running for **all four** inputs. | Debug |
| `06-exercises.cs` | Every answer claimed. `(object)5L is 5` is **False**; `5 is 5L` does not compile (`CS0266`). The validator: 10 decision lines against 22. | Debug |
| `07-minimal-example.cs` | The module's eight-rule `Render` example. | Debug |

### `t1-28-nullable-reference-types/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-flow-analysis.cs` | The headline finding: the compiler **narrows a property across two getter calls**, and the second call returned null — a `NullReferenceException` on a line with **no warning**. Also `typeof(string?)` is `CS8639`, and a dereference is itself an assertion. | Debug |
| `02-the-runtime-does-not-care.cs` | Four ways to get null into a non-nullable reference with no warning: JSON, reflection, `default(T)`, and an oblivious dependency. `!` emits no code. A null **test** undoes a `!`; `var` does not. | Debug |
| `03-attributes.cs` | `[NotNullWhen]`, `[MaybeNullWhen]`, `[NotNullIfNotNull]`, `[MemberNotNull]` — each shown removing a warning the annotation alone cannot. Nothing verifies an attribute. | Debug |
| `04-warnings.cs.txt` | `CS8602`, `CS8600`, `CS8603`, `CS8604`, `CS8618`, `CS8625` — each from a minimal case, and **all warnings**. Includes the one line that produces *no* warning although it should. | — |
| `05-production.cs` | An invoice lookup with `Find`/`Get`/`TryFind`, `required`, and boundary checks. `CS9035` for a missing required member is the **only error** in the whole feature. Two `!` operators in the file, both deliberate. | Debug |
| `06-exercises.cs` | Every answer claimed, including the property-read-twice `NullReferenceException` and the legacy-to-`required` migration. | Debug |

### `t1-29-exceptions/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-cost.cs` | A `try` block is **not free**: +2.3–3.4 ns/op, stable across four runs — an earlier version of this benchmark showed the try block as 3× *faster* because the first measurement in a process pays for warm-up. A throw is **2,916 ns** (132×), rising to **18,159 ns** at depth 32. Constructing the exception is 20 ns; throwing a *cached* instance still costs 1,816 ns. | **Release** |
| `02-mechanics.cs` | The two-pass model observed: `throw, FILTER, inner finally, outer finally, handler` — the filter runs **before** both `finally` blocks. `throw ex` loses the two frames that identify the defect. An exception in a `finally` **replaces** the original, with `InnerException` = none. | Debug |
| `03-production.cs` | A gateway client with a custom exception and a retry filter: a permanent failure is **never caught** (1 attempt, not 5). Validation with exceptions costs **126×** a `TryParse` at a 2-in-3 failure rate. | **Release** |
| `04-exercises.cs` | Every answer claimed. Four rethrow styles compared by surviving frames; `ExceptionDispatchInfo` keeps them all and **appends** a frame. The rate decides: **178×** at 90% invalid, **1.04×** at 0.01%. | **Release** |
| `05-minimal-example.cs` | The module's `Divide` example, showing `ParamName` and `ActualValue`. | Debug |

### `t1-30-extension-methods/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-they-are.cs` | A static method, in a static class, with `[Extension]` — read from metadata. It works on a **null receiver**; whether it throws depends only on the body. **C# 14 extension blocks** verified working: `"  ".IsBlank`, `new List<int>().IsEmpty`, and the static `Money.Zero`. | Debug |
| `02-resolution.cs` | An instance method wins **even when it is a worse match** (`Store(object)` beat `Store(int)` for an `int`). Resolution uses the **declared** type: one object gave two answers. Visibility comes from the file's `using`, not the type. | Debug |
| `03-production.cs` | The good case and the bad case side by side, plus shadowing demonstrated: `[extension]` became `[instance]` with no error and no warning. Cost is 9.56 ns vs 7.06 ns and should not drive a decision. | **Release** |
| `04-compile-errors.cs.txt` | `CS1106`, `CS1109`, `CS0121`, `CS1061`. Note the phasing: the two declaration errors **suppress** the two call-site errors on a first build. | — |
| `05-exercises.cs` | Every answer claimed. The static-vs-virtual contrast: extensions gave `[extension: Base]`/`[extension: Derived]` for one object where a virtual method gave `[virtual: Derived]` for both. | Debug |

### `t1-31-reflection-and-attributes/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-metadata.cs` | Reflection ignores three compile-time guarantees: it wrote to an `init`-only property, read a `private` member, and created an object with **every `required` member unset**. `Invoke` wraps the real exception in `TargetInvocationException`. `BindingFlags.NonPublic` alone returns **0**. | Debug |
| `02-cost.cs` | Discovery vs invocation, five ways. `GetProperty` 57.8 ns, `Type.GetType(string)` **1,401.5 ns**. `Invoke` 3× a direct call, `GetValue` 6×, both 24 bytes. `CreateDelegate` 15.2 ns/0 bytes for 400 ns of build; `Expression.Compile()` 5.5 ns/0 bytes for **120,346 ns**, break-even ~4,470 calls. Needs `#:property PublishAot=false` — see below. | **Release** |
| `03-production.cs` | An attribute-driven validator, cached vs naive: **14.5×** and **4.5×** allocation for identical output. Attribute `AllowMultiple` and `Inherited` verified. | **Release** |
| `04-trimming-and-aot.cs` | Run at the file-based-app default (`PublishAot=true`): `Expression.Compile()` silently becomes an **interpreter** — 258.0 ns and 176 bytes against 5.5 ns and 0 bytes — and is slower than the reflection it replaced. `CreateDelegate` stays at 6.7 ns. | **Release** |
| `05-exercises.cs` | Every answer claimed, including the plugin loader and the 19×→7×→1.3×→1.0× progression. | **Release** |

### `t1-32-source-generators/`

Not a set of file-based apps: a generator **must** be a separate `netstandard2.0` project referenced
with `OutputItemType="Analyzer"`, and that two-project shape is the lesson. Run it with
`verification/t1-32-source-generators/run.sh`, which builds, runs, and prints what was generated.

| File | What it proves |
| --- | --- |
| `run.sh` | Builds the generator and the consumer, runs the consumer, and cats every generated file. |
| `generator-demo/Ledger.Generators/AuditLogGenerator.cs` | A complete `IIncrementalGenerator`: post-initialisation output for the attribute, `ForAttributeWithMetadataName`, an **equatable model** with a hand-written `EquatableArray<T>`, and rendering. |
| `generator-demo/Ledger.Generators/Polyfills.cs` | `IsExternalInit`, needed because `netstandard2.0` predates `record`/`init`. Written after hitting `error CS0518` for real. |
| `generator-demo/Ledger.App/Ledger.App.csproj` | The consumer wiring, including `<Compile Remove="generated/**/*.cs" />` — added after `EmitCompilerGeneratedFiles` produced `CS0101`, `CS0579` and `CS0111` by compiling the generated files twice. |
| `generator-demo/Ledger.App/Program.cs` | Generated members called normally. **7.2× faster and half the allocation** against the reflective equivalent, for identical text. The generated method is indistinguishable in metadata. |
| `01-compile-errors.cs.txt` | `CS0260` (missing `partial`) and `CS0111` (hand-writing the generated member) — both reproduced, with the observed file and line. Note `CS0111` is reported **in the generated file**. |

**Requires a NuGet restore** for `Microsoft.CodeAnalysis.CSharp` 4.8.0. It was already in the local
package cache here; on a clean machine this is the one fixture in the repository that needs network
access once. Everything else, including the site itself, is offline.

## Measured on

| | |
| --- | --- |
| SDK | .NET 10.0.400 |
| OS | Windows 11 Pro (x64) |
| Date | 2026-08-30 |

Timing numbers are machine-specific. The lessons quote **ratios**, not absolute
milliseconds, for exactly this reason — across two runs the equality benchmark
gave 54 ms vs 10 ms and 80 ms vs 16 ms, both about 5x.

The same caution applies more strongly to `run-tiering-comparison.sh`. Process
startup on a desktop machine is noisy: the ReadyToRun result was 1.9x in one
session and 1.5x in another. The **direction** was identical every time, and
that is what the lesson claims. Run it yourself before quoting a figure.
