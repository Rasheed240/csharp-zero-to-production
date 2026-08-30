using System;

// The SAME type name, in the same namespace, in the same assembly.
// Legal, because each is scoped to its own file.
file class Formatter
{
    public static string Format(string[] cells) => string.Join("\t", cells);
}

public static class Tsv
{
    public static string Write(string[] cells) => Formatter.Format(cells);
}
