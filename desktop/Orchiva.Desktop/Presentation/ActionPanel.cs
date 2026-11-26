using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace Orchiva.Desktop.Presentation;

// Keeps action order and tab order while wrapping at the available content width.
public sealed class ActionPanel : Panel
{
    protected override Size MeasureOverride(Size availableSize)
    {
        foreach (var child in Children) child.Measure(new Size(availableSize.Width, double.PositiveInfinity));
        return Layout(availableSize.Width, false);
    }
    protected override Size ArrangeOverride(Size finalSize) { Layout(finalSize.Width, true); return finalSize; }
    private Size Layout(double width, bool arrange)
    {
        double x = 0, y = 0, row = 0, used = 0;
        foreach (var child in Children)
        {
            if (child.Visibility == Visibility.Collapsed) continue;
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > width) { y += row + 12; x = 0; row = 0; }
            if (arrange) child.Arrange(new Rect(x, y, Math.Min(size.Width, width), size.Height));
            used = Math.Max(used, x + size.Width); x += size.Width + 12; row = Math.Max(row, size.Height);
        }
        return new Size(Math.Min(used, width), y + row);
    }
}
