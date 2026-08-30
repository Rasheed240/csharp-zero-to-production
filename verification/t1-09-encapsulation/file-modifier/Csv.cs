using System;

// "file" means: visible only inside THIS source file. Not the namespace,
// not the assembly. The file.
file class Formatter
{
    public static string Format(string[] cells) => string.Join(",", cells);
}

public static class Csv
{
    public static string Write(string[] cells) => Formatter.Format(cells);
}
