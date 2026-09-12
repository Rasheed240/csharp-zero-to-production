// 02-scheduling.cs — Cron expressions, time zones, and the two days a year when
// a daily job runs late, or twice, or not at all.
//
// Run:  dotnet run 02-scheduling.cs -c Release
//
// EXACT vs RATIO: every occurrence computed here is deterministic and will be
// identical on any machine with the same time zone database.

#:sdk Microsoft.NET.Sdk
#:property PublishAot=false
#:package Cronos@0.11.0

using Cronos;

Console.WriteLine("Cron, time zones, and the two awkward days");
Console.WriteLine();

WhatCronSays();
TimeZones();
SpringForward();
FallBack();
MissedRuns();

// ---------------------------------------------------------------------------
static void WhatCronSays()
{
    Console.WriteLine("1. Reading a cron expression");
    Console.WriteLine();
    Console.WriteLine("   Five fields, in this order:");
    Console.WriteLine();
    Console.WriteLine("     minute   hour   day-of-month   month   day-of-week");
    Console.WriteLine("     0-59     0-23   1-31           1-12    0-6 (Sunday is 0 and 7)");
    Console.WriteLine();

    (string Expression, string Meaning)[] examples =
    [
        ("* * * * *", "every minute"),
        ("0 * * * *", "every hour, on the hour"),
        ("30 2 * * *", "02:30 every day"),
        ("0 9 * * 1-5", "09:00 on weekdays"),
        ("*/15 * * * *", "every fifteen minutes"),
        ("0 0 1 * *", "midnight on the first of the month"),
        ("0 0 * * 0", "midnight on Sunday"),
        ("0 3 1 1 *", "03:00 on the 1st of January")
    ];

    var from = new DateTime(2027, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    Console.WriteLine("   expression      means                                next two after 2027-06-15 12:00 UTC");
    Console.WriteLine("   ----------      -----                                -----------------------------------");

    foreach ((string expression, string meaning) in examples)
    {
        CronExpression cron = CronExpression.Parse(expression);

        DateTime? first = cron.GetNextOccurrence(from);
        DateTime? second = first is null ? null : cron.GetNextOccurrence(first.Value);

        Console.WriteLine($"   {expression,-15} {meaning,-36} {Show(first)}, {Show(second)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIELD THAT SURPRISES PEOPLE IS DAY-OF-WEEK COMBINED WITH");
    Console.WriteLine("   DAY-OF-MONTH. When both are restricted, cron uses OR, not AND -");
    Console.WriteLine("   '0 0 1 * 0' means the first of the month OR any Sunday, not 'the first");
    Console.WriteLine("   if it is a Sunday'. It is the one rule in cron that is not what the");
    Console.WriteLine("   syntax suggests.");
    Console.WriteLine();
    Console.WriteLine("   AND CRON HAS NO SECONDS FIELD, in the five-field form. Some libraries");
    Console.WriteLine("   accept a six-field variant where the first field is seconds, so the");
    Console.WriteLine("   same string means different things in different tools. IF AN");
    Console.WriteLine("   EXPRESSION IS RUNNING SIXTY TIMES TOO OFTEN, COUNT THE FIELDS.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TimeZones()
{
    Console.WriteLine("2. The same expression in three time zones");
    Console.WriteLine();
    Console.WriteLine("   '0 9 * * *' - nine in the morning. Nine where?");
    Console.WriteLine();

    CronExpression cron = CronExpression.Parse("0 9 * * *");
    var from = new DateTimeOffset(2027, 6, 15, 12, 0, 0, TimeSpan.Zero);

    (string Id, string Label)[] zones =
    [
        ("UTC", "UTC"),
        ("Europe/London", "London (BST in June)"),
        ("America/New_York", "New York (EDT in June)"),
        ("Asia/Tokyo", "Tokyo")
    ];

    Console.WriteLine("   time zone                  next occurrence, as UTC");
    Console.WriteLine("   ---------                  -----------------------");

    foreach ((string id, string label) in zones)
    {
        TimeZoneInfo zone = TimeZoneInfo.FindSystemTimeZoneById(id);
        DateTimeOffset? next = cron.GetNextOccurrence(from, zone);

        Console.WriteLine($"   {label,-26} {next?.UtcDateTime:yyyy-MM-dd HH:mm} UTC");
    }

    Console.WriteLine();
    Console.WriteLine("   A CRON EXPRESSION WITHOUT A TIME ZONE IS AN INCOMPLETE INSTRUCTION.");
    Console.WriteLine("   The same five characters mean four different moments, eight hours");
    Console.WriteLine("   apart at the extremes.");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEFAULT IS THE TRAP. Most schedulers default to UTC, which is");
    Console.WriteLine("   the right default and is not what the person writing '0 9 * * *' meant.");
    Console.WriteLine("   They meant nine o'clock where the business is, and for half the year");
    Console.WriteLine("   in the UK - and all of it in New York - those differ.");
    Console.WriteLine();
    Console.WriteLine("   SO STATE THE ZONE EXPLICITLY, EVERY TIME, and choose it deliberately:");
    Console.WriteLine();
    Console.WriteLine("     UTC IF THE TIMING IS TECHNICAL. 'Every fifteen minutes', 'nightly");
    Console.WriteLine("     cleanup' - nobody cares what the clock says, and UTC never has the");
    Console.WriteLine("     two awkward days below.");
    Console.WriteLine();
    Console.WriteLine("     A REAL ZONE IF THE TIMING IS HUMAN. 'Send the statement at 9am',");
    Console.WriteLine("     'close the books at midnight' - these mean local time, and pinning");
    Console.WriteLine("     them to UTC makes them drift by an hour twice a year.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void SpringForward()
{
    Console.WriteLine("3. The day a daily job runs at the wrong time");
    Console.WriteLine();
    Console.WriteLine("   In the UK the clocks go forward on 28 March 2027: at 01:00 the local");
    Console.WriteLine("   time becomes 02:00. The times between do not happen.");
    Console.WriteLine();

    TimeZoneInfo london = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");

    (string Expression, string Label)[] jobs =
    [
        ("30 0 * * *", "00:30 daily - before the gap"),
        ("30 1 * * *", "01:30 daily - INSIDE the gap"),
        ("30 2 * * *", "02:30 daily - after the gap")
    ];

    var from = new DateTimeOffset(2027, 3, 27, 12, 0, 0, TimeSpan.Zero);

    Console.WriteLine("   schedule                        the three occurrences either side of the change");
    Console.WriteLine("   --------                        ----------------------------------------------");

    foreach ((string expression, string label) in jobs)
    {
        CronExpression cron = CronExpression.Parse(expression);
        var occurrences = new List<string>();

        DateTimeOffset? next = from;

        for (int i = 0; i < 3 && next is not null; i++)
        {
            next = cron.GetNextOccurrence(next.Value, london);

            if (next is { } occurrence)
            {
                occurrences.Add($"{TimeZoneInfo.ConvertTime(occurrence, london):dd HH:mm}");
            }
        }

        Console.WriteLine($"   {label,-31} {string.Join("   ", occurrences)}");
    }

    Console.WriteLine();
    Console.WriteLine("   READ THE MIDDLE ROW. On the 28th the 01:30 job ran at 02:00, and on");
    Console.WriteLine("   every other day it ran at 01:30.");
    Console.WriteLine();
    Console.WriteLine("   THE JOB WAS NOT SKIPPED AND IT WAS NOT ON TIME. Cronos fires it at the");
    Console.WriteLine("   instant the gap ends - the first moment that local clock reading could");
    Console.WriteLine("   have been reached. That is a reasonable reading of 'run daily at");
    Console.WriteLine("   01:30' and it is not the only one.");
    Console.WriteLine();
    Console.WriteLine("   WHY THAT MATTERS MORE THAN IT LOOKS: THE JOB RAN THIRTY MINUTES LATE,");
    Console.WriteLine("   and the gap between it and the previous day's run was 23 hours, not 24.");
    Console.WriteLine("   A job that processes 'everything since the last run' is fine. A job");
    Console.WriteLine("   with a hardcoded 24-hour window silently misses thirty minutes of data");
    Console.WriteLine("   on that one night, and nothing about the run looks unusual.");
    Console.WriteLine();
    Console.WriteLine("   AND THE BEHAVIOUR IS NOT UNIVERSAL, WHICH IS WORSE THAN IT BEING WRONG.");
    Console.WriteLine("   Some schedulers fire at the end of the gap as this one does, some skip");
    Console.WriteLine("   the day entirely, some fire at the start of the gap. Cron itself has no");
    Console.WriteLine("   opinion, because cron predates the question. WHICHEVER YOUR SCHEDULER");
    Console.WriteLine("   DOES, IT IS A CHOICE SOMEBODY ELSE MADE ON YOUR BEHALF - and eight");
    Console.WriteLine("   lines like these are how you find out which one, rather than reading a");
    Console.WriteLine("   changelog and hoping.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void FallBack()
{
    Console.WriteLine("4. The day a daily job runs twice");
    Console.WriteLine();
    Console.WriteLine("   On 31 October 2027 the clocks go back: 02:00 becomes 01:00, so every");
    Console.WriteLine("   local time between 01:00 and 02:00 happens twice.");
    Console.WriteLine();

    TimeZoneInfo london = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");
    CronExpression cron = CronExpression.Parse("30 1 * * *");

    var from = new DateTimeOffset(2027, 10, 30, 12, 0, 0, TimeSpan.Zero);

    Console.WriteLine("   occurrences of '01:30 daily' across the change");
    Console.WriteLine("   ----------------------------------------------");

    DateTimeOffset? next = from;

    for (int i = 0; i < 3 && next is not null; i++)
    {
        next = cron.GetNextOccurrence(next.Value, london);

        if (next is { } occurrence)
        {
            Console.WriteLine($"   local {TimeZoneInfo.ConvertTime(occurrence, london):dd MMM HH:mm zzz}   " +
                $"= {occurrence.UtcDateTime:dd MMM HH:mm} UTC");
        }
    }

    Console.WriteLine();
    Console.WriteLine("   IT RAN ONCE, AT THE FIRST 01:30. Cronos takes the earlier of the two");
    Console.WriteLine("   and does not repeat - which is a defensible choice and, again, a choice");
    Console.WriteLine("   somebody made for you.");
    Console.WriteLine();
    Console.WriteLine("   A SCHEDULER THAT TOOK THE OTHER VIEW WOULD RUN THE JOB TWICE, an hour");
    Console.WriteLine("   apart, both legitimately at '01:30 local'. If that job charges a");
    Console.WriteLine("   subscription, somebody is billed twice, on one night a year, and the");
    Console.WriteLine("   ticket says 'duplicate charge on the 31st of October' with no other");
    Console.WriteLine("   pattern to it.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WHY THE REAL DEFENCE IS NOT THE SCHEDULE. Two runs an hour");
    Console.WriteLine("   apart are indistinguishable, to the job, from a retry - and a job that");
    Console.WriteLine("   is safe to retry is automatically safe on both of these days. THE DST");
    Console.WriteLine("   PROBLEM IS THE IDEMPOTENCY PROBLEM WEARING A CALENDAR.");
    Console.WriteLine();
    Console.WriteLine("   AND IF YOU CAN, AVOID THE HOUR ENTIRELY. Nothing important should be");
    Console.WriteLine("   scheduled between 00:30 and 03:00 local time in a zone that observes");
    Console.WriteLine("   daylight saving. It costs nothing to schedule at 04:00 instead, and it");
    Console.WriteLine("   removes both of these days from your life.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void MissedRuns()
{
    Console.WriteLine("5. What happens to a run that was missed");
    Console.WriteLine();
    Console.WriteLine("   A nightly job at 02:00. The service was down for maintenance from 01:00");
    Console.WriteLine("   to 04:00. What should happen at 04:00?");
    Console.WriteLine();

    CronExpression cron = CronExpression.Parse("0 2 * * *");

    var downFrom = new DateTime(2027, 6, 15, 1, 0, 0, DateTimeKind.Utc);
    var backUp = new DateTime(2027, 6, 15, 4, 0, 0, DateTimeKind.Utc);

    var missed = new List<DateTime>();
    DateTime? cursor = cron.GetNextOccurrence(downFrom);

    while (cursor is { } occurrence && occurrence < backUp)
    {
        missed.Add(occurrence);
        cursor = cron.GetNextOccurrence(occurrence);
    }

    Console.WriteLine($"   occurrences during the outage   {missed.Count} ({string.Join(", ", missed.Select(m => $"{m:HH:mm}"))})");
    Console.WriteLine($"   next occurrence after recovery  {cron.GetNextOccurrence(backUp):yyyy-MM-dd HH:mm}");
    Console.WriteLine();
    Console.WriteLine("   THE SCHEDULER CAN COMPUTE THAT A RUN WAS MISSED. What it cannot know is");
    Console.WriteLine("   whether you want it, and the three answers are all correct for");
    Console.WriteLine("   different jobs:");
    Console.WriteLine();
    Console.WriteLine("     RUN IT NOW. Right for work that must happen - closing the books,");
    Console.WriteLine("     settling payments. Late is better than never.");
    Console.WriteLine();
    Console.WriteLine("     SKIP IT. Right for work that is only useful at its moment - a");
    Console.WriteLine("     'good morning' digest at 07:00 is not wanted at 11:00.");
    Console.WriteLine();
    Console.WriteLine("     RUN IT ONCE, NOT N TIMES. Right for a frequent job after a long");
    Console.WriteLine("     outage. A five-minute job that missed three hours does not want");
    Console.WriteLine("     thirty-six runs queued at once - which is a thundering herd you");
    Console.WriteLine("     built yourself, aimed at a system that has only just recovered.");
    Console.WriteLine();
    Console.WriteLine("   HANGFIRE'S RECURRING JOBS DO THE FIRST: on recovery it notices the");
    Console.WriteLine("   schedule has passed and enqueues. Quartz calls this a MISFIRE and lets");
    Console.WriteLine("   you pick a policy per trigger, which is the more honest design because");
    Console.WriteLine("   it makes you answer the question.");
    Console.WriteLine();
    Console.WriteLine("   AND THE QUESTION IS ALWAYS THE SAME ONE: IS THIS JOB A COMMAND OR A");
    Console.WriteLine("   HEARTBEAT? A command missed is a command still owed. A heartbeat missed");
    Console.WriteLine("   is a heartbeat gone. Nothing in a cron expression records which of the");
    Console.WriteLine("   two you meant.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static string Show(DateTime? moment) =>
    moment is { } value ? $"{value:yyyy-MM-dd HH:mm}" : "never";
