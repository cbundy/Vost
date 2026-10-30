# Forecasting and measuring tools

The **Forecasting and measurers** family of the [drawing rail](drawings.md) holds the **Long position** and **Short position** tools (the Forecasting section) and the **Measure** tool (the Measurers section; see [Drawings](drawings.md)).

## Positions

A position plans a trade on the chart: an entry, a **target** zone on the profitable side and a **stop** zone on the other, with the risk, the quantity and the profit or loss they imply. A **Long position** profits when price rises (target above the entry, stop below); a **Short position** is the mirror.

### Placing one

Pick **Long position** or **Short position**. Before you click, the shape follows the pointer so you see what the click will place. One click (or one tap on a phone) places it: the entry where you clicked, the target and stop a fixed fraction of the pane above and below (the target twice as far as the stop), and the right edge a fixed distance to the right. With the magnet on, the entry snaps to the bar.

![The shape follows the pointer before the click](../evidence/drawing-positions/drawing-positions-preview-desktop.png)

### Moving and resizing

Click a position to select it. Four handles show:

- the **entry** (left edge, at the entry price): moves the entry price and the start time;
- the **target** and the **stop** (the left corner of each zone): move that price only;
- the **right edge**: moves the end time of both zones together.

A target or stop dragged across the entry stops one tick from it (one pixel when the chart has no tick size), so a position never turns inside out. Drag the body to move the whole position. The prices and times of the selected position show on the axes.

![A selected long position with its handles and stats](../evidence/drawing-positions/drawing-positions-selected-desktop.png)

### What it works out

The label (shown while the position is selected, or always with **Always show stats**) gives the closed or open result, the quantity and the risk/reward ratio; each zone adds its distance in price, percent and ticks and its profit or loss when it is wide enough to read.

- **Risk** is a percent of the account size, or a fixed amount.
- **Quantity** is the risk divided by the loss one unit takes at the stop (the stop distance times the lot size), rounded **down** to a whole unit, so the loss at the stop never goes over the risk.
- **Profit** at the target and **loss** at the stop are the distance times the quantity times the lot size. Money shows with two decimals.
- **Risk/reward** is the target distance over the stop distance.

### What happened after the entry

Vost walks the bars after the entry bar up to the position's end. The first bar that reaches the target or the stop decides the result: the dashed line runs from the entry to that point and the label shows **Closed P&L** with the profit or loss. A bar that reaches both counts as the stop, the cautious reading. With neither reached the label says **Open**.

![A long whose target was hit and a short whose stop was hit](../evidence/drawing-positions/drawing-positions-outcomes-desktop.png)

### Settings

Double-click a position to open its settings.

- **Style**: line colour, target and stop fill colour and opacity, text colour and font size, **Compact stats mode**, **Always show stats** and **Show price labels**.
- **Inputs** (after Style): **Account size** (1000), **Lot size** (1), **Risk** (25) and **Risk unit** (percent of the account, or an amount).
- **Coordinates**: the entry, target and stop prices and the start and end times. Editing the target's or stop's time moves both. A price on the wrong side of the entry is refused.
- **Visibility**: the timeframes it shows on.

![The Inputs tab](../evidence/drawing-positions/drawing-positions-inputs-desktop.png)

**Save as default** keeps the inputs and the style for new positions of that tool. Positions are saved in your browser and survive a reload, a zoom, a pan and a timeframe change; **Ctrl+Z** and **Ctrl+Shift+Z** undo and redo every change.
