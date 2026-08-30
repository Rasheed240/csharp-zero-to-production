using System;

class Program
{
    static void Main()
    {
        string[] cells = { "id", "name", "amount" };

        Console.WriteLine($"Csv.Write : {Csv.Write(cells)}");
        Console.WriteLine($"Tsv.Write : {Tsv.Write(cells).Replace("\t", "<TAB>")}");

        // Neither Formatter is visible here. Uncomment to see CS0246:
        // Console.WriteLine(Formatter.Format(cells));

        var t = Type.GetType("Formatter");
        Console.WriteLine($"Type.GetType(\"Formatter\") from another file: {(t == null ? "null" : t.Name)}");

        Console.WriteLine();
        Console.WriteLine("What the two file-scoped types are actually called in metadata:");
        foreach (var type in typeof(Program).Assembly.GetTypes())
            if (type.Name.Contains("Formatter"))
                Console.WriteLine($"  {type.FullName}");
    }
}
