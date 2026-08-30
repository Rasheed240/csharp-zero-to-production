// Compile-error probe. This file is EXPECTED NOT TO COMPILE.
// Its purpose is to produce the exact diagnostics quoted in the lesson.

string reference = "INV-2026";

reference[0] = 'X';        // CS0200: a string is immutable, the indexer is read-only
reference.Length = 5;      // CS0200: Length is read-only
char letter = "A";         // CS0029: double quotes make a string, not a char
string fromChar = 'A';     // CS0029: single quotes make a char, not a string
