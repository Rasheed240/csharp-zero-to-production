// 06-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 06-exercises.cs -c Release

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// ===== Exercise 2 ==========================================================
class Registry<T>
{
    public static readonly List<string> Registered = new();
    public static void Register(string name) => Registered.Add(name);
}

// ===== Exercise 3 ==========================================================
class Animal { public string Name = ""; }
class Dog : Animal { }
class Cat : Animal { }

interface ICovariant<out T> { T Get(); }
interface IContravariant<in T> { void Put(T item); }

sealed class DogSource : ICovariant<Dog> { public Dog Get() => new Dog { Name = "Rex" }; }
sealed class AnimalSink : IContravariant<Animal>
{
    public List<string> Received = new();
    public void Put(Animal a) => Received.Add(a.GetType().Name);
}

class Program
{
    const int N = 2_000_000;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: boxing =====");
        var al = new ArrayList(N);
        long b0 = GC.GetTotalAllocatedBytes(true);
        for (int i = 0; i < N; i++) al.Add(i);
        long alBytes = GC.GetTotalAllocatedBytes(true) - b0;

        var gl = new List<int>(N);
        b0 = GC.GetTotalAllocatedBytes(true);
        for (int i = 0; i < N; i++) gl.Add(i);
        long glBytes = GC.GetTotalAllocatedBytes(true) - b0;

        Console.WriteLine($"  ArrayList : {alBytes:N0} bytes ({(double)alBytes / N:F0} per element)");
        Console.WriteLine($"  List<int> : {glBytes:N0} bytes");

        var objList = new List<object>(N);
        b0 = GC.GetTotalAllocatedBytes(true);
        for (int i = 0; i < N; i++) objList.Add(i);
        Console.WriteLine($"  List<object> : {GC.GetTotalAllocatedBytes(true) - b0:N0} bytes " +
                          "(generic, and still boxes)");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: statics per instantiation =====");
        Registry<int>.Register("a");
        Registry<int>.Register("b");
        Registry<string>.Register("c");
        Console.WriteLine($"  Registry<int>.Registered    : [{string.Join(", ", Registry<int>.Registered)}]");
        Console.WriteLine($"  Registry<string>.Registered : [{string.Join(", ", Registry<string>.Registered)}]");
        Console.WriteLine($"  Registry<object>.Registered : [{string.Join(", ", Registry<object>.Registered)}]");
        Console.WriteLine($"  same List instance?         : " +
                          $"{ReferenceEquals(Registry<int>.Registered, Registry<string>.Registered)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: variance =====");
        ICovariant<Dog> dogs = new DogSource();
        ICovariant<Animal> asAnimals = dogs;
        Console.WriteLine($"  ICovariant<Dog> as ICovariant<Animal>   : {asAnimals.Get().GetType().Name}");

        var sink = new AnimalSink();
        IContravariant<Animal> anyAnimal = sink;
        IContravariant<Dog> dogsOnly = anyAnimal;
        dogsOnly.Put(new Dog());
        anyAnimal.Put(new Cat());
        Console.WriteLine($"  IContravariant<Animal> as <Dog>, received: [{string.Join(", ", sink.Received)}]");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: array covariance =====");
        Dog[] dogArray = { new Dog { Name = "Rex" } };
        Animal[] animalArray = dogArray;
        Console.WriteLine($"  Dog[] as Animal[] compiled : True");
        try { animalArray[0] = new Cat(); }
        catch (ArrayTypeMismatchException ex)
        { Console.WriteLine($"  storing a Cat threw        : {ex.GetType().Name}"); }

        Console.WriteLine();
        Console.WriteLine("  cost of the check every array store pays:");
        var plain = new Dog[1000];
        var viaBase = (Animal[])plain;
        var dog = new Dog();
        Time("Dog[] store", () => { for (int i = 0; i < N; i++) plain[i % 1000] = dog; });
        Time("Animal[] store (same array)", () => { for (int i = 0; i < N; i++) viaBase[i % 1000] = dog; });
        var exact = new List<Dog>(new Dog[1000]);
        Time("List<Dog> store", () => { for (int i = 0; i < N; i++) exact[i % 1000] = dog; });
    }

    static void Time(string label, Action body)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            body();
            sw.Stop();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"    {label,-30} {best,6:F1} ms   {best * 1e6 / N,4:F2} ns/store");
    }
}
