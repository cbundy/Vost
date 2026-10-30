# Drawings

A rail beside the chart holds the drawing tools, one button per family of tools.

![The drawing rail with one button per family](../evidence/drawing-rail/drawing-rail-rail-desktop.png)

## Families and pop-out lists

Each button shows the tool you used last from its family (the first one at first). Click it to pick that tool. The button is pressed while the current tool is in its family. The families are Cursors, Lines, Fibonacci and Gann, Forecasting and measurers, Shapes and Annotations; more appear as more tools arrive.

Open a family's list with the small chevron on its button, a long press (half a second) or **ArrowRight** while the button has focus. The list groups tools under headings. Click a tool to pick it, which also makes it the family's button. Only one list is open at a time. An outside click or resizing the window closes it.

![The Lines list](../evidence/drawing-rail/drawing-rail-flyout-lines-desktop.png)

From the keyboard: **ArrowUp** and **ArrowDown** move (wrapping), **Home** and **End** jump, **Enter** or **Space** picks, **F** stars or unstars the tool in focus, and **Escape** or **ArrowLeft** closes the list and puts focus back on the family's button.

## Favourites

Click the star beside a tool to favourite it; the list stays open. Favourites show on a small bar floating over the chart (only the active chart), one button per favourite in the order you starred them. Drag the grip at its left to move it anywhere on the chart; it stays inside the chart, also when the window is resized. Your favourites, each family's last tool and the bar's place are remembered.

![The favourites bar](../evidence/drawing-rail/drawing-rail-bar-dragged-desktop.png)

## Tools

- **Cursors**: select, move and resize drawings. **Cross** is the usual crosshair. **Dot** and **Arrow** hide the crosshair lines (the price and time labels stay) and show a small dot or the plain arrow instead. The kind you pick is remembered.
- **Eraser**: a press on a drawing deletes it (one undo step), a press on empty chart does nothing, and the pointer over a drawing shows it will be erased. It is off while drawings are hidden. Escape goes back to the cursor.
- **Trend line**, **Horizontal line**, **Ray**, **Rectangle** and **Fibonacci retracement**: pick a tool, then click two points on the chart (or press, drag and release).
- **Text**: click the chart and type a note in place. Enter saves, Escape cancels. Double-click a note to edit it.
- **Measure**: drag, or click then click, between two points to see the price change, percent, bars and elapsed time in a shaded box (green up, red down). It is temporary: never saved, not in undo, and it clears on the next press, Escape or a rail pick.

![Fibonacci retracement](../evidence/drawings/drawings-fib-desktop.png)

![Measure](../evidence/drawings/drawings-measure-up-desktop.png)

## Working with drawings

Click a drawing to select it, drag to move it and drag a handle to resize it. Delete or Backspace removes the selected drawing. **Ctrl or Cmd+Z** undoes, **Ctrl or Cmd+Shift+Z** (or Ctrl+Y) redoes, Escape leaves the tool or clears the selection. With several charts these keys act on the active chart only ([Layouts](layouts.md)).

The rail also has:

- **Magnet**: snaps points to the nearest bar's time and its open, high, low or close (a horizontal line snaps price only).
- **Hide all drawings**: hides every drawing without deleting it.
- **Delete all drawings**: after a confirm, deletes all drawings for the current source. One undo step brings them back.

The rail scrolls when the window is short.

## Where they are saved

Drawings are saved per symbol in your browser, and keep their place across zoom, timeframe changes and live bars. Charts on the same market share their drawings.

## On phones

Below 600px the chart toolbar has a **Drawing tools** button that opens the same families as collapsible sections (the one holding the current tool is open), each tool with its star. The switches are below the sections. Picking a tool closes the menu, and Escape closes it too. Tap, tap places a line. One-finger pan and pinch zoom work as before in cursor mode.

![Drawing tools on a phone](../evidence/drawing-rail/drawing-rail-menu-lines-narrow.png)
