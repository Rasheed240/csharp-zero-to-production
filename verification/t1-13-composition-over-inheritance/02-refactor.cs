// 02-refactor.cs — the same behaviour written twice: once as an inheritance
// tree that has rotted, once as composition. The outputs are compared so the
// refactor is demonstrably behaviour-preserving.
// .NET 10.0.400. Run: dotnet run 02-refactor.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ============ BEFORE: four levels, each adding one concern ==================
abstract class ReportBase
{
    protected readonly List<string> Log = new();

    public string Run(string[] rows)
    {
        Log.Clear();
        var filtered = Filter(rows);
        var formatted = Format(filtered);
        return Decorate(formatted);
    }

    protected virtual string[] Filter(string[] rows) => rows;
    protected abstract string Format(string[] rows);
    protected virtual string Decorate(string body) => body;
    public IReadOnlyList<string> Trace => Log;
}

class CsvReport : ReportBase
{
    protected override string Format(string[] rows)
    {
        Log.Add("format:csv");
        return string.Join(",", rows);
    }
}

class FilteredCsvReport : CsvReport
{
    protected override string[] Filter(string[] rows)
    {
        Log.Add("filter:nonempty");
        return rows.Where(r => !string.IsNullOrWhiteSpace(r)).ToArray();
    }
}

class TitledFilteredCsvReport : FilteredCsvReport
{
    private readonly string _title;
    public TitledFilteredCsvReport(string title) => _title = title;

    protected override string Decorate(string body)
    {
        Log.Add("decorate:title");
        return $"# {_title}\n{body}";
    }
}

// Wanted: a titled, filtered, TSV report. There is no path to it without
// duplicating FilteredCsvReport and TitledFilteredCsvReport for TSV.

// ============ AFTER: three small pieces, combined ===========================
interface IRowFilter { string[] Apply(string[] rows, IList<string> log); }
interface IRowFormatter { string Format(string[] rows, IList<string> log); }
interface IDecorator { string Decorate(string body, IList<string> log); }

sealed class NonEmptyFilter : IRowFilter
{
    public string[] Apply(string[] rows, IList<string> log)
    {
        log.Add("filter:nonempty");
        return rows.Where(r => !string.IsNullOrWhiteSpace(r)).ToArray();
    }
}

sealed class PassThroughFilter : IRowFilter
{
    public string[] Apply(string[] rows, IList<string> log) => rows;
}

sealed class CsvFormatter : IRowFormatter
{
    public string Format(string[] rows, IList<string> log)
    {
        log.Add("format:csv");
        return string.Join(",", rows);
    }
}

sealed class TsvFormatter : IRowFormatter
{
    public string Format(string[] rows, IList<string> log)
    {
        log.Add("format:tsv");
        return string.Join("\t", rows);
    }
}

sealed class TitleDecorator : IDecorator
{
    private readonly string _title;
    public TitleDecorator(string title) => _title = title;
    public string Decorate(string body, IList<string> log)
    {
        log.Add("decorate:title");
        return $"# {_title}\n{body}";
    }
}

sealed class NoDecorator : IDecorator
{
    public string Decorate(string body, IList<string> log) => body;
}

sealed class Report
{
    private readonly IRowFilter _filter;
    private readonly IRowFormatter _formatter;
    private readonly IDecorator _decorator;
    private readonly List<string> _log = new();

    public Report(IRowFilter filter, IRowFormatter formatter, IDecorator decorator)
        => (_filter, _formatter, _decorator) = (filter, formatter, decorator);

    public IReadOnlyList<string> Trace => _log;

    public string Run(string[] rows)
    {
        _log.Clear();
        var filtered = _filter.Apply(rows, _log);
        var formatted = _formatter.Format(filtered, _log);
        return _decorator.Decorate(formatted, _log);
    }
}

class Program
{
    static void Main()
    {
        string[] rows = { "id", "", "name", "   ", "amount" };

        var before = new TitledFilteredCsvReport("Sales");
        string beforeOut = before.Run(rows);

        var after = new Report(new NonEmptyFilter(), new CsvFormatter(),
                               new TitleDecorator("Sales"));
        string afterOut = after.Run(rows);

        Console.WriteLine("BEFORE (4-level hierarchy):");
        Console.WriteLine(Indent(beforeOut));
        Console.WriteLine($"  trace: {string.Join(" -> ", before.Trace)}");

        Console.WriteLine();
        Console.WriteLine("AFTER (3 composed parts):");
        Console.WriteLine(Indent(afterOut));
        Console.WriteLine($"  trace: {string.Join(" -> ", after.Trace)}");

        Console.WriteLine();
        Console.WriteLine($"outputs identical : {beforeOut == afterOut}");
        Console.WriteLine($"traces identical  : {before.Trace.SequenceEqual(after.Trace)}");

        Console.WriteLine();
        Console.WriteLine("The combination the hierarchy could not express, at no extra cost:");
        var tsv = new Report(new NonEmptyFilter(), new TsvFormatter(),
                             new TitleDecorator("Sales"));
        Console.WriteLine(Indent(tsv.Run(rows).Replace("\t", "<TAB>")));

        var plain = new Report(new PassThroughFilter(), new TsvFormatter(), new NoDecorator());
        Console.WriteLine(Indent(plain.Run(rows).Replace("\t", "<TAB>")));
    }

    static string Indent(string s) =>
        string.Join("\n", s.Split('\n').Select(l => "  | " + l));
}
