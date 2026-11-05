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
