# Text and Anchored text

Two note tools sit in the Annotations family of the [drawing rail](drawings.md): **Text**, a note at a time and price, and **Anchored text**, a note fixed on the chart's pane.

## Typing a note

Pick a tool and click the chart. A box opens where you click and takes the note's own font, size, bold, italic and alignment while you type.

- **Enter** adds a line. **Ctrl+Enter** (**Cmd+Enter** on a Mac) saves the note, and so does clicking away from the box. **Escape** cancels.
- The box grows with the text. When the note wraps, it is as wide as its wrap width and a long line breaks to the next one, as it will on the chart.
- A note is at most 500 characters. An empty note is not saved.
- Double-click a note (double-tap on a phone) to edit it in place. Emptying it deletes it. **Shift+double-click** opens its settings instead.

![Typing a three-line note that wraps](../evidence/drawing-text/drawing-text-typing-desktop.png)

## The Text tab

The settings dialog of both tools has a **Text** tab with the text itself and every text setting:

- text colour, text size (8 to 48), bold and italic;
- **Alignment**: left, centre or right;
- **Wrap text** and **Wrap width** (40 to 1000 pixels). With wrap off a line only ends where you pressed Enter.

The background colour, its opacity and the border colour stay on the **Style** tab. Changes show on the chart as you make them, and **OK** keeps them as one undo step. **Save as default** makes them the start for new notes of that tool.

Text starts at 12 pixels and wraps at 240 pixels, so notes saved earlier look as they always did. Anchored text starts at 14 pixels, left aligned, without wrapping.

![The Text tab](../evidence/drawing-text/drawing-text-text-tab-desktop.png)

## Anchored text

Anchored text keeps its spot on the pane, whatever the chart does: panning, zooming, another timeframe or a new live bar do not move it. Use it for a title or a remark that belongs to the screen and not to a bar.

- It has no price or time. Its **Coordinates** tab shows the box's top-left corner as **X %** and **Y %** of the pane, from 0 to 100.
- Dragging moves it inside the pane. The magnet does not apply and it shows no labels on the axes.
- If the pane gets smaller, the box stays inside it as far as it can.

![Anchored text after a pan, a zoom and a timeframe change](../evidence/drawing-text/drawing-text-timeframe-desktop.png)

Both notes are saved in your browser with the other drawings, with their lines, and can be hidden on timeframes on the **Visibility** tab.
