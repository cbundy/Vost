# Strategy maker

The strategy maker is an optional page at `/strategy-maker` (type it after your Vost address). It is the first part of a small tool for working out strategies from candles, and for now it does one thing: it shows the candles you pick on a chart of its own. Everything stays in this browser, and the main chart app is not started: the page opens no live stream and does no alert polling. The main app never loads the page's code.

![The empty strategy maker page](../evidence/strategy-maker/strategy-maker-empty-desktop.png)

## Where the data comes from

- **A market**: choose a provider, a symbol (pick a popular one or type your own) and a timeframe, then **Load market**.
- **A saved dataset**: datasets saved in the main app's library are listed read-only; the page never changes the library. With none saved it says "No saved datasets."
- **A CSV file**: **CSV file** opens a file from your disk. A file that cannot be read shows a message on the page.

![A demo market](../evidence/strategy-maker/strategy-maker-market-desktop.png)

The chart pans, zooms and resizes with the window, and works on a narrow screen too.

![A CSV file on a narrow screen](../evidence/strategy-maker/strategy-maker-csv-narrow.png)

## Marking trades

Once candles are showing, a toolbar above the chart lets you mark the trades you would have taken, with a brush. These marks are what the tool will later learn a strategy from; you need at least 30 of them.

- **Brush long** and **Brush short**: pick one (it shows as pressed), then press on the chart, drag across some bars and let go. The bars from the first to the last one you touched become one trade, shaded green for long or red for short, with an entry and an exit marker. Dragging right to left gives the same trade. A plain click, or a drag over a single bar, marks nothing.
- **Eraser**: drag over trades to remove every one you touch.
- **Undo**, **Redo** and **Clear** (which asks first) work on the marks of this chart.
- While a tool is on, dragging paints instead of moving the chart. Press the tool again, or **Escape**, to pan and zoom as before. One finger paints on a touch screen.
- A new stroke over existing trades replaces the part it covers, so trades never overlap; what is left of a cut trade stays when it still spans two bars.

Keys: **B** brush (it keeps its last side), **E** eraser, **Ctrl+Z** / **Cmd+Z** undo, **Ctrl+Shift+Z** redo, **Escape** leaves the tool. They are ignored while you type in a field.

![A long and a short trade painted on the demo market](../evidence/strategy-maker/strategy-maker-marked-desktop.png)

The list beside the chart (below it on a narrow screen) shows each trade with its side, entry and exit time and bar count; click a row to scroll the chart to it, or its **x** to delete it. The counter shows "N of 30 trades" across all your saved charts and how many more are needed.

![A trade erased](../evidence/strategy-maker/strategy-maker-erased-narrow.png)

Marks are saved in this browser a moment after each change and come back when you open the same chart again (the same market and timeframe, saved dataset or CSV file name). Undo history is not kept. If the browser cannot store them, the page says so and the brush still works until you leave.

![The marks found again after a reload](../evidence/strategy-maker/strategy-maker-restored-desktop.png)
