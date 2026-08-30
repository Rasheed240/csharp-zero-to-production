// Polyfills.cs — netstandard2.0 predates several C# features the compiler will
// still let you USE, provided the marker type exists. This is a real constraint
// of writing generators, not an incidental detail:
//
//   error CS0518: Predefined type 'System.Runtime.CompilerServices.IsExternalInit'
//   is not defined or imported
//
// is what you get from a `record` or an `init` property without this file.

using System.ComponentModel;

namespace System.Runtime.CompilerServices
{
    /// <summary>Required by the compiler for `init` accessors and positional records.</summary>
    [EditorBrowsable(EditorBrowsableState.Never)]
    internal static class IsExternalInit
    {
    }
}
