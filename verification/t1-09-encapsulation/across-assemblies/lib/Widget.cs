using System.Runtime.CompilerServices;

// Comment this line out to watch Consumer stop compiling.
[assembly: InternalsVisibleTo("Consumer")]

namespace Lib;

public class Widget
{
    public int Public = 1;
    internal int Internal = 2;
    protected int Protected = 3;
    protected internal int ProtectedInternal = 4;   // protected OR internal
    private protected int PrivateProtected = 5;     // protected AND internal

    public string All() =>
        $"{Public} {Internal} {Protected} {ProtectedInternal} {PrivateProtected}";
}
