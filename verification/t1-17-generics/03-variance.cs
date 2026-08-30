// 03-variance.cs — when a List<Derived> is usable as a List<Base>, and when it
// is not. .NET 10.0.400. Run: dotnet run 03-variance.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Animal { public virtual string Noise => "..."; public string Name = ""; }
class Dog : Animal { public override string Noise => "woof"; }
class Cat : Animal { public override string Noise => "meow"; }

// out T: T only ever comes OUT. Safe to treat IProducer<Dog> as IProducer<Animal>.
interface IProducer<out T> { T Produce(); }

// in T: T only ever goes IN. Safe to treat IConsumer<Animal> as IConsumer<Dog>.
interface IConsumer<in T> { string Consume(T item); }

// No variance annotation: T appears in both positions, so neither direction is safe.
interface IStore<T> { T Get(); void Put(T item); }

sealed class DogKennel : IProducer<Dog> { public Dog Produce() => new Dog { Name = "Rex" }; }
sealed class AnimalFeeder : IConsumer<Animal>
{
    public string Consume(Animal a) => $"fed {a.Name} ({a.Noise})";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- covariance: out T, producer side ---");
        IProducer<Dog> dogs = new DogKennel();
        IProducer<Animal> animals = dogs;             // allowed by 'out'
        Animal a = animals.Produce();
        Console.WriteLine($"  IProducer<Dog> used as IProducer<Animal>: {a.GetType().Name} says {a.Noise}");

        Console.WriteLine();
        Console.WriteLine("--- contravariance: in T, consumer side ---");
        IConsumer<Animal> anyAnimal = new AnimalFeeder();
        IConsumer<Dog> dogOnly = anyAnimal;           // allowed by 'in'
        Console.WriteLine($"  IConsumer<Animal> used as IConsumer<Dog>: {dogOnly.Consume(new Dog { Name = "Rex" })}");

        Console.WriteLine();
        Console.WriteLine("--- IEnumerable<T> is covariant, so this works ---");
        List<Dog> kennel = new() { new Dog { Name = "Rex" }, new Dog { Name = "Bess" } };
        IEnumerable<Animal> asAnimals = kennel;       // List<Dog> -> IEnumerable<Animal>
        Console.WriteLine($"  names via IEnumerable<Animal>: " +
                          $"{string.Join(", ", asAnimals.Select(x => x.Name))}");

        Console.WriteLine();
        Console.WriteLine("--- but List<T> itself is INVARIANT ---");
        Console.WriteLine("  List<Animal> pets = kennel;   does not compile (CS0029)");
        Console.WriteLine("  because List<T> lets you Add, and adding a Cat to a List<Dog>");
        Console.WriteLine("  through a List<Animal> reference would be a type hole.");

        Console.WriteLine();
        Console.WriteLine("--- arrays ARE covariant, and that is the hole ---");
        Dog[] dogArray = { new Dog { Name = "Rex" } };
        Animal[] animalArray = dogArray;              // allowed, and unsafe
        Console.WriteLine($"  Dog[] assigned to Animal[]: {animalArray.Length} element(s)");
        try
        {
            animalArray[0] = new Cat { Name = "Tibbles" };
            Console.WriteLine("  stored a Cat in a Dog[]");
        }
        catch (ArrayTypeMismatchException ex)
        {
            Console.WriteLine($"  storing a Cat threw {ex.GetType().Name} at RUN TIME");
        }
        Console.WriteLine("  Generics moved this check from run time to compile time.");

        Console.WriteLine();
        Console.WriteLine("--- IStore<T> is invariant in both directions ---");
        Console.WriteLine("  IStore<Animal> s = storeOfDogs;  does not compile");
        Console.WriteLine("  IStore<Dog>    d = storeOfAnimals; does not compile");
        Console.WriteLine("  T appears in a return position AND a parameter position, so");
        Console.WriteLine("  neither 'out' nor 'in' can be applied to it.");
    }
}
