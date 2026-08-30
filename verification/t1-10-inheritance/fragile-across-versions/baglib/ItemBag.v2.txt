using System.Collections.Generic;

namespace BagLib;

// VERSION 2. Same public surface, same documented behaviour, and one
// performance fix: AddRange no longer routes through Add, so it can pre-size
// the list in one go. A reasonable, well-intentioned change.
public class ItemBag
{
    private readonly List<string> _items = new();

    public int Count => _items.Count;

    public virtual void Add(string item) => _items.Add(item);

    public virtual void AddRange(IEnumerable<string> items)
    {
        if (items is ICollection<string> c) _items.Capacity += c.Count;
        _items.AddRange(items);
    }
}
