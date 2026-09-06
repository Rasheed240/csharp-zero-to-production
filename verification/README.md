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

### `t2-01-threads-and-scheduling/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-a-thread-is.cs` | The process already holds 8 OS threads before you create one. Locals are private, the heap is shared. `new Thread(...)` is **foreground** by default — the reason services hang on shutdown. The stack-depth probe shows the stacks differ but deliberately does NOT claim to measure their size: `EnsureSufficientExecutionStack` reserves a fixed headroom, so the 11.1x ratio is not the 4x the sizes would suggest. | Debug |
| `02-cost-of-threads.cs` | Creating a thread **552 us** against **15 us** to dispatch to a pooled one — **37x**, the justification for t2-02. An idle thread costs **24 KB of working set**, not the 1 MB reserved. Oversubscription with work held fixed: 176 ms on 4 threads, 115 ms on 64, **243 ms on 4,096**. | **Release** |
| `03-concurrency-vs-parallelism.cs` | The track's central distinction, same thread counts both times: CPU-bound saturates below 3x; I/O-bound reaches **33.81x on 32 threads**. 64 blocked threads cost **0.98x**. And the same I/O work async: same elapsed time on **12 OS threads against 40**. | **Release** |
| `04-production.cs` | Ledger settlement, three designs, growing batch. At 512: thread-per-item 699 ms / 389 threads, bounded pool 1,591 ms / 51 threads, async **630 ms / 19 threads**. Thread-per-item is the FASTEST at batch 8, which is the trap. | **Release** |
| `05-exercises.cs` | Every answer claimed, including the worker-sizing table for a 90%-waiting workload. Exercise 1 divides a fixed total across threads — an earlier version gave each thread the full workload and produced a table that appeared to show threads hurting CPU-bound work. | **Release** |
| `06-yielding.cs` | **`Thread.Sleep(1)` takes 15.5 ms**, not 1 — the Windows timer resolution; `Task.Delay(1)` matches. 8 spinning threads cost **3.05x** where 8 blocked cost **1.07x** and `SpinWait` costs **0.91x**. Thread priority measured as a non-guarantee: Lowest **567M** iterations, Highest **532M**. | **Release** |

**A measurement this folder deliberately does not make:** context-switch counts. Windows exposes
them through ETW or a performance counter needing elevation, and neither belongs in a file run with
`dotnet run`. An earlier draft had a `ContextSwitches()` helper that returned the thread count under
that label; it was deleted rather than shipped. The oversubscription cost is shown through timings,
and the OS-thread column is labelled as what it is.

### `t2-02-thread-pool/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-the-pool.cs` | Pool limits and reuse: **2,000 work items ran on 8 distinct threads**, the busiest handling 349. `QueueUserWorkItem`, `Task.Run`, timer callbacks and continuations all land on the same pool. | **Release** |
| `02-injection.cs` | The module's central measurement. Past the minimum, the pool adds threads at roughly **one per 500 ms**: item 9 starts at 514 ms, item 10 at 1,028 ms, item 24 at 11,214 ms. After 11.2 s, **24 of 60 items have started**. | **Release** |
| `03-starvation.cs` | Blocking on `.Result`: **2,917 ms, 29.2x** slower, 52 threads created. `await`: 110 ms, 0 created. `SetMinThreads`: 140 ms but **151 threads created** — a lever, not a fix. Reports threads *created during the run*, not peaks, because the pool retires threads slowly and later runs inherit earlier ones. | **Release** |
| `04-queues.cs` | `preferLocal: false` 338 ms against `true` 284 ms (**1.19x**). Work stealing: 4,000 items queued by ONE pool thread ran on 7 threads (619, 612, 576, 568, 553, 537, 535). The header documents an earlier version that tried to show LIFO ordering and printed a scrambled sequence — the ordering of one queue is not observable from outside, so the claim was withdrawn rather than dressed up. | **Release** |
| `05-production.cs` | Ledger `RateService`. Blocking: p50 **127 ms**, p99 **2,145 ms**. `SetMinThreads`: p99 105 ms, 105 threads. Async: p99 **103 ms**, **0 threads created**. An earlier draft stubbed the percentile helper to return `(0, 0)`; it now times each request into a sorted array. | **Release** |
| `06-exercises.cs` | Every answer claimed. 20th item starts at **7,667 ms**. `.Wait()` 1,200 ms/19 threads against `await` 110 ms/0. `SetMinThreads(200)`: 120 blocking calls 126 ms, 400 calls **4,028 ms**. Ordered so `SetMinThreads` runs last — an earlier ordering inflated the pool and contaminated the work-stealing numbers. | **Release** |

### `t2-03-what-async-really-is/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-no-thread.cs` | The central claim, measured: 1,000 concurrent operations async against thread-per-operation — **371 ms vs 212 ms**, but **12 threads vs 1,012** and **520 KB vs 7,508 KB**. CPU work started and finished in 27 ms while 1,000 operations were mid-await on 8 pool threads. | **Release** |
| `02-not-parallel.cs` | Async is not parallelism. Sequential 613 ms against concurrent 202 ms. CPU-bound wrapped in async is **slower** (309/350/406 ms), not identical — the prose was corrected to match. `Parallel.For` 2.89x. | **Release** |
| `03-production.cs` | Ledger endpoint, 100 ms of waiting. At concurrency 200: sync **2,649 ms** total, async **104 ms** — on **18 threads either way**. The pool rationed rather than growing, so requests queued. Surfaces the telemetry trap: p99 reads **125 ms** for the run that took 2.6 s, because the clock starts after dequeue. | **Release** |
| `04-exercises.cs` | Every answer claimed, including where concurrency comes from — starting operations, not awaiting them. | **Release** |
| `05-minimal-example.cs` | Sequential 440 ms against concurrent 202 ms, in the smallest program that shows it. | **Release** |

### `t2-04-task-and-valuetask/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-a-task-is.cs` | A Task is hot: the call returned after 1 ms, a 150 ms sleep followed, total **229 ms** rather than 350. Awaiting twice ran the body **once**. `.Result` throws `AggregateException`; `await` throws the inner exception. | **Release** |
| `02-valuetask.cs` | All cache hits: Task **80 bytes/call**, ValueTask **0**. All misses: Task 112, ValueTask **128** — worse. The type is a bet on the synchronous path. | **Release** |
| `03-production.cs` | Ledger rate cache across a hit-rate gradient: 100% hit saves 100% (72 to 0 bytes), 90% saves 64%, 0% saves nothing. Plus `TaskCompletionSource` wrapping a callback gateway, with `RunContinuationsAsynchronously`. | **Release** |
| `04-exercises.cs` | Every answer claimed, including `RunContinuationsAsynchronously` proved by thread id: without it the continuation runs **inline on the completing thread (10)**; with it, **10 -> 5**. | **Release** |
| `05-minimal-example.cs` | `WaitingForActivation` before the await, `RanToCompletion` after; awaiting twice returns 5 without re-running. | **Release** |

### `t2-05-async-state-machine/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-the-generated-type.cs` | Reads the generated `<Method>d__N` structs out of the assembly's own metadata: `<>1__state`, `<>t__builder`, hoisted locals, `<>u__1`. Confirms `is a STRUCT : True` in Release. Awaits a hand-written `Countdown` type to show the awaiter pattern is **structural, not an interface**. | **Release** |
| `02-cost.cs` | The two paths. Not suspending: **72 bytes / ~50 ns** for `Task<int>`, **0 bytes** for `ValueTask<int>` (and it is the slowest row in ns — it buys memory with time). Suspending: **96 bytes / 1,185 ns**. Five awaits suspended **0 times** warm and **3** cold. Depth 1→16 costs exactly **72 bytes per layer**. The header documents an earlier version that returned `1` from every method and read 0 bytes throughout — the runtime caches Tasks for small ints and both bools, so the benchmark was measuring the cache. | **Release** |
| `03-failure-modes.cs` | Exception traces are **clean** (`Program.InnerAsync()` with line numbers) since .NET Core 2.1 — the `MoveNext` noise in older articles is gone. The **physical** stack captured at the same moment shows no caller at all, only pool frames. `async void` escaping a try/catch. `async` lambda becoming `async void` by delegate type. An unobserved Task exception evaporating, then caught by `UnobservedTaskException`. A suspended machine on **no thread's stack**. | **Release** |
| `04-production.cs` | Ledger settlement export: `List<T>.ForEach` with an async lambda returns in **7 ms having written 0 of 200**, throws nothing, and exits zero. The builder table finds the single `AsyncVoidMethodBuilder` in the assembly. Then hoisting: the same 8 MB buffer read *after* an await holds **400 MB across 50 suspended operations**; read *before*, **0 MB**. | **Release** |
| `05-exercises.cs` | Every answer claimed. Which locals are hoisted (liveness, not declaration order). 13 state machines from 11 methods + 2 lambdas. Five allocation variants. Where an early `throw` surfaces. Suspension count driving cost: 0/2/5 suspensions → 0/760/1,624 bytes. | **Release** |
| `06-minimal-example.cs` | Four fields of one state machine, in 30 lines. | **Release** |

**Two measurement mistakes this folder documents rather than hides.** `02-cost.cs` originally returned `1` from every method and reported 0 bytes for all of them, which would have argued the opposite of the truth. `05-exercises.cs` originally used `GC.GetAllocatedBytesForCurrentThread()` and reported the same 472 bytes for two and five suspensions — continuations run on **pool** threads, so the per-thread counter missed most of the allocation; it uses `GC.GetTotalAllocatedBytes(precise: true)`. A third: a name-based filter for `d__` found **zero** async-void lambdas, because lambda state machines are named `<<Method>b__N_M>d`; the code now filters on the `IAsyncStateMachine` interface.

### `t2-06-synchronizationcontext/`

Every file here builds its own single-threaded `SynchronizationContext`, because no host that can run
`dotnet run` has one. The deadlocking cases are bounded by a **1,500 ms timeout** so each program
terminates and reports; every row marked `DEADLOCKED` is a genuine, permanent deadlock.

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-a-context-is.cs` | `SynchronizationContext.Current` is **null** in a console app. Under a single-threaded context a plain await resumes on **thread 8, not a pool thread**; `ConfigureAwait(false)` resumes on thread 7. And the line most descriptions omit: after leaving the context, a **later plain await does not bring you back** — there is nothing left to capture. | **Release** |
| `02-the-deadlock.cs` | `.Result`, `.Wait()` and `GetAwaiter().GetResult()` all deadlock identically under a context — they differ only in exception wrapping. Three things that avoid it: `ConfigureAwait(false)` (60 ms), awaiting instead of blocking (69 ms), and having no context at all (61 ms) — the last being why the bug is invisible in ASP.NET Core rather than a fix anyone chooses. | **Release** |
| `03-production.cs` | Ledger.Payments 3.2.0 under three hosts: WPF context **DEADLOCKED**, WPF with `ConfigureAwait(false)` ok, ASP.NET Core ok — **identical library code**. `ConfigureAwait(false)` measured at **0 bytes and within noise on time**. And `AsyncLocal<T>` **survives** it, because `ExecutionContext` is a different mechanism from `SynchronizationContext`. | **Release** |
| `04-exercises.cs` | Every answer claimed. The strongest result: `ConfigureAwait(false)` on the **first await only** completes when that await suspends and **deadlocks when it completes synchronously** — so a partially-fixed library fails intermittently, on exactly the requests where a cache was warm. | **Release** |
| `05-minimal-example.cs` | Capture and non-capture in four lines of output. | **Release** |

**A deadlock reproduced by accident.** The first version of `01-what-a-context-is.cs` gave its context
a `Run(Action)` helper that posted work and then blocked the pump thread on a `ManualResetEventSlim`.
It hung on the first `await` and had to be killed — the exact deadlock the module teaches. The helper
is now `RunAsync(Func<Task>)`, which never blocks the context thread, and the incident is recorded in
the file header. `02-the-deadlock.cs` reproduces the broken shape deliberately, with a timeout.

A second correction worth noting: an early version of `02-the-deadlock.cs` shared one static
completion signal across scenarios, and a late continuation from a previous row set it — making a
50 ms operation report **1 ms**. Each scenario now gets its own signal.

### `t2-07-sync-over-async-deadlocks/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-where-blocking-is-forced.cs` | The five places C# gives you a synchronous signature — constructor, property getter, `Dispose`, an interface you do not own, an override — and a working pattern at each: the async factory, a method instead of a property, `IAsyncDisposable`, and precomputation. Also that `async Main` has been legal since C# 7.1, so the entry point is not one of them. | **Release** |
| `02-the-bad-options.cs` | The ranking, for when you genuinely cannot restructure. `await` **72 ms / 10 threads**; `.Result` **2,827 ms / 44**; **`Task.Run(...).Result` 15,071 ms / 68 — 5.3x worse than the plain blocking call it is meant to improve on**, because it uses two pool threads per operation; `SetMinThreads` 68 ms / 83. | **Release** |
| `03-production.cs` | Ledger's tax-rules cache. A blocking constructor, harmless as a singleton, became an outage when the DI lifetime changed to Scoped: p99 **2,439 ms against 211 ms** and **150 remote calls against 1**. Then the race in the obvious fix: `_rules ??= await Fetch()` produced **150 fetches from 150 callers**; `SemaphoreSlim` with a re-check and `Lazy<Task<T>>` each produced 1. | **Release** |
| `04-exercises.cs` | Every answer claimed. All four blocking spellings measured at the same per-call cost (they differ in exception wrapping and thread count, not speed). The table deliberately omits an `await` row and says why: a file that must block in `Main` cannot honestly measure not-blocking. | **Release** |
| `05-minimal-example.cs` | The blocking constructor and the async factory, in 45 lines. | **Release** |

### `t2-08-cancellation/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-cooperative.cs` | Cancellation is a request, not a command: work cancelled at **0 ms ran to completion at 505 ms** because it never checked. `TaskCanceledException` derives from `OperationCanceledException`. `Canceled` is a terminal state distinct from `Faulted`. | **Release** |
| `02-linking-and-timeouts.cs` | `CreateLinkedTokenSource` plus `CancelAfter`, and telling a caller cancellation from a timeout afterwards (the linked token is cancelled in both cases, so you must ask the original source). The leak: **10,000 undisposed linked sources retained 1,406 KB** against a long-lived parent, with nothing else holding a reference. | **Release** |
| `03-production.cs` | Ledger's statement export with the token dropped one layer down: **3,000 of 3,000 pages rendered after every client had disconnected**, against 240 with the token threaded — 1,544 ms against 132 ms. Plus the linked-source leak in a hosted service: **3,437 KB per 10,000 jobs**. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the test that catches a dropped token — and why asserting only on the exception passes against the broken version. | **Release** |
| `05-minimal-example.cs` | Two methods differing by four characters (`, ct`): one ran to completion in 346 ms, the other stopped after 68. | **Release** |

**A claim this folder corrected.** A widely repeated rule says that throwing a bare `OperationCanceledException`, rather than one carrying the token, makes a task *fault* rather than cancel. On .NET 10 that is not what happens: measured across four combinations, the status was `Canceled` every time. What differs is the token the exception carries, which is what a catch filter needs to distinguish a caller giving up from a timeout. The module reports the measurement rather than the folklore.

### `t2-09-iasyncenumerable/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-streaming.cs` | The three shapes over 200,000 rows: buffered **103.8 MB / first item at 2,761 ms**; `IEnumerable<T>` 2.4 MB / 6 ms but must block; `IAsyncEnumerable<T>` **0.6 MB / 17 ms**. Total time is the same for all three — streaming is not faster. The generated type is a **class** (unlike t2-05's struct) and implements `IValueTaskSource`, which is how 200,000 items cost a fraction of a megabyte. | **Release** |
| `02-cancellation.cs` | Without `[EnumeratorCancellation]`, `WithCancellation` is silently a no-op: **100 items produced against 5**. Both tokens are linked automatically when supplied at call and enumeration. `await foreach` runs the iterator's `finally` on `break`; manual enumeration without disposing **never runs it at all**, because async iterators have no finaliser. | **Release** |
| `03-production.cs` | Ledger's CSV export at three account sizes: buffered **4.9 / 45.7 / 214.4 MB** with TTFB **483 / 4,917 / 24,591 ms**, against a streamed column that does not grow. Then the failure that only exists when streaming: a reader error at row 30,000 produced **`200 OK` plus a valid-looking CSV missing 40% of its rows**. | **Release** |
| `04-exercises.cs` | Every answer claimed: an async iterator is **cold** (0 items produced at the call), enumerating twice runs the producer twice (6 items from a 3-item stream), and the buffer-or-stream decision with both arguments against streaming. | **Release** |
| `05-minimal-example.cs` | Timestamps showing the consumer handling row 1 at 119 ms while the producer had not yet fetched row 2. | **Release** |

**A claim this folder corrected.** An early draft of `04-exercises.cs` asserted that nothing in the toolchain catches a missing `[EnumeratorCancellation]`. The compiler emitted **CS8425** on the very next build, which says exactly that. Both files now suppress CS8425 explicitly — with a comment saying why — because they need the broken version in order to measure it, and the modules tell the reader to treat it as an error.

### `t2-10-parallelism/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-when-parallel-helps.cs` | Work per item decides everything: **0.33x with no work, rising to 5.55x** on 8 cores. I/O measured three ways — sequential 3,272 ms, `Parallel.For` 384 ms (8.5x), `Task.WhenAll` **15 ms (214x)** — so `Parallel` "works" on I/O by consuming a thread per operation. `MaxDegreeOfParallelism` scaling flattens at the core count (5.75x at 8, 5.96x at 16, 5.65x at 64). PLINQ **4.18x** with an expensive predicate and **0.35x** with a trivial one. | **Release** |
| `02-production.cs` | Ledger's month-end revaluation. A shared accumulator lost **85% of the value** with no exception and a different figure every run. All three correct shapes match to within **10⁻¹⁸** — not exactly, because parallel aggregation adds in a different order, so `Assert.Equal` fails on correct code. Unbounded parallelism in a request handler: p95 **13 → 203 ms** from 1 to 16 concurrent requests. | **Release** |
| `03-exercises.cs` | Every answer claimed. `List<T>.Add` under `Parallel.For` lost roughly half the items with a different count each run. `AggregateException` collected 3 of 3 failures — and the file states plainly that the count is not guaranteed. | **Release** |
| `04-minimal-example.cs` | The same loop at 0.29x and 6.88x, deciding on one variable. | **Release** |

**Two claims this folder corrected.** An early version of section 5 asserted that plain `AsParallel()` scrambles output order and printed two identical rows, proving nothing — for an indexable source consumed with `ToArray`, PLINQ reassembles by partition index and the output usually *is* in order. The section now measures **processing** order, which is genuinely arbitrary, and says plainly that result ordering is an implementation detail rather than a contract. Separately, capping `MaxDegreeOfParallelism` **did not improve p95** on this short uniform workload — it was worse at every concurrency — and the module reports that and explains what capping actually buys instead.

### `t2-11-race-conditions/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-interleaving.cs` | The two mechanisms, separately. Atomicity: 8 threads × 200,000 increments gave plain **575,135**, **volatile 371,485 — worse than plain**, `Interlocked` and `lock` exact. Visibility: a plain `bool` polled in a loop **never exited** (still spinning at the 2 s timeout) while the `volatile` one exited in 102 ms. Uncontended costs: plain 2.83 ns, volatile 2.86, `Interlocked` 9.97, `lock` 27.78. | **Release** |
| `02-production.cs` | Ledger's duplicate-payment bug across 200 trials with 8 threads on one key: check-then-act **3 of 200 double-charged**; `lock` and `ConcurrentDictionary.TryAdd` 0; and **`GetOrAdd` with a side effect in the factory 1 of 200**, because the factory is not guaranteed to run once. Called sequentially, the broken version charges exactly once — which is why every test passed. | **Release** |
| `03-exercises.cs` | Every answer claimed. The headline measurement: the **same racy counter was correct in 19 of 20 runs at low contention and 0 of 20 at high**, with no change to the code. | **Release** |
| `04-minimal-example.cs` | Plain and `volatile` both losing roughly two thirds of a million increments; `Interlocked` exact. | **Release** |

**On reproducing races deliberately.** Both files create their threads, park them all on one `ManualResetEventSlim`, and release them together. Starting threads in a loop lets the first finish before the last begins and the window never opens — an early version of `03-exercises.cs` also wrapped the check in a lock and reported **0 of 200** failures for code that is definitely broken. Widening the window on purpose is the difference between a test that demonstrates a race and one that gives false assurance.

### `t2-12-locking/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-what-lock-is.cs` | What the keyword expands to, reentrancy (three nested entries on one thread), and `System.Threading.Lock` from .NET 9. The trap: a `Lock` typed as `object` silently reverts to `Monitor` — verified. String literals are **interned**, so two classes locking on the same text share one monitor. | **Release** |
| `02-granularity.cs` | Contention falling from **1,812 to 58** across one lock, 16 stripes, 256 stripes and one lock per bucket, with time falling only 33%. Computing inside the lock instead of before it cost **8.42x**. | **Release** |
| `03-deadlock.cs` | A lock-ordering deadlock reproduced **deterministically**, and three fixes: ordering (213 ms), `TryEnter` with backoff (92 ms), one lock (1 ms). | **Release** |
| `04-production.cs` | Ledger's netting service with a 20 ms remote call inside the lock: **8.0x slower with 24x the contention**, same answer, same remote calls. Then an unlocked read against locked writes throwing in **20 of 40 trials**. | **Release** |
| `05-exercises.cs` | Every answer claimed, including `SemaphoreSlim(1,1)` deadlocking where a monitor nests happily. | **Release** |
| `06-minimal-example.cs` | 182,813 of 800,000 increments without a lock; 800,000 with one. | **Release** |

**A harness bug worth recording.** The first version of `03-deadlock.cs` used a `Barrier` to force the interleaving. Under a correct lock ordering both threads want the *same* first lock, so the second never arrives at the barrier — and the file reported the **ordered** strategy as deadlocked when the deadlock was entirely in the harness. It now uses a `CountdownEvent` with a timeout, which forces the overlap where one is possible and falls through where it is not.

**CS9216 is suppressed in `01-what-lock-is.cs`** so the file can demonstrate the `object`-typed `Lock` trap. The compiler warns about that conversion by default, which the module reports as the good news.

### `t2-13-interlocked-and-lockfree/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-atomics.cs` | Which operations return the before-value and which the after, and why. A CAS loop over a **converging** value (`Max`) retried **0** times; one where every iteration must swap (`Sum`) retried **183,628** times for 160,000 operations. Two atomic writes still tore an invariant in **20 of 20** trials. | **Release** |
| `02-production.cs` | Ledger's latency statistics. `Interlocked` on two fields kept every total correct and produced an impossible mean in **30 of 30** trials. The lock-free fix is correct and measured **several times slower than a plain lock**, with 3.4 million CAS retries. | **Release** |
| `03-exercises.cs` | Every answer claimed. Atomics beat a lock on one counter (lock 1.80x) and **lose** on a two-field snapshot (CAS 2.46x) — same machine, opposite conclusions. | **Release** |
| `04-minimal-example.cs` | What `Interlocked` fixes and what it does not, in 60 lines. | **Release** |

**A demonstration that had to be rebuilt.** The retry-count claim originally used only `Max`, which reported **0 retries** — the value converges, so most threads exit before attempting a swap, and the file proved the opposite of its own prose. Adding a `Sum` loop where every iteration must swap gives the contrast, and the contrast is the actual cost model.

### `t2-14-async-coordination/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-throttling.cs` | `Task.WhenAll` peaked at **200 concurrent** where `SemaphoreSlim(10)` and `Parallel.ForEachAsync(10)` peaked at exactly **10**. Three permits lost to exceptions left **0**. `Wait()` measured **78x** `WaitAsync()`. `SemaphoreSlim(2)` reached a count of **4** after stray releases; the two-argument form throws. | **Release** |
| `02-channels.cs` | Unbounded held several times the memory of `Bounded(100)` and reports **`CanCount == false`**, so its depth cannot be graphed. `DropWrite` and `DropOldest` silently lost 40–60% of items. A consumer without `Writer.Complete()` **hangs having read everything**. | **Release** |
| `03-production.cs` | Ledger's webhook dispatcher: **3,000 concurrent requests and 12.0 MB** unbounded, against **8 and 5.0 MB** with a bounded channel and a semaphore. Back pressure slowed the producer 1.32x. Shutdown without `Complete()` hangs. | **Release** |
| `04-exercises.cs` | Every answer claimed. | **Release** |
| `05-minimal-example.cs` | A limit that limits, and a channel that shuts down cleanly, in 50 lines. | **Release** |

**Two honest negatives reported rather than buried.** `SingleReader`/`SingleWriter` measured **1.00x** — no gain on a one-producer, one-consumer benchmark — so the module says to set them because they are *true*, not because they are faster. And the unbounded channel's depth column reads `n/a` rather than a misleading `0`, because `CanCount` is false.

### `t2-15-concurrent-collections/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-guarantees.cs` | The complete list of atomic operations. `GetOrAdd`'s factory ran **131 times** for one key with every caller receiving the same value; with `Lazy<T>` it ran **once**. Enumeration saw 17,215 items while 318,341 were added, **without throwing** — contrast the plain `Dictionary` in t2-12. `Count` measured **45x** `IsEmpty`. `ConcurrentBag` drained by a foreign thread cost 1.72x. | **Release** |
| `02-production.cs` | Ledger's rate limiter admitted **16 against a limit of 10** in 5 of 30 trials, with the dictionary behaving perfectly throughout. The per-key **lock measured two to three times faster** than `AddOrUpdate`. 400,000 keys retained 41.8 MB with no eviction. | **Release** |
| `03-exercises.cs` | Every answer claimed. | **Release** |
| `04-minimal-example.cs` | `TryAdd`: one winner. `ContainsKey` then assign: **12 of 16 threads** believed they had added it. | **Release** |

**Two measurements corrected.** A `Count`-versus-`ToArray` label described a comparison the code did not make (it measured `IsEmpty`), and the `ConcurrentBag` demonstration printed `1000 / 1000` — proving both drains work rather than showing what thread affinity costs. It now times the two drains and reports the ratio.

### `t2-16-gc-fundamentals/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-generations.cs` | Promotion observed: gen 0 → 1 → 2 across three forced collections. A `byte[24]` costs **48 bytes**. Identical allocation gave **35/0/0** collections when dropped and **20/12/4** when kept, an 18x time difference. A forced gen 2 collection measured **458x** a gen 0. | **Release** |
| `02-production.cs` | Ledger's 30-second response cache and the mid-life crisis. Growing it from 1,000 to 100,000 entries cost **77 MB and 315x the time**. Comparable live bytes held as **2.54 million objects against 20,000** made collections **50x** more expensive. A static event kept **10,000 of 10,000** subscribers alive, all freed the moment it was cleared. | **Release** |
| `03-exercises.cs` | Every answer claimed. | **Release** |
| `04-minimal-example.cs` | Promotion and the cost of survival, in 45 lines. | **Release** |

**A benchmark that had to be rescaled, and one that had to be dropped.** The object-graph comparison originally timed *construction* as well as collection, so it reported the cost of building a tree (100x) rather than of marking one. Rewritten to time only the collections, it then showed **1.03x — no difference at all** — because fixed per-collection overhead dominates on a small heap. At ten times the live set the real effect appears at **0.02x**. The module reports both, because "a GC micro-benchmark on a small heap mostly measures the cost of starting a collection" is the more useful lesson.

Separately, the lifetime table originally carried a relative-time column in which the **middle row came out faster than the baseline**. The wall-clock cost there is dominated by allocation rather than collection, so the column was removed and the exact generation counts are quoted instead.

### `t2-17-gc-tuning/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-loh.cs` | The LOH threshold to the exact element: `byte[84,975]` is 84,999 bytes and stays on the normal heap; `byte[84,976]` is exactly 85,000 and does not. Large objects are born in **gen 2** and never promoted. Alternating allocation left **25.9% of the LOH as unusable holes**; `CompactOnce` cut fragmentation **1,092x** and returned 13.3 MB. Churning 4,000 large buffers cost **196 gen 2 collections against 0**. | **Release** |
| `02-allocation-pressure.cs` | Identical allocation volume at five survival rates. Pause time spanned **0.4 ms to 64 ms** with no change in bytes allocated. The gen 0 count **falls** as survival rises (28 → 15), so a dashboard counting collections reports the worst row as the healthiest. `GetTotalAllocatedBytes` read 620.1 MB against an 11.7 MB live heap. | **Release** |
| `03-workstation-gc.cs` / `04-server-gc.cs` | The same workload under both collectors. **Byte-identical below the header** — `diff` them. Server GC was **3.22x faster** on 8 threads and **1.85x faster single-threaded**, and used **1.77x the working set** and 3.19x the committed memory. | **Release** |
| `05-datas.cs` | Self-measuring: re-launches its own built executable with `DOTNET_GCDynamicAdaptationMode` set to 1 and then 0. DATAS off used **2.0x the working set** and 2.3x the committed memory, for a quarter of the gen 0 collections. | **Release** |
| `06-production.cs` | Ledger's month-end export. Buffered: 78 MB allocated, 49.6 MB of LOH, both the string and the byte array in gen 2. Streamed: **13 MB and 3.4 MB**, peak memory independent of export size. Fragmentation reproduced at **230.3 MB of heap holding 22.9 MB of live data — 89% waste**. | **Release** |
| `07-exercises.cs` | Every answer claimed. The headline: an 80,000-byte buffer caused **500 gen 0 collections and no gen 2**; the same loop at 100,000 bytes caused **3,240 / 3,240 / 540**. | **Release** |
| `08-minimal-example.cs` | The threshold and its consequence, in 45 lines. | **Release** |

**A deferral from session 19 that turned out to be wrong.** That session recorded server-GC measurement as impossible because "the file-based app format cannot express a second process configuration". It can: .NET 10 file-based apps accept `#:property` lines, so `03` and `04` differ only in their header and are otherwise byte-identical. The comparison in the module is real rather than described.

**A prediction contradicted and kept.** The comment in `03` originally said server GC would lose the single-threaded case, having no thread count to exploit. It won, by 1.85x, because its gen 0 budget is far larger — 21 collections against 55. The file now records the wrong prediction alongside the measurement.

**Two claims corrected against the runtime.** `07` asserted that `ArrayPool<byte>.Shared` stops pooling above 1 MB, which is widely repeated and was true of an older implementation. Measured on .NET 10 by renting, returning and renting again: **pooled at 1 MB, 2 MB, 16 MB and 128 MB**. Separately, exercise 4 originally claimed that halving the survival rate cuts gen 1 and gen 2 counts; it leaves the counts **unchanged** and halves the pause anyway, which is a better lesson and the opposite of what was written.

**There is no MSBuild property for DATAS.** `#:property GCDynamicAdaptationMode=false` is silently ignored — verified, it changed nothing. The knob is the runtimeconfig entry or the environment variable, and it is not exposed as an `AppContext` switch, so a process cannot report its own setting.

### `t2-18-finalisers-and-idisposable/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-dispose-basics.cs` | `using` as `try`/`finally`: disposal runs **before** the catch, nested resources dispose in reverse order, a `using` declaration ends at its enclosing block. 1,000 objects abandoned without disposal produced **zero** disposals. Three `Dispose` calls ran cleanup **once**. | **Release** |
| `02-finalisers.cs` | A finalisable object survives the collection that finds it unreachable: after collection 1, **0 finalised**; after draining the queue, 1,000; the memory needs a second collection. 200,000 finalisable objects still held **2.4 MB** after one collection that reclaimed the plain equivalents entirely. Disposing properly ran **0** finalisers; not disposing ran **1,000**. Finalisation order came out **D, C, B, A, E** — stable across runs, and neither creation nor reverse order. | **Release** |
| `03-async-disposable.cs` | A type implementing both interfaces takes the **synchronous** path under a plain `using`, with no compiler warning. Nested `await using` is sequential: three 20 ms closes cost 60 ms. An exception from disposal **replaced** the body's exception and erased it from the logs. `await foreach` disposes the iterator on `break`. | **Release** |
| `04-production.cs` | Ledger's archiver leaking exactly **1.00 handles per file** — 100 files, 100 handles, a straight line. Forcing a collection reclaimed **exactly 400 of 400**. The `using` version stayed flat at +1 regardless of file count. | **Release** |
| `05-exercises.cs` | Every answer claimed. The event-subscription leak: **5,000 of 5,000 subscribers alive** without unsubscribing, **0 of 5,000** with. `DisposeAsync` on a background worker reports `loop actually finished: True`, which is the assertion worth testing. | **Release** |
| `06-minimal-example.cs` | Dispose is deterministic, finalisation is not, and nothing calls Dispose for you — in 60 lines. | **Release** |

**A measurement that measured nothing, and the ordering fix.** `04`'s safety-net section originally ran *after* the `using` section, which begins with a forced collection — so by the time it sampled, the leaked handles had already been reclaimed and it reported **0**. Reordered so the safety net is measured while the leak is live, it reports exactly 400. The section numbering was corrected to match.

**A prose claim contradicted by its own table.** The same file asserted "two handles per file — one for the file, one for its lock" and measured **1.00**. Corrected.

**An honest negative.** `03`'s blocking-versus-async disposal comparison measured **809 ms against 781 ms** — essentially identical wall clock. The module says so explicitly, because "async disposal is faster" is the most common misreading and the benefit is thread occupancy rather than elapsed time.

### `t2-19-span-and-memory/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-span-basics.cs` | A span is a view: writing through it changes the array. One type over the heap, the stack and unmanaged memory. Four million nested slices allocated **40 bytes of fixed setup**. Bounds are still checked — an index past the span's length throws even though the array has an element there. Substring parsing: **36.8 MB against 336 bytes**. | **Release** |
| `02-compile-errors.cs` | **Does not build by design** — a catalogue of every `ref struct` restriction with the exact compiler message. Also the legal cases, which matter more. | *(skipped by sweep)* |
| `03-memory-and-async.cs` | `Memory<T>` is 16 bytes and survives an await. `.Span` costs about 5 ns. The ownership bug reproduced deterministically: a caller's `"CUSTOMER-000512 GBP 1234.50"` became **`"ATTACKER-999 USD 0.01XXXXXX"`** after another tenant rented the same pooled buffer. | **Release** |
| `04-production.cs` | Ledger's settlement parser, 400,000 records. Substring 184 B/record and 22 gen 0 collections; span **0 B and none**; UTF-8 bytes 0 B. All three produce identical totals, which the file asserts. | **Release** |
| `05-exercises.cs` | Every answer claimed. `array[..100]` copies (424 B/call) where `array.AsSpan()[..100]` does not. Overlapping `CopyTo` gives `[1,1,2,3,5,6]`; a hand-written forward loop gives `[1,1,1,1,5,6]`. | **Release** |
| `06-minimal-example.cs` | View versus copy, 16 MB against 336 bytes, in 60 lines. | **Release** |

**Two error codes in wide circulation are wrong on .NET 10.** The async/iterator restriction is **CS4007**, not CS4013; the generic-argument restriction is **CS9244**, not CS0306. Each rule had to be compiled as a separate file to capture its message, because the compiler stops at the first declaration-level error and reports none of the rest.

**A rule taught more strictly than the compiler enforces it.** "You cannot use a `Span` in an async method" is false. CS4007 says *cannot be preserved across* an await — a span created and finished with before the await compiles cleanly, and the legal cases at the bottom of `02` are verified to build. The same distinction applies to iterators: **one `yield return` after a span is legal, two is not.**

**The headline claim reversed under repetition.** The span rewrite's *time* advantage measured 1.67x, 1.27x, 1.06x, **0.91x** and 1.69x across five runs — including one where the span version was slower. The allocation result is deterministic (184 B/record to 0 on every run). The module now argues from allocation and states the time range explicitly, including that it contains 1.0.

**A demonstration that proved nothing.** `05`'s `CollectionsMarshal.AsSpan` example wrote through the span, added an item, wrote again — and the second write landed, because the `Add` fitted inside the existing capacity. Rewritten to show both cases: a write after an `Add` **within** capacity lands, a write after an `Add` that **resizes** does not, and nothing warns you which you got.

### `t2-20-zero-allocation/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-pooling.cs` | `Rent(100)` returns **128**. A rented buffer arrives dirty: tenant two wrote `"OK"` and read back **`"OKSTOMER-000512 GBP 1234.50"`**. Returning the same array twice hands **the same instance to two renters**, and renter A's 111 becomes 222. Not returning allocated **156.7 MB** where returning allocated nothing. | **Release** |
| `02-searchvalues.cs` | `IndexOfAny` with an inline array allocates **36 bytes per call**. `SearchValues` measured 27 ms against a `HashSet` loop's 280 ms — and **lost** to plain `IndexOf` for a single character, 39 ms against 15 ms. | **Release** |
| `03-hot-path.cs` | One method rewritten five times. Allocation falls **188 → 169 → 83 → 0 → 0** bytes per operation, deterministically. Time does **not**: the pooled version allocates nothing and is slower than the version allocating 83 bytes, on every run. | **Release** |
| `04-production.cs` | The allocations with no `new` in them: a captured local **88 B**, `params object[]` **88 B**, interface-typed `foreach` **40 B**, `params int[]` **120 B**. Ledger's handler 675 B/request to 216. | **Release** |
| `05-exercises.cs` | Every answer claimed. Pooling **loses** below a kilobyte (0.62x at 32 bytes) and wins by 1,656x at a megabyte. A bounded object pool with its reset policy written out. | **Release** |
| `06-minimal-example.cs` | Zero allocation is not the same as fast, in 70 lines: the pooled 64-byte buffer is the slowest of the three strategies. | **Release** |

**The module's central finding is a negative one.** In `03`, version 4 allocates **zero bytes and is slower than version 3**, which allocates 83 per call — on every run measured. Renting and returning a 64-byte buffer costs more than allocating one. An earlier draft of the analysis claimed each step was an improvement and that v1 → v2 was the biggest win; measured, v1 → v2 is the biggest **time** win at 19 bytes, and v2 → v3 is the biggest **allocation** win at 86.

**Three rows of `04` originally read 0 bytes for three different reasons**, and all three were measurement bugs rather than results: the closure was hoisted out of the measured lambda by declaring its captured local outside; overload resolution quietly preferred a generic logging method over the `params` one; and the runtime's `Task<int>` cache for results in −1..8 hid the async allocation. The file now shows each allocating construct beside the version that does not, and returns 1,000 rather than 1 from the async probe.

**A pool demonstration that landed in the wrong bucket.** `05`'s dirty-buffer exercise rented 64 bytes and then 10, which round to different buckets — so no reuse happened and the leak did not reproduce. Both rents are now 50.

### `t2-21-string-without-allocation/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-string-costs.cs` | 22 bytes of overhead plus 2 per character: `"GBP"` costs **32 bytes for 3 bytes of information**. `ToUpperInvariant` allocates 64 bytes on lowercase input and **0 on input that is already uppercase** — same method, different data. `ToUpper() ==` comparison allocated 160 MB where `OrdinalIgnoreCase` allocated 376 bytes. | **Release** |
| `02-interpolated-handlers.cs` | What `$"..."` lowers to, written out by hand and compared. With logging disabled: a string parameter formatted **500,000 values and allocated 76 MB**; a custom handler formatted **0 and allocated 376 bytes**, with no guard at the call site. A side-effecting argument ran **0 times** disabled and 1 enabled. | **Release** |
| `03-utf8.cs` | `"GBP"u8` against `Encoding.UTF8.GetBytes` — 912 bytes against 64 MB. Parsing a request line to a payment id with no string created. Byte index 10 against character index 9 for the same letter, and slicing at 9 bytes producing a replacement character. | **Release** |
| `04-production.cs` | Ledger's audit writer: **288 → 198 → 80 → 0** bytes per 56-byte line, with the output length asserted identical at every step. | **Release** |
| `05-exercises.cs` | Every answer claimed, including a settlement-record parser that validates currency, amount and date entirely from UTF-8 bytes. | **Release** |
| `06-minimal-example.cs` | UTF-16 cost, ordinal comparison and `Utf8.TryWrite`, in 90 lines. | **Release** |

**`Utf8.TryWrite` is not allocation-free, and the reason took a dedicated measurement.** Version 3 of the audit writer stopped at 80 bytes per line rather than 0, and reading the code gave no clue why. Probing one interpolation hole at a time: literals and **string** holes cost nothing, while every **value-type** hole costs 24 to 32 bytes — 24 for a `long`, 24 for a `DateTime`, 32 for a `decimal`, and 24 + 24 + 32 = 80. The handler's generic `AppendFormatted<T>` boxes the value while testing for the fast formatting path.

An earlier draft recommended shipping v3 while claiming it "matched v4 on allocation". It does not, and the recommendation now carries the number and the caveat. The first attempt to explain the gap blamed the enum being interpolated; replacing it with a `u8` lookup changed the figure by **exactly nothing**, which is recorded in the file.

**Two more corrections from the same file.** `string.Create` initially allocated **more** than the interpolation it was meant to beat — 112 bytes against 104 — because computing the exact length called `id.ToString()`. It now counts digits arithmetically. And in the cache-key exercise, interpolation and `string.Create` both reach the **allocation floor** of 56 bytes for a 16-character string, so `string.Create` wins nothing there and is slower and fifteen lines longer; the exercise says so rather than implying a progression.

### `t2-22-streams-and-buffering/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-stream-contract.cs` | A stream serving 8 bytes per call: a request for 35 returned **8**, and the decoded record is a quarter present and three quarters zeros. `ReadExactly` fills it in 5 reads and throws `EndOfStreamException` on a truncated source. A `StreamWriter` held **all 30 bytes** until `Flush`. | **Release** |
| `02-buffering.cs` | 65,536 single-byte writes: **65,536 calls to the underlying stream against 16** through a 4 KB buffer. A buffer-size sweep from 4 KB to 1 MB, where the read count halves predictably and the time stops improving past 64 KB. The LOH boundary at `byte[84,976]`. | **Release** |
| `03-async-io.cs` | `File.OpenRead` gives `IsAsync = False`. `ReadAsync(byte[])` allocated **112 bytes per read** against **0** for the `Memory` overload. 60 concurrent readers of a 20 ms stream: **7x the time at the same peak thread count**. | **Release** |
| `04-production.cs` | Ledger's importer at three file sizes. `ReadAllText` peak **11.6 → 39.8 → 157.2 MB**; streamed peak **1.2 → 0.8 → 2.8 MB**. One scales with the file and one does not. | **Release** |
| `05-exercises.cs` | Every answer claimed. A decorator counting what it *asked for* reported **95 bytes against an actual 35**. A transform holding the file peaked at 41.5 MB against 3.4 MB streamed. | **Release** |
| `06-minimal-example.cs` | The short read and `ReadExactly`, in 90 lines. | **Release** |

**An honest negative that reversed the section it was in.** `02`'s double-buffering section was written to show that wrapping an already-buffered `FileStream` costs an extra copy. Measured at 64 KB reads it costs **1.03x — nothing at all**, because `FileStream` bypasses its own buffer for reads that large. The section was renamed and now shows both cases: 1.43x *gain* at 512-byte reads, no measurable change at 64 KB. The argument against the wrap is that it is a layer doing nothing, not that it is slow.

**A measurement that measured nothing, twice over.** `03`'s concurrency section first counted threads with `ThreadPool.ThreadCount - availableWorker`, which compares against the *maximum* rather than the live count and reported 0 for both strategies. It also read a 4 MB local file, which is far too fast to starve anything. Rewritten with a monitor thread sampling `ThreadPool.ThreadCount` and a stream that takes 20 ms per read, the real finding appeared - and it is better than the one intended: **the pool does not grow, it queues.**

**CA2022 caught this module's own code.** The analyser the module recommends flagged a discarded `ReadAsync` return value in `03`, in a file whose entire subject is that discarding it is a bug.

### `t2-23-pipelines/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-why-streams-are-hard.cs` | Three records delivered in 20-byte chunks: the naive parser finds **3 of 3** and every one is corrupt - `"|123450"`, `"0002|EUR|998877"`, `"042"`. The correct hand-written accumulator, with its four tangled concerns and 8 memory copies. | **Release** |
| `02-pipe-basics.cs` | A pipe keeping 20 unconsumed bytes and delivering 28 on the next read. `examined` set wrong: **1,063,104 reads in 200 ms**, all returning the same bytes. Back pressure: `FlushAsync` not completing until the reader drains. | **Release** |
| `03-sequencereader.cs` | A 27-byte record in four segments has an 8-byte `FirstSpan` and the delimiter is not in it. The single-segment fast path measured **5.9x** the general one. A `\r\n` split across a block: per-segment search **False**, `SequenceReader` **True**. | **Release** |
| `04-production.cs` | Both readers agree on count and checksum at 64, 4,096 and 65,536-byte chunks - and the pipe is **3x to 7x slower**. A hostile client sending 10,000 bytes with no delimiter rejected at a 256-byte limit. | **Release** |
| `05-exercises.cs` | Every answer claimed. `pauseWriterThreshold` at 1 MB let the pipe grow to 102,400 bytes; at 4 KB it held at 4,096. | **Release** |
| `06-minimal-example.cs` | `consumed` and `examined`, in 55 lines. | **Release** |

**The module's headline is a negative result.** `04` was written expecting the pipe to win. It loses - three to seven times, with both versions allocating essentially nothing - because the hand-written parser reuses one accumulator and parses with spans, and because the source is an in-memory array where the pipe's async machinery has nothing to hide behind. The verdict section was rewritten around that: a pipe is a correctness and back-pressure tool, not a throughput optimisation, and the file says so at the top now.

**An illegal API use that the first draft demonstrated by accident.** `05`'s back-pressure exercise tried to simulate ignoring back pressure by not awaiting `FlushAsync`. Calling `FlushAsync` again while one is pending is illegal and threw `InvalidOperationException`. Rewritten to compare two *threshold configurations*, which is the real decision, with the illegal case documented in a comment.

**A size limit that did not limit.** The same file's bounded-reader exercise checked only the undelimited remainder, so an oversized record *with* a delimiter passed straight through - the "one byte over the limit" row read `1 record, completed`. It now checks framed records too, and the boundary rows are exact: 64 bytes accepted, 65 rejected.

### `t2-24-benchmarkdotnet/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-why-timing-lies.cs` | A discarded result reporting **0.71 ns against 1.82 ns**. Tier 0 against steady state at **4.5x**. Twenty samples of identical work: **16.3% standard deviation, 1.63x spread**. Two effects looked for and *not* found. | **Release** |
| `02-a-harness.cs` | A harness with warmup, a pilot, 21 samples, median, error margin and allocation - and its most valuable output, **`NOT DISTINGUISHABLE from the baseline`** for a ratio that looks like a 22% win. | **Release** |
| `03-benchmarks-that-lie.cs` | A lookup whose winner reverses between 4 and 8 entries. The same method **9.5x slower on shuffled data than sorted**, purely from branch prediction. A real 3.2x on a parse producing **1.000x** on the request containing it. | **Release** |
| `04-production.cs` | The Ledger incident. The scan genuinely beats the Dictionary at 4 currencies and loses by **1,600x** at 4,000 fee codes - and reverses *again* at the same count when the keys change shape. | **Release** |
| `05-exercises.cs` | Every answer claimed. Ten timing measurements spread **1.09x**; ten allocation measurements were **byte-for-byte identical**. | **Release** |
| `06-minimal-example.cs` | Cold, warm-discarded and warm-consumed, plus the allocation figure that does not move. | **Release** |

**No BenchmarkDotNet package is available**, so `02` implements what it does by hand. That turned out better than a package reference: each defence in the harness is written next to the failure from `01` that motivates it, and the module can show its output rather than describe it. The real BenchmarkDotNet API is given in full with its `PackageReference`, along with the four things it does that the hand-rolled version does not.

**Two sections found nothing, and were rewritten to say so.** `01`'s ordering-effect and GC-interference sections were written expecting a first-mover penalty and cross-benchmark GC bills. Neither appeared: the four ordering numbers agree to a percent or two, and the two GC rows are identical. Both now report the null result and draw the better lesson - **any effect smaller than the 16% noise floor is undetectable**, which is why the noise floor is the first thing to measure.

**A premise that did not survive its own data.** `04` was originally written around a sorted array with binary search, on the assumption it would beat a `Dictionary` at small N. It does not - the Dictionary wins at every size measured. Rewritten around a linear scan, which genuinely does win at four entries, the incident became real. And the rewrite produced a second finding: the scan wins for 3-character currency codes and loses for 10-character fee codes **at the same count**, because the crossover moves with key length and how early keys differ.

**A cost claim corrected downward.** The same file first described the incident as adding "several CPU-seconds per second". Measured, it is 0.45 - about half a core and 1.1% of request latency. The conclusion now says that plainly and makes the point that actually holds: the cost is *linear in the number of fee codes*, so it arrives gradually as tenants are onboarded with no deployment to blame.

### `t2-25-diagnostics-tooling/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-counters.cs` | All 18 `System.Runtime` instruments, read in-process. 290 MB allocated against an **8 MB live heap** - the healthy signature. Thread-pool queue **0 → 424 → 0**. Lock contentions under `Parallel.For`. | **Release** |
| `02-events-and-traces.cs` | **1,185 real runtime events** including 324 `ContentionStart`/`Stop` pairs and 28 `GCStart_V2`, with the generation decoded from the payload. The `dotnet-trace` provider, keyword and level syntax mapped onto them. | **Release** |
| `03-production.cs` | Three incidents, one symptom. Allocation: 313 MB, 0.321 s pause, CPU/wall **0.87**. Blocked pool: queue **424**, CPU/wall **0.08**. Contention: **2,332**, CPU/wall **2.26**. Each moves one counter. | **Release** |
| `04-exercises.cs` | Every answer claimed. 214 MB allocated with a **0 MB** live heap against 230 MB with a **230 MB** heap. A custom `EventSource`, `Meter` and `ActivitySource` all captured with real payloads. | **Release** |
| `05-minimal-example.cs` | Allocation pressure against a blocked pool, told apart by two columns. | **Release** |

**None of the CLI tools is installed**, so every measurement is taken in-process from the same instruments and providers the tools read over EventPipe. The instrument names are the names the tools print and the command lines are given in full.

**The in-process route to runtime GC events took four attempts to find.** An `EventListener` on `Microsoft-Windows-DotNETRuntime` reported zero events; so did `EventSource.GetSources()`; so did a custom `EventSource`. The cause is that **`EventSourceSupport` is a trimming feature switch that defaults to false for file-based apps** - `OnEventSourceCreated` is never called at all, with no error. Adding `#:property EventSourceSupport=true` produced 1,185 events immediately.

That accident became the module's sharpest production warning: the same switch is a normal size optimisation on trimmed and AOT container images, and setting it false compiles your diagnostics and emits nothing while `dotnet-trace` records an empty file.

**A tagged-instrument bug worth recording.** `01` reported a heap size of **0 MB** because `dotnet.gc.last_collection.heap.size` is tagged *per generation* - one pull produces several measurements for the same instrument name, and overwriting on each callback keeps only the last tag. Summing within a pull gives 8 MB. The same bug is described in the module, because anyone writing a metrics exporter will hit it.

**`Activity.Tags` silently drops non-string tags.** `04` set `payment.id` as an integer and it did not appear in the output. `TagObjects` includes it. Corrected, with a comment, because a missing tag in a trace is not an error anywhere.

### `t3-01-http-fundamentals/`

| File | What it proves | Run in |
| --- | --- | --- |
| `01-on-the-wire.cs` | The literal bytes, read with a raw `TcpClient` against a real Kestrel. Chunked framing visible as `2\r\nhi\r\n0\r\n\r\n`. Four of the six response headers were added by the server unasked. 400 without `Host`, **405 with `Allow: GET`**, 404. | **Release** |
| `02-methods.cs` | Three identical requests: `POST` → **3 payments**, `PUT` → **1**, `DELETE` → **0**. A `GET` that cancels a payment, to show why safe means safe. Status codes differ across an idempotent retry (201 then 204). | **Release** |
| `03-status-codes.cs` | Thirteen codes with the client instruction each one carries. `Results.Forbid()` → **500** with no auth scheme registered, against `Results.StatusCode(403)` → 403. `200 {"success":false}` and what each layer does with it. | **Release** |
| `04-headers.cs` | Content negotiation across five `Accept` values including a 406. ETag → **304 with 0 body bytes** against 55. `Cache-Control` directives, `Vary`, and header casing/repetition (`X-Repeated: first, second`). | **Release** |
| `05-connections.cs` | Keep-alive: 6 requests over **1 connection**, and 6 over **6** with `Connection: close`. HTTP/1.1 vs cleartext HTTP/2 on separate Kestrel endpoints: **2 connections/320 ms against 1 connection/115 ms**. | **Release** |
| `06-production.cs` | The duplicate-charge incident. Three attempts against three endpoints: **3 charges, 2 charges, 1 charge**. | **Release** |
| `07-exercises.cs` | Every answer claimed in the module, including 5 simultaneous attempts with one key producing **1 order and 4 conflicts**. | **Release** |
| `08-minimal-example.cs` | Twelve steps of a correct API end to end: 422, 201+`Location`, replay, 400, ETag, 304, 204, idempotent `PUT` and `DELETE`, 404. | **Release** |

**The middle row of `06` is the finding.** The first draft claimed one charge from three attempts for the fixed endpoint and measured **two**. The endpoint recorded the idempotency key *after* the 60 ms gateway call, leaving a check-then-act window exactly as wide as the work: attempt 1 starts at t=0, attempt 2 arrives at t=40 and finds no key, attempt 1 records it at t=60. A `/v3/payments` reserving the key first with `ConcurrentDictionary.TryAdd` was added, and the module now walks all three.

**`Results.Forbid()` returns 500, not 403,** when no authentication scheme is registered — it delegates to the scheme's forbid handler and there is none. Found while building the status-code table, and now its own section, because it fails in exactly the environment where it is least expected.

**`Results.Unauthorized()` sends no `WWW-Authenticate` header.** The notable-header column for `/unauthorized` came back empty. A 401 is specified to carry one. Verified both ways in a probe: the bare helper sends nothing, and `response.Headers.WWWAuthenticate = "Bearer"` works.

**Content negotiation row 4 disproved its own prose.** The client sent `application/json, application/xml;q=0.9` — a clear preference for JSON — and got XML, because the server checks for XML first. The `q` values are ignored by anything that does not parse them, so the *server's check order* decides. The prose was rewritten around the measurement.

**`ListenLocalhost(0)` refuses a dynamic port** (it binds both IPv4 and IPv6 and cannot guarantee the OS picks the same one). `Listen(IPAddress.Loopback, 0)` is what `05` uses.

`02`, `06`, `07` and `08` carry `#:property PublishAot=false` alongside the reflection-JSON property. Without it the client-side JSON helpers emit ten `IL2026`/`IL3050` warnings per file, because file-based apps are AOT-analysed by default. `04-production.cs` in `t3-02` initially lacked the reflection-JSON property and every settlement returned **500** — worth knowing that a missing serialiser shows up as a status code, not an exception.

### `t3-02-hosting-model/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-the-smallest-host.cs` | Five phases, printed. `AddSingleton` does **not** construct — the constructor runs during the first request, four phases later. | **Release** |
| `01-startup-order.cs` | The full 11-step sequence. Registration after `Build()` throws. Two hosted services start in order and **stop in reverse**. Middleware in registration order in, reverse out. And section 4: **the port opens at 631 ms, after a hosted service that finished at 537 ms**. | **Release** |
| `02-services-and-scopes.cs` | The three lifetimes counted across three requests. A captive dependency shared across 3 scopes with `ValidateScopes = false` and caught with it on. 1000 transient disposables resolved from the root: **0 disposed**, against 1000 in scopes. | **Release** |
| `03-graceful-shutdown.cs` | An in-flight request drains (611 ms) while a new one is **refused at TCP level**. `ShutdownTimeout` swept at 200/800/1500 ms. A worker ignoring its token costs **511 ms and 10 extra iterations**; one honouring it, **3 ms and 0**. | **Release** |
| `04-production.cs` | The deploy incident. Three workers, identical send logic: **110/105/5 lost**, **40/35/5 lost**, **45/45/0 lost**. Then 20 in-flight requests all drained and **10 arriving 50 ms later all refused**. | **Release** |
| `05-exercises.cs` | Every answer claimed, including warm-up placement: `IHostedService` opens the port at **309 ms** and never serves early; `BackgroundService` opens it at **4 ms** and serves `NOT READY`. | **Release** |
| `06-minimal-example.cs` | One correct host under load: 10 accepted, 10 answered, 10 enqueued, **10 published, 0 lost**, with the whole lifecycle timeline printed. | **Release** |

**The startup ordering is the opposite of what is commonly repeated.** Your hosted services start *before* Kestrel opens its port, because `WebApplicationBuilder` registers the web host service during `Build()` — last. The good half is that warm-up in `StartAsync` cannot be raced by a request. The bad half is that a slow `StartAsync` delays the port opening and a hanging one means it never opens, which reads to a TCP probe as a dead pod.

**`ShutdownTimeout` is not the whole cost.** Swept across five values in a probe, `StopAsync` took the configured timeout **plus a constant ~1015 ms** (1016, 1011, 1010, 1015, 1021). Section 4 of the same file, which has no open connections, shows no such overhead — good evidence it is connection teardown. The module tells the reader to budget against the total rather than the setting.

**The v1 worker's loss could not be counted by the worker.** It ignores the token, so the host *abandons* it and no code after its loop ever runs — no flush, no logging, no accounting. The first version of the table reported `LOST: 0` for it. Loss is now measured as taken-minus-sent from the outbox, which works for all three versions.

**`06-minimal-example.cs` reported `LOST: -8`** because `Enqueued++` was called from concurrent request handlers. Both counters are `Interlocked` now. A negative loss count is a useful thing to have seen: it is what a lost-update race looks like when the two counters race differently.

**A middleware in `01` set a response header after `await next()`** to report the unwind order. It threw and truncated the body mid-stream — the exact failure the HTTP module warns about, reproduced by accident one module later. The unwind order is recorded in a static instead, with a comment explaining why.

`02-services-and-scopes.cs` carries `#pragma warning disable ASP0000`. Building several `ServiceProvider`s side by side is precisely what the file needs and precisely what that warning exists to discourage.

The lifetime material in `02` is deliberately shallow — `t3-11-di-lifetimes` owns that subject, and the module cross-links to it rather than duplicating it. What `t3-02` claims is only the host's part: it creates the scope, and it owns the two validation switches.

### `t3-03-kestrel/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | A 100-byte body limit taking effect: a 50-byte body reaches the handler, a 500-byte body is **413** and never does. | **Release** |
| `01-socket-to-request.cs` | Connection middleware (once per socket) against request middleware (once per request). 6 requests over **1** connection with keep-alive, **6** with `Connection: close`. All **20** `HttpContext.Features` listed. | **Release** |
| `02-connection-limits.cs` | `MaxConcurrentConnections = 2` with 5 clients: **2 succeed at 446 ms, 3 fail at 96 ms**. Connection middleware sees only 2 sockets - the limit is applied before it. | **Release** |
| `03-request-limits.cs` | All six limits read from the running server. Crossing each: **413 / 431 / 431 / 414**. A per-endpoint override via `IRequestSizeLimitMetadata` and via the feature. | **Release** |
| `04-timeouts.cs` | `RequestHeadersTimeout` swept at 200/1000/2000/4000 ms - all return **408** at **timeout + ~1 s**. Keep-alive closes with no 408. A dribbled body aborted after **131 bytes**. | **Release** |
| `05-tls.cs` | A self-signed certificate generated in-process. **TLS 1.3 / TLS_AES_256_GCM_SHA384**. ALPN choosing HTTP/1.1 or HTTP/2. An untrusted certificate rejected by the *client*. | **Release** |
| `06-reverse-proxy.cs` | Four trusted-set configurations. **Clearing `KnownProxies` and `KnownIPNetworks` makes the middleware trust EVERYONE.** A forged 3-entry chain with no `ForwardLimit` letting a client pick its own address. | **Release** |
| `07-production.cs` | The ingress incident: **1 distinct client / 2 wrongly throttled** broken, **6 / 0 but admin spoofable** with the sloppy fix, **6 / 0 / not spoofable** correct. | **Release** |
| `08-exercises.cs` | Every answer claimed, including the 2-succeed/3-refused connection limit and the 408 at 2,015 ms against a 1 s setting. | **Release** |
| `09-minimal-example.cs` | One Kestrel configured for life behind an ingress, with a forged `X-Forwarded-For` ignored and a per-endpoint body limit honoured. | **Release** |

**An empty trusted set means trust everyone, not nobody.** This is the sharpest finding in the folder and the module leads on it. `options.KnownProxies.Clear(); options.KnownIPNetworks.Clear();` reads as restrictive and is the opposite - the middleware only checks the sender when the sets are non-empty. Verified against four configurations: defaults APPLIED, both-cleared APPLIED, a foreign proxy IGNORED, loopback-trusted APPLIED.

**`MaxConcurrentConnections` refuses rather than queues**, and the first draft of `02` predicted queueing. Excess connections are accepted and closed before a byte is read, at 96 ms against the 446 ms the successful requests took. They never reach user connection middleware, never increment a request counter and never appear in an access log.

**Every Kestrel timeout fires on a ~1-second heartbeat.** Swept across four values, the overshoot was 1,809 / 1,015 / 1,036 / 1,053 ms - a constant, not a proportion. So the practical floor is about two seconds whatever you configure. The same granularity is a validation rule: `MinDataRate` throws `ArgumentOutOfRangeException` for a grace period of one second or less.

**Kestrel sends 408 for a headers timeout** rather than silently dropping the connection, which is what most write-ups imply. `04` also shows there is *no* 408 for a keep-alive timeout - there is no pending request to answer.

`05-tls.cs` needs no network, no certificate store and no openssl: it builds a certificate with `CertificateRequest`, and the SAN plus server-auth EKU are both required or a TLS client rejects it. The in-memory key from `CreateSelfSigned` cannot be used by `SslStream` on Windows, so it round-trips through PKCS#12 via `X509CertificateLoader.LoadPkcs12`. `ITlsHandshakeFeature.CipherAlgorithm` is obsolete (SYSLIB0058) - `NegotiatedCipherSuite` replaces it. `ForwardedHeadersOptions.KnownNetworks` is likewise deprecated (ASPDEPR005) in favour of `KnownIPNetworks`.

### `t3-04-middleware-pipeline/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | The nesting, in five log lines: `A in, B in, endpoint, B out, A out`. | **Release** |
| `01-order-and-shortcircuit.cs` | A middleware after `Run` never runs. Short-circuiting by not calling `next`, with the outer middleware still seeing the 401. The same handler before and after a thrower: **500 with a body, 500 empty**. | **Release** |
| `02-writing-middleware.cs` | All three forms side by side. **1 construction against 5 requests** for the convention form, **5** for `IMiddleware`. A scoped service in the constructor **fails at STARTUP**. | **Release** |
| `03-branching.cs` | `Map` and `MapWhen` terminal, `UseWhen` rejoining - measured as `before -> branch` against `before -> branch -> after`. `Map` moving `/admin` into `PathBase`. | **Release** |
| `04-response-lifecycle.cs` | A header after `next()` throwing `Headers are read-only`. `OnStarting` seeing the final **404** and still adding headers. A mid-stream throw delivering **4,096 bytes with status 200**. | **Release** |
| `05-production.cs` | The cache leak. Four arrangements of identical caching code: leak / leak / correct / **leak to an anonymous caller**. Endpoint ran 1, 1, 2 times. | **Release** |
| `06-exercises.cs` | Every answer claimed, including the dead middleware after `Run` and the startup failure for a constructor-injected scoped service. | **Release** |
| `07-minimal-example.cs` | One correctly ordered pipeline: 200 / 401 / MISS / HIT / MISS / 500-with-a-body, and the full ordering printed. | **Release** |

**A short-circuit above authentication removes authentication from the request.** `05` proves it with an anonymous caller receiving a real merchant's statement - the cache answered first and the authentication middleware never ran. That is a different and worse claim than "the cache returns stale data", and it is the reason the module leads on position rather than on cache keys.

**Position and key are two separate defects.** Row 2 fixes the ordering and still leaks, because the key is the path and the path is identical for every merchant. Fixing either alone leaves a leak.

**`Map` does not insert anything into the pipeline where you call it.** The first draft of `01` tried to demonstrate the ordering rule with an *endpoint* that throws, moving the handler above and below the `MapGet`. Both arrangements caught it, which looked like the rule failing. It is not: the endpoint-execution middleware is appended automatically at the very end, so a `Use` registered after every `Map` still runs before the endpoint. The demonstration was rebuilt around a middleware that throws, and the finding became a note in the module.

**A buffering middleware must restore `Response.Body` in a `finally`.** Found in `07`: the cache restored it after `next()` returned, so when `/boom` threw the restore was skipped, the exception handler wrote its 500 into the discarded buffer, and the client got **status 500 with an empty body**. Fixed in `05`, `07` and the module, and it is now the module's closing warning about replacing anything on the context.

### `t3-05-routing/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | A constraint producing **404, not 400** - the module in one line. | **Release** |
| `01-templates-and-precedence.cs` | Eight template shapes. Precedence: literal, constrained, plain, catch-all - **identical whichever order they are registered in**. An ambiguous pair starting cleanly and 500-ing at request time. | **Release** |
| `02-constraints.cs` | Twelve constraint checks. Constrained **404/404** against validated **400/422 with a body**. Two regex-separated routes coexisting. A custom `IRouteConstraint` with its check count. | **Release** |
| `03-groups-and-metadata.cs` | A group applying a prefix, tags and a filter: **401 without a key, 200 with**, and `/health` untouched. Nine metadata types on one endpoint. Filters running **inside** the endpoint, after all middleware. Nested groups accumulating both. | **Release** |
| `04-link-generation.cs` | Generation with query values and absolute URIs. `{*path}` producing `%2F` where `{**path}` round-trips. **A hand-built URL missing `/ledger`**. Four distinct failures all returning **null**. | **Release** |
| `05-production.cs` | The incident, over seven real identifiers: **7/0/0 → 0/0/7 → 4/3/0 → 7/0/0**. Startup SUCCEEDED and both health probes 200 while every lookup returned 500. | **Release** |
| `06-exercises.cs` | Every answer claimed, including the full versioned-API design returning 200/401/404/400/422/201 as designed. | **Release** |
| `07-minimal-example.cs` | One routing setup applying every decision, with a `Location` header carrying the `PathBase`. | **Release** |

**`{*path}` and `{**path}` are identical for matching.** The prose in `01` originally claimed the single-star form URL-decodes and the double-star round-trips. Measured across five inputs - `a/b/c.txt`, `a%2Fb`, `a%20b`, `a+b`, `%25` - both captured exactly the same value every time. **The difference is entirely in link generation**, where `{*path}` percent-encodes the slashes (`/single/a%2Fb%2Fc.txt`) and `{**path}` does not (`/double/a/b/c.txt`). Both files were rewritten around the measurement.

**Routing conflicts are caught at build time by a warning, not at startup, and fail at request time.** `05` shows an application that starts, reports healthy on both probes, and 500s every payment lookup. The `ASP0022` analyzer *does* warn and name both routes - and it is a warning, so it ships. The module's single strongest recommendation is `<WarningsAsErrors>ASP0022</WarningsAsErrors>`.

**The analyzer over-warns.** Compiling `01` produces `ASP0022` for the four precedence routes as well, and those resolve correctly at runtime. It flags routes that *could* match the same request without modelling the precedence that separates them, so both `01` and `06` carry `#pragma warning disable ASP0022` with a comment saying the conflicts are deliberate. The module states the trade honestly rather than recommending the analyzer unconditionally.

**The fix caused a hundred times more damage than the incident.** Constraining the ambiguous route to `:int` stopped the 500s and 404-ed every `PAY-nnnn` id - 4 of 7 in the test, the majority in production. The module's general point is that **a 404 is invisible to alerting and a 500 is not**, so the 500s were caught in 18 minutes and the 404s ran for two days.

**`MapFallback` plus `UsePathBase` with no explicit `UseRouting` makes the fallback swallow every request.** Found while writing `07`, and isolated to a 2×2: it needs both ingredients, and it returns **200 carrying the fallback body**, so it does not register as an error anywhere. It survives local testing because there is usually no `PathBase` on a developer machine. The fix is an explicit `app.UseRouting()` after `app.UsePathBase(...)`. The mechanism is not named - only the reproduction and the fix.

### `t3-06-minimal-vs-controllers/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | The same endpoint written both ways, returning byte-identical responses. | **Release** |
| `01-conventions.cs` | The five behaviours `[ApiController]` turns on, each measured with the attribute present and absent. | **Release** |
| `02-filters-and-testability.cs` | `IEndpointFilter` against `IAsyncActionFilter`: where each runs, what each can see, and what a handler test needs in both models. | **Release** |
| `03-production.cs` | One API written both ways with the same guard, the same error contract and the same output. | **Release** |
| `04-exercises.cs` | Every answer claimed, including `TypedResults` and `Results<Ok<T>, NotFound>`. | **Release** |
| `05-minimal-example.cs` | The recommendation applied: minimal APIs with a group filter and `TypedResults` throughout. | **Release** |

**`AddProblemDetails()` alone leaves 404 bodies empty.** Section 2 originally claimed the registration was enough. Measured, it is half: `AddProblemDetails` registers the writer and `UseStatusCodePages` is what invokes it for a response that has a status and no body. Both lines are needed, and the finding became the opening of `t3-09`.

**The first draft's comparison was unreal.** Section 2's minimal endpoint had no authorisation guard where the controller had one, so it compared a guarded thing to an unguarded thing. Rewritten with a matching group filter before any conclusion was drawn from it.

### `t3-07-model-binding/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | Four parameters bound from four different sources with no attributes on any of them. | **Release** |
| `01-silent-failures.cs` | What binding does with absent, empty and unparseable values - across nullable, defaulted and required parameters. | **Release** |
| `02-sources-and-custom.cs` | `TryParse` against `BindAsync`, `[AsParameters]`, `[FromHeader]` and `[FromForm]`, and `UnmappedMemberHandling`. | **Release** |
| `03-production.cs` | A request type that grew a field, and the four layers that did or did not notice. | **Release** |
| `04-exercises.cs` | Every answer claimed, measured against the running server. | **Release** |
| `05-minimal-example.cs` | One endpoint binding from every source, with each choice stated. | **Release** |

**Binding distinguishes absent from unparseable, and the draft had it wrong.** The prose claimed that nullable and defaulted parameters swallow malformed input silently. Measured: all three shapes - nullable, defaulted and required - return **400 for an unparseable value**. What a nullable or defaulted parameter tolerates is the value being **absent**, which is a different question. Section 1 and the loud/silent table were rewritten around the measurement.

**`UnmappedMemberHandling.Disallow` returns a bare 400 with an empty body.** The draft said it names the offending field. It does not name anything: the response has no body at all, which makes it a blunt instrument rather than a diagnostic one.

**Binding is case-insensitive and not separator-insensitive.** `amountminor` binds to `AmountMinor`; `amount_minor` and `amount-minor` do not.

### `t3-08-validation/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | `AddValidation()` in one line: the same request returning 200 without it and 400 with it. | **Release** |
| `01-nesting.cs` | `Validator.TryValidateObject` **not recursing**, against the source-generated validator that does. | **Release** |
| `02-beyond-attributes.cs` | `IValidatableObject` for a cross-field rule, and a custom `ValidationAttribute`. | **Release** |
| `03-production.cs` | The incident: **v1 4/1/0, v2 4/1/3, v3 1/4/0** - accepted and rejected identical before and after. | **Release** |
| `04-exercises.cs` | Every answer claimed, all through one `BuildAsync` helper. | **Release** |
| `05-minimal-example.cs` | Seven requests, each stopped by exactly one of the four layers. | **Release** |

**`Validator.TryValidateObject` does not walk nested objects or collections.** The filter that appears in blog posts and framework samples validates only the top-level type's own properties. Attributes on a nested address or on the elements of a `List<InvoiceLine>` are skipped in silence, so accepted and rejected counts do not move when line items are added - only the count of bad rows that got through.

**The .NET 10 validation source generator works from exactly one `AddValidation()` call site.** Measured while writing `04`: a program with four call sites ran no validation at all, with no warning. Refactored so every application in the file is built through a single conditional call site, which behaves correctly.

### `t3-09-problem-details/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | Two lines turning three failure paths and an unmatched route into `application/problem+json` with a `traceId`. | **Release** |
| `01-what-leaks.cs` | The developer exception page against a bare Production 500 against a handled one, with a table of what each body contained. `Accept` negotiation. `WriteAsJsonAsync` against `IProblemDetailsService`. Typed handlers mapping domain exceptions to 404/409/500. | **Release** |
| `02-when-it-does-not-run.cs` | Four ways a correct handler produces nothing: registered too late, response already started, wrong middleware for the failure, and the logging it suppresses. | **Release** |
| `03-production.cs` | Five endpoints producing three content types and four field sets, then the same five under one `CustomizeProblemDetails` policy. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the streaming endpoint that reports 200 while failing. | **Release** |
| `05-minimal-example.cs` | Eight requests, six failures, one shape - and one line in the error log. | **Release** |

**An `IExceptionHandler` that returns `true` removes the exception from the logs entirely.** The prediction was that the framework logs every unhandled exception at Error regardless, so returning a bare `traceId` costs nothing diagnostically. Measured: with no handler, Kestrel writes an Error entry with the message and stack; with a handler that returns `true` and does not log, **nothing above Information is written at all**. Adding an exception handler to stop leaking stack traces silently stops recording why anything failed. This became the module's central warning.

**The developer exception page content-negotiates, and returns the stack as JSON.** The prediction was that it produces an HTML page, so a client sending `Accept: application/json` would receive something harmless. Measured across three `Accept` values, the secret was present in all three: `application/json` and `*/*` both returned **`application/problem+json` carrying the exception message, type name and stack**; only `text/html` returned the HTML page. "We only serve JSON from this service" is not a mitigation.

**Hand-rolled problem JSON has the right shape and the wrong content type.** `WriteAsJsonAsync` with an anonymous object and `IProblemDetailsService` produced **byte-identical JSON** apart from the trace id, and `application/json` against `application/problem+json`. Nothing fails until a consumer that trusts the content type arrives.

**The `traceId` field is `Activity.Current?.Id`, falling back to `HttpContext.TraceIdentifier`.** Which one appears depends on whether anything is listening - attaching any logging provider is enough to create an activity. Measured side by side: `00-c642...-72cc...-00` against `0HNO9U0G9UJBK:00000001`. A handler that logs `TraceIdentifier` while the document carries the activity id hands the customer a string that matches nothing.

**The handler runs even when the response has started; it simply cannot write.** `04`'s streaming exercise measured status 200, 45 bytes received, the client's read throwing `HttpIOException`, **and the exception logged**. The log and the status code are both correct and they disagree, which is why a metric built on status codes cannot see any failure occurring after the status is chosen. An earlier draft claimed the handler "could not run"; both `02` and `04` were corrected.

**`UseExceptionHandler` and `UseStatusCodePages` are not substitutes.** Measured across four configurations: the handler alone still returns empty 404s and 403s, the pages alone still return empty 500s. Neither is a superset of the other.

### `t3-10-dependency-injection/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | One class written hardwired and injected, then wired by the container - the same class in all three. | **Release** |
| `01-what-the-container-does.cs` | Constructor selection, duplicate registrations, `IEnumerable<T>`, open generics, keyed services, and the three ways resolution fails. | **Release** |
| `02-composition-root.cs` | Hand-wiring against container wiring, constructor injection against service location, and a test with no container in it. | **Release** |
| `03-production.cs` | Grouped registrations, `IOptions<T>` instead of registered values, a decorator via factory registration, and `ValidateOnBuild`. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the two-constructor bug and three ways to have two implementations of one interface. | **Release** |
| `05-minimal-example.cs` | A composition root worth copying, and the same classes tested with three arguments and one `new`. | **Release** |

**The container picks the greediest constructor it can satisfy, and switching is silent.** Measured on one class with three constructors: registering one additional unrelated service changes which constructor runs, with no change to the class and nothing in the output. `04` turns this into the failure it causes in practice - deleting an `IAuditLog` registration does not throw, it selects the constructor that does not audit, and no test fails because tests construct the class directly.

**`ValidateOnBuild` is on in Development and off in Production.** Measured with the same missing registration in both: Development threw `AggregateException` from `Build()`, Production **built without complaint** and threw `InvalidOperationException` on first resolve. The check that turns a missing registration into a failed deployment is absent from the environment where that matters, unless `UseDefaultServiceProvider` asks for it.

**Validation reads constructors, not code.** The same missing registration moved inside a factory lambda: **built without complaint** with `ValidateOnBuild = true`, then failed at resolve. A factory registration is the right escape hatch and it is also a hole in the startup check.

**Service location moves the failure, and that is the whole argument.** With one service deliberately unregistered and both versions of a class needing it: constructor injection threw while building the object; the service-locating version **built successfully** and threw later on the code path that used it.

**Keyed registrations do not answer unkeyed requests.** `GetService<IPaymentGateway>()` returned null with two keyed registrations present. Adding a key to an existing registration breaks every consumer that was not updated, at resolve time.

**`ASP0000` fires across three files here.** `01`, `02` and `04` build service providers directly because comparing containers is their subject. Each carries `#pragma warning disable ASP0000` with a comment, and `03` shows the shape the analyzer is actually warning about as a `data-bad` block rather than suppressing the point.

### `t3-11-di-lifetimes/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | Two requests, two resolves of each lifetime: **1 singleton, 2 scoped, 4 transient instances, 7 in total**. | **Release** |
| `01-captive-dependencies.cs` | A singleton holding a scoped service, with instance numbers showing the cache holds a **separate object** neither request used. The exact `ValidateScopes` message. Transient-in-singleton against transient-in-scoped, producing different behaviour from an identical registration. | **Release** |
| `02-scopes-and-workers.cs` | The root provider refusing a scoped service. A hosted service refused at startup for taking one. Scope-per-run against scope-per-item. **10,000 transient disposables held by the root provider against 0 held by a disposed scope.** | **Release** |
| `03-production.cs` | The incident across five concurrency levels: **zero failures at concurrency 1, 194–198 of 200 above it**, with one context serving 200 requests. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the three catalogue designs and the disposable-leak comparison. | **Release** |
| `05-minimal-example.cs` | 200 concurrent requests, 0 failures, 102 contexts created and **102 disposed**. | **Release** |

**A captive scoped service is not the request's instance.** The prose originally said the singleton "holds the instance from the first request". Measured with instance ids, request 1 used instance 1 and the cache holds instance 2 — a separate object resolved from the **root** provider, which read the ambient `HttpContext` only because it happened to be constructed during the first request. The value is not stale so much as accidental.

**`ValidateScopes` is on in Development and off in Production**, exactly like `ValidateOnBuild` in the previous module. The message it produces is worth memorising verbatim: `Cannot consume scoped service 'ITenantContext' from singleton 'TenantCache'.`

**Transient-in-singleton is unchecked and changes behaviour.** The same `AddTransient` registration produced one generator under a singleton consumer (references `REF-001, REF-002, REF-003`) and three under a scoped one (`REF-001, REF-001, REF-001`). Neither row is "the bug" — which is correct depends on what the service is for, and the container cannot tell.

**The root provider's disposable tracking is a real leak.** 10,000 transient `IDisposable` resolutions from the root: 10,000 created, **0 disposed, 10,000 still held**. From a scope that is disposed: 10,000 created, 10,000 disposed, 0 held. Every object is reachable, so no amount of collection helps.

**The incident does not exist at concurrency 1.** Zero failures in 200 requests with a single caller, and 194 of 200 at concurrency 2. A developer machine, an integration test and a single-user staging environment are all the first row.

### `t3-12-configuration/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | Four sources, one key each, and the last one that has a key winning. | **Release** |
| `01-providers-and-precedence.cs` | The twelve providers `CreateBuilder` registers, in order. Precedence across five combinations. Four environment-variable spellings. Case-insensitivity, and `GetValue<int>` returning 0 for a misspelt key. | **Release** |
| `02-binding.cs` | Five binding outcomes including a missing section. **The three binding APIs disagreeing about a missing section.** Array merging. `reloadOnChange` against a bound object. | **Release** |
| `03-production.cs` | The incident, and the startup log that would have ended it — including the provider that supplied each value. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the four-layer environment design that refuses to start. | **Release** |
| `05-minimal-example.cs` | Three environments and one missing required value: **REFUSED: Gateway:BaseUrl is required**. | **Release** |

**A single underscore is a key name, not a separator.** `Gateway_BaseUrl` defines a top-level key nothing reads, and the application keeps its committed default. A colon works on Windows and is not a legal environment variable name on Linux. Only `Gateway__BaseUrl` works everywhere.

**A later source overrides an array element by element and cannot shorten it.** Three origins in the base file and one in the environment file produced **one entry from the override and two from the base** — a list that was never written down anywhere. Setting the unwanted elements to null does not help either: measured, the list is still three long and now contains nulls.

**`Get<T>()`, `Bind(instance)` and `Configure<T>` disagree about a missing section.** `Get` returns **null**; `Bind` leaves the instance untouched, so caller-supplied defaults survive; `Configure` plus `IOptions` yields a fresh object of type defaults. The prose originally claimed all three produce defaults.

**Dumping all of configuration dumps the machine's environment.** The first run of `03-production.cs` printed several hundred lines of the host's environment variables, because the environment variables provider contributes every one of them. The file now filters to the section the application owns, and the module says why.

### `t3-13-options-pattern/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | One section bound once, a service that never sees `IConfiguration`, and the same class constructed with `Options.Create`. | **Release** |
| `01-the-three-interfaces.cs` | The three interfaces across a file change: **5/5/5 then 5/30/30**. `IOptionsSnapshot` refused in a singleton. Named options, including a name nobody registered. 1,000 `OnChange` subscriptions, and 0 after disposal. | **Release** |
| `02-validation.cs` | Four levels of care on the same broken configuration. Every data-annotation message. A cross-field rule. | **Release** |
| `03-production.cs` | The incident: three ways of holding the value, and the one that never sees a change. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the `IValidateOptions` that reports two failures at once. | **Release** |
| `05-minimal-example.cs` | A flag that moves without a restart and a timeout that does not, both deliberately. | **Release** |

**`ValidateDataAnnotations` without `ValidateOnStart` is a check that runs on a customer's request.** Measured: the application starts, `/health` returns 200 throughout, and the failure lands on the first request to the endpoint that reads the options. Options validation is lazy by default.

**Assigning `CurrentValue` to a field makes `IOptionsMonitor` equivalent to `IOptions`.** The kill switch could not be switched: flag true → `new`, flag false → still `new`, and **0 change callbacks fired**. The class takes the right interface for the right reason and uses it in a way that reads, at every glance, as though it does not.

**`IOptionsSnapshot` is scoped**, so a singleton holding one is refused by `ValidateScopes` — and where that check is off, the singleton freezes whichever request's snapshot built it.

**A name nobody registered returns class defaults.** `Get("cards")` for a typo produced `(unset) @ 30s` rather than an error, and `ValidateOnStart` cannot help because it validates only the names that were registered.

### `t3-14-secrets/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | One key name, three sources, three environments — and a refusal to start with none of them. | **Release** |
| `01-how-they-escape.cs` | `GetDebugView` redaction on `Key` against `Path`. **Eight parsers, two of which quote their input.** The developer exception page. Three ways of logging the same call. | **Release** |
| `02-sources.cs` | Where the user-secrets file lives. A vault as a configuration provider, fetching **twice and never again**. `optional: true` starting with no secrets at all. | **Release** |
| `03-production.cs` | The rotation incident: **10/10 accepted before, 0/10 after**, and three ways the application could have read the credential. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the four-step rotation with an overlap. | **Release** |
| `05-minimal-example.cs` | A fingerprint that changes across a rotation while the value is never shown. | **Release** |

**A redaction predicate on `context.Key` misses every connection string.** `context.Key` is the **leaf**, not the path, so for `ConnectionStrings:Ledger` it is `Ledger` — which matches no sensitive word. Measured: the API key was masked and the database password printed in full, by a redaction that reads correctly. `context.Path` fixes it.

**Only two of eight common parsers put the value they were given into the exception message.** `int.Parse` and `DateTime.Parse` do; `new Uri`, `Guid.Parse`, `Convert.FromBase64String`, `JsonDocument.Parse`, `XElement.Parse` and `DbConnectionStringBuilder` do not. Three of those rows throw `FormatException` and only two of the three include the value, so the exception type predicts nothing.

**`IOptionsMonitor` does not pick up a rotated secret.** Measured identically to `IOptions`: 0 of 10 accepted after the rotation, one vault read. The monitor re-reads *configuration*, and configuration did not change because the provider never fetched again. Only the reloading provider row recovers, with two vault reads.

**An overlapping validity window removes the race entirely** — 10/10 during and after — and it is a property of the runbook rather than of the application, so it protects fleets whose code you have not read.

### `t3-15-api-versioning/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | Two versions of one endpoint, and a 404 for an unversioned path. | **Release** |
| `01-three-schemes.cs` | URL, query, header and media type all reaching one handler. Three policies for a missing version. The `Vary` header a header scheme needs. | **Release** |
| `02-what-breaks.cs` | **Nine response changes against a client compiled before them: six break.** Four request changes. A strict client broken by an additive change. | **Release** |
| `03-production.cs` | The retirement incident, the eight lines of telemetry that would have prevented it, and `Sunset`/`Deprecation`/`Link`. | **Release** |
| `04-exercises.cs` | Every answer claimed, including the brown-out sharing a code path with the retirement. | **Release** |
| `05-minimal-example.cs` | Two versions, an additive change into the current one, per-caller usage, and a rehearsable retirement. | **Release** |

**Removing a field is silent; changing its type is loud.** A removed field leaves the client's property at its default — an empty currency, with no error anywhere — while a type change throws. The silent one is the dangerous one, and it is the one a schema diff describes as a single-line change.

**Adding to a response is safe and adding a required request field is not.** The direction is what makes the rule memorable: you may always give more, and never demand more. Measured: a new response field is ignored; a new `required` request member rejects every existing caller.

**A client can opt out of forward compatibility.** With `UnmappedMemberHandling.Disallow`, an additive change — the safest change there is — rejected the response. Nothing about the server was wrong.

**40% of the traffic still on v1 came from callers nobody could email.** 10,000 requests a day, 20% of everything, from a retirement with six months of notice and three rounds of emails. Announcements reach people; requests come from processes.

**Deserialising successfully proves nothing.** The removed-field case parsed cleanly and produced an empty currency, which is why the compatibility test in the module asserts on the values rather than on the parse.

### `t3-16-pagination/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | Offset paging against a moving table, and the duplicate it produces. | **Release** |
| `01-offset-vs-keyset.cs` | Both schemes walked under inserts and deletions, with duplicates and misses counted separately. The cost curve at depth, once LINQ is stopped from indexing straight to the offset. | **Release** |
| `02-stable-ordering.cs` | An `ORDER BY` that is not a total order, and the tiebreaker that fixes it. | **Release** |
| `03-production.cs` | The nightly reconciliation, four query shapes, and the only one that missed nothing. | **Release** |
| `04-exercises.cs` | Every answer measured, including the page size nobody bounded. | **Release** |
| `05-minimal-example.cs` | One list endpoint: opaque validated cursor, total order, bounded page, allow-listed sort and filter. | **Release** |

**Keyset paging removes duplicates and does not make a walk complete.** The headline correction of the module. Keyset still missed 13 rows, because rows arriving late land behind a cursor that has already passed. Only a closed window - a range whose end is already in the past - reached zero missed. The cursor is the performance fix; the window is the correctness one.

**`Skip` on an array is free and tells you nothing.** The first run timed every offset at 0.000 ms, because LINQ indexes straight to the offset on an indexable source. Adding `.Where(_ => true)` removes that ability and produces the situation a database is always in - which turned a broken measurement into the clearest table in the module.

**A skipped row is worse than a duplicated one.** A duplicate is visible and somebody complains. Nothing records that a row existed and was not returned, so a job reports success having never seen it.

### `t3-17-file-upload/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | The four-line endpoint, and the four decisions it has already made: the client's filename in a path, the client's content type believed, a 30 MB limit nobody set, and the whole file read before the handler ran. | **Release** |
| `01-buffered-vs-streamed.cs` | When each handler gets control, measured to the millisecond on a deliberately slow upload. The two limits and their different errors. Streaming 64 MB with no framework temp files. | **Release** |
| `02-what-the-bytes-say.cs` | Filename, content type and signature disagreeing eight ways. What `Path.GetFileName` returns for twelve hostile inputs. Signature and size checks refusing mid-stream. | **Release** |
| `03-production.cs` | The disk that filled while every dashboard stayed flat: why the client retried, which uploads leaked, three ways to deliver a 413, and the handler that was deployed. | **Release** |
| `04-exercises.cs` | Every answer measured, including the export that buffers on the way out. | **Release** |
| `05-minimal-example.cs` | One endpoint with seven decisions made explicitly, exercised against six uploads including a hostile filename. | **Release** |

**The buffered handler got control 589 ms in; the streamed one got it after 3 ms.** Same 16 MB upload, sent in 32 chunks with pauses. That gap is the module: everything you might want to do cheaply - refuse a type, stop at a size, avoid the disk - requires being in the loop while the bytes arrive.

**`Path.GetFileName("..")` returns `".."`, and combining it with the root lands in the parent directory.** The advice that `GetFileName` prevents traversal has a two-character counterexample. The empty string is the second: `Path.Combine(root, "")` is the root itself.

**Returning 413 without reading the body reaches the client as `HttpRequestException`.** Three server behaviours measured: refuse immediately (client sees a transport error and retries), drain the body then refuse (413 delivered, at the cost of the whole transfer), or have the client send `Expect: 100-continue` (413 delivered, body never sent).

**The body-size limit cannot be raised after reading has started.** `InvalidOperationException` says so in as many words, which means the decision about how to refuse an oversized upload must be made before the first read - not in the `catch`.

**Only chunked uploads leaked partial files.** With a `Content-Length`, Kestrel refuses before the first read and the handler never reaches `File.Create`. Chunked, the limit trips by counting, halfway through, with a file already open: 7.7 MB left per attempt. One app release changing how it read the photo started a six-week leak with no server change at all.

**`CON` wrote a real file and listed under that name.** The reserved-device-name folklore did not reproduce on .NET 10 on this machine. `report.txt.` did lose its trailing dot, which is the quieter bug - a database row keyed on the name the client sent will never find the file again.

**A middleware that records after `await next(context)` recorded nothing for the failed uploads.** The handler ran; the exception threw past the recording line. A metric that goes quiet exactly when things go wrong looks identical to one saying all is well.

### `t3-18-openapi/`

Every file in this folder takes two package references — `Microsoft.AspNetCore.OpenApi@10.0.10` and `Microsoft.OpenApi@2.11.0`. The second is pinned explicitly: without it the transitive 2.0.0 is restored and the build emits NU1903, a known high-severity advisory.

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | Two lines generate a document, and it is wrong about both endpoints. **The response type is absent from the document entirely.** The required/nullable distinction on a C# record. | **Release** |
| `01-what-it-can-know.cs` | Five ways of writing one return type and what each documents. Parameter locations. Eighteen C# types mapped to JSON Schema. Eight validation attributes, and which arrive. | **Release** |
| `02-shaping-the-document.cs` | The signature fix, the metadata fix, and all three transformer kinds measured against the document they produce. | **Release** |
| `03-production.cs` | The partner whose generated client failed on one call in nine, the test that passed anyway, and a thirty-line conformance check run against both versions. | **Release** |
| `04-exercises.cs` | Every answer read out of a generated document, including the schema transformer that was right for two types and wrong for the third. | **Release** |
| `05-minimal-example.cs` | One API with each fact placed as high up the enforcement ranking as it goes, plus the conformance check passing. | **Release** |

**A handler returning `IResult` puts nothing in the document — including the response type itself.** `components/schemas` contained only `CreatePayment`, because it is a parameter and parameters are in the signature. The `Payment` type both endpoints return is absent, not merely undescribed.

**`failureReason` is documented as both nullable and required, and that is not a contradiction.** `required` is about the key's presence; nullability is about its value. A C# record produces exactly that pair by default, so the document demands `{"failureReason": null}` and refuses an object omitting the key. This is the most common real disagreement between a generated document and the API a team believes it has.

**Every numeric type documents as "number or string", not only int64.** System.Text.Json reads numbers from quoted strings, so `int`, `long`, `decimal` and `double` all publish a union. A generated TypeScript client types every numeric property as `number | string`.

**A plain `enum` publishes `"integer"` with no list of legal values at all.** Not the names, not the numbers, not even which integers are allowed. The one carrying `JsonStringEnumConverter` publishes its names as a complete enum list. The document is describing the wire honestly in both cases.

**`decimal` publishes as `format: double`.** JSON Schema has no decimal, so the precision the type was chosen for does not survive the document. The wire format is exact text; the loss happens in the client, in a type the document told it to use.

**`[Url]` reached the schema and `[EmailAddress]` did not.** Same kind of attribute, same kind of job, and only one translated. Which attributes survive is a property of the version you are on — the lesson is to fetch your own document and check, not to memorise a list.

**The test that should have caught the incident passed.** A `FailedPayment` response deserialised cleanly into `Payment`: System.Text.Json ignored the unrecognised `failureCode` and left the missing `failureReason` null. The exact mismatch that throws in a strict generated client is absorbed silently by a test that uses the server's own types.

### `t3-19-health-checks/`

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | `AddHealthChecks()` reporting Healthy while every request 500s, and what one registered check changes. | **Release** |
| `01-three-questions.cs` | Liveness, readiness and startup as three endpoints over one set of registrations. What each returns when a dependency dies. Degraded's default status code. A startup probe passing after the warm-up. | **Release** |
| `02-what-it-costs.cs` | Probe arithmetic at four fleet sizes. **Four ways of writing a timeout, two of which do nothing.** Thirty probes costing one round trip. What a detailed response publishes. | **Release** |
| `03-production.cs` | Six real ASP.NET Core instances, a real prober loop with a kill threshold, and a database that fails over — run twice, changing only which URL the liveness probe reads. | **Release** |
| `04-exercises.cs` | Every answer measured, including the shutdown ordering that decides whether a deploy drops requests. | **Release** |
| `05-minimal-example.cs` | One service, three probes, six states — including a slow dependency and SIGTERM. | **Release** |

**The same code, run twice: 36 restarts and nothing serving, against 0 restarts and full recovery.** The only difference between the two runs is which endpoint the liveness probe reads. The C# is identical, which is the point — this defect lives in a deployment manifest, and no code review looks at both files.

**The fleet did not recover when the database came back, for a second reason.** A replacement takes three rounds to warm up and the kill threshold is two, so every fresh instance is killed before it can ever pass. That loop no longer needs the database to be down — it only needed the database to be down once, to knock the warm instances over. It is exactly what a startup probe prevents.

**A configured `timeout:` did nothing.** The check ran for 2022 ms under a 250 ms timeout, because the framework's timeout is cooperative: it cancels a token and hands it to your check, and work that never observes the token runs to completion. Passing the token through, or using your own `CancellationTokenSource`, returned in ~260 ms. A configured-but-ineffective timeout is worse than none, because somebody read the line in review and concluded the check was bounded.

**`Degraded` returns 200 by default**, so a load balancer keeps sending traffic — which is usually right. Changing it takes a per-endpoint `ResultStatusCodes`, and per-endpoint is correct: "degraded" may mean "keep serving" to a load balancer and "do not promote" to a release pipeline.

**`AddHealthChecks()` with no registrations reports Healthy forever**, because it aggregates an empty set. It is a valid liveness check — it proves a request was routed and answered — pointed at a load balancer.

**Thirty probes cost one database round trip once the result is cached.** The bigger benefit is not the saving: the cache bounds concurrency, so a check that becomes slow does not accumulate one in-flight execution per arriving probe against a dependency that is already struggling.

**The detailed response published the internal hostname, port, SQL username and the payment gateway's internal URL** — from exception messages, on an endpoint that is unauthenticated because probers cannot authenticate.

### `t3-20-feature-flags/`

`01-when-it-is-read.cs` takes one package reference, `Microsoft.FeatureManagement.AspNetCore@4.3.0`, for its final section. The other five files use no packages.

| File | What it proves | Run in |
| --- | --- | --- |
| `00-smallest.cs` | The `if` everybody writes, and the four things it decided: a missing key is false, a typo is false, the read count, and who it applies to. | **Release** |
| `01-when-it-is-read.cs` | Twenty requests taking both code paths at once. Per-call against per-request against per-process. What a flag read costs three ways. The four kinds of flag. What `Microsoft.FeatureManagement` does and does not give you. | **Release** |
| `02-targeting.cs` | A coin-toss rollout against a hash rollout. Bucket distribution at eight percentages. **Two "independent" 50% experiments that select the same 4,986 users.** Evaluation order with override lists. | **Release** |
| `03-production.cs` | The twenty-month-old fallback pricing everything at GBP 0.00, the twenty months of ordinary work that rotted it, and a registry audit. | **Release** |
| `04-exercises.cs` | Every answer measured, including a kill switch resolved at startup and a "100%" rollout that was never everyone. | **Release** |
| `05-minimal-example.cs` | A typed registry with owners and removal dates, the expiry test, ordered evaluation, a per-request snapshot, a live ops toggle, and an endpoint that explains every decision. | **Release** |

**989 of 1000 users saw both variants within one session.** Both strategies rolled out to about half the users — 493 against 530 — which is the number anybody checks and the reason a coin-toss rollout ships. The hash version had zero users seeing both. The experiment run this way measures nothing, because every user is in both arms.

**Two independent 50% rollouts selected exactly the same 4,986 users.** Without the flag name in the hash input, the same function partitions the same population the same way. Adding the flag name brought the overlap to 2,492, against 2,500 expected. This produces no error and no anomaly — two results that look valid and are confounded with each other.

**Twenty requests took both code paths at once.** A flag read at three points in one handler, flipped once while twenty requests were in flight: all twenty were internally inconsistent. The snapshot version had zero.

**A flag resolved in a DI factory cannot be flipped.** The registration reads well — one place, an interface downstream — and the container then holds the object that was chosen at startup. For a kill switch that is fatal, because an incident is exactly when you do not want to restart.

**The legacy pricing path returned GBP 0.00 for everything, silently.** It read the field it had always read; nothing had written to that field since prices moved to integer minor units fifteen months earlier. The code compiles, the types match, and the branch never changed — the world around it did.

**A single underscore in an environment variable is not a separator.** `Features__NewCheckout` binds; `Features_NewCheckout` does not, and the resulting silence is indistinguishable from "the flag is deliberately off". `1`, `yes` and `on` all throw `InvalidOperationException` at the read rather than at startup.

**Every signed-out visitor hashed to bucket 88.** Half the population shared one targeting key, so all 500 landed in the control group. Had that bucket been under 50 instead, every anonymous visitor would have received the variant, the overall split would still have looked like 50%, and the experiment would have produced a confident wrong answer rather than an obvious one.

**Deleting a flag at 100% changed behaviour for three tenants.** The percentage is the last rule and exclusions sit above it, so "100%" means "everyone the earlier rules did not already decide". Flag consoles report the configured percentage, which is an input, not the evaluated-true proportion, which is an output.

## Measured on

| | |
| --- | --- |
| SDK | .NET 10.0.400 |
| OS | Windows 11 Pro (x64) |
| Date | 2026-09-04 |

Timing numbers are machine-specific, and `t2-24` finally measured how much:
**identical, fully warmed-up work varied by 16% of its mean across twenty
samples, with a 1.63x spread between fastest and slowest.**

That number settles a convention this file previously stated too strongly. It
said the lessons quote ratios rather than absolute milliseconds; in practice the
modules quote plenty of absolutes, and the honest rule is narrower:

- **Counts and byte totals are exact.** Collection counts, contention counts,
  handle counts, bytes per operation, peak concurrency. These reproduce
  identically and are what every headline claim in Track 2 rests on.
- **Ratios against a stated baseline are quoted with their observed range**
  when that range matters, and several modules say explicitly that a ratio moved
  between runs.
- **Absolute milliseconds appear** where the shape of a table is the point, and
  are labelled as machine-specific rather than presented as results.

Every verification file carries an EXACT vs RATIO note in its header saying
which of its own columns are which. That is the convention, and it is now
consistent with what the modules actually do.

The same caution applies more strongly to `run-tiering-comparison.sh`. Process
startup on a desktop machine is noisy: the ReadyToRun result was 1.9x in one
session and 1.5x in another. The **direction** was identical every time, and
that is what the lesson claims. Run it yourself before quoting a figure.
