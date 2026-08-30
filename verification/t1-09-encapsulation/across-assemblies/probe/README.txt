Compile-error probe for exercise 1. This file is NOT expected to build; it
exists to record which error each line produces. Excluded from the build sweep.
To reproduce: copy Probe.cs.txt over consumer/Program.cs and build the consumer.

Verified 2026-08-30, .NET 10.0.400, clean builds (--no-incremental, obj/bin
deleted between runs). An earlier run of this probe reported CS0103 for line 20
WITH InternalsVisibleTo present; that was a stale Lib.dll left by an
incremental build. The results below are from clean trees.

WITH [assembly: InternalsVisibleTo("Consumer")]:
   9  w.Internal ................ compiles
  10  w.Protected ............... CS0122 (inaccessible due to protection level)
  11  w.ProtectedInternal ....... compiles
  20  PrivateProtected .......... compiles   <-- IVT widens this too

WITHOUT it:
   9  w.Internal ................ CS1061 (no definition for 'Internal')
  10  w.Protected ............... CS0122
  11  w.ProtectedInternal ....... CS0122
  20  PrivateProtected .......... CS0103 (name does not exist in this context)

Conclusion: InternalsVisibleTo grants the friend assembly "same assembly"
identity for accessibility, so it widens internal, protected internal AND
private protected.
