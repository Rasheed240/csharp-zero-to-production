// Compile-error probe. This file is EXPECTED NOT TO COMPILE.
// Its purpose is to produce the exact diagnostics quoted in the lesson.

int[] numbers = { 1, 2, 3 };

numbers.Length = 5;                  // the length is read-only
numbers[0] = "text";                 // wrong element type
int[,] rectangular = new int[2, 2];
int wrong = rectangular[0];          // a rectangular array needs both indices
int[][] jagged = new int[2][2];      // jagged arrays size one dimension at a time
int[] noSize = new int[];            // a size or an initialiser is required
