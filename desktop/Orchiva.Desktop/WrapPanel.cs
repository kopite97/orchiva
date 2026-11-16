using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace Orchiva.Desktop;

// Keep action groups usable when the window or the display scale changes.
public sealed class WrapPanel : Panel
{
    private const double Gap = 8;
    protected override Size MeasureOverride(Size availableSize)
    {
        double x = 0, y = 0, row = 0, width = 0;
        foreach (var child in Children)
        {
            child.Measure(new Size(availableSize.Width, double.PositiveInfinity));
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > availableSize.Width) { y += row + Gap; x = row = 0; }
            width = Math.Max(width, x + size.Width);
            x += size.Width + Gap; row = Math.Max(row, size.Height);
        }
        return new Size(width, y + row);
    }
    protected override Size ArrangeOverride(Size finalSize)
    {
        double x = 0, y = 0, row = 0;
        foreach (var child in Children)
        {
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > finalSize.Width) { y += row + Gap; x = row = 0; }
            child.Arrange(new Rect(x, y, Math.Min(size.Width, finalSize.Width), size.Height));
            x += size.Width + Gap; row = Math.Max(row, size.Height);
        }
        return finalSize;
    }
}
