// Compile-error probe. This file is EXPECTED NOT TO COMPILE.
// Its purpose is to produce the exact diagnostics quoted in the lesson.

// (1) CS0165 — reading a local that was never assigned.
int neverSet;
Console.WriteLine(neverSet);

// (2) CS0266 — no implicit conversion from double to int; it would lose data.
int truncated = 3.7;

// (3) CS0266 — long does not fit in int without an explicit cast.
long big = 3_000_000_000L;
int tooSmall = big;

// (4) CS0131 — a const cannot be reassigned.
const int PenceInAPound = 100;
PenceInAPound = 200;

// (5) CS0818 — var needs something to infer from.
var undecided;

// (6) CS0128 — the same name declared twice in one scope.
int duplicate = 1;
int duplicate = 2;
