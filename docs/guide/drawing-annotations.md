# Text and notes

Six note tools sit in the Annotations family of the [drawing rail](drawings.md). **Text** and **Anchored text** (the Text section) are a note at a time and price and a note fixed on the chart's pane. **Note**, **Anchored note**, **Callout** and **Comment** (the Notes section) are described [below](#notes).

## Typing a note

Pick a tool and click the chart (a Callout asks for two points, see below). A box opens where you click and takes the note's own font, size, bold, italic and alignment while you type.

- **Enter** adds a line. **Ctrl+Enter** (**Cmd+Enter** on a Mac) saves the note, and so does clicking away from the box. **Escape** cancels.
- The box grows with the text. When the note wraps, it is as wide as its wrap width and a long line breaks to the next one, as it will on the chart.
- A note is at most 500 characters. An empty note is not saved.
- Double-click a note (double-tap on a phone) to edit it in place. Emptying it deletes it. **Shift+double-click** opens its settings instead.

![Typing a three-line note that wraps](../evidence/drawing-text/drawing-text-typing-desktop.png)

## The Text tab

The settings dialog of every note tool has a **Text** tab with the text itself and every text setting:

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

## Notes

The Notes section has four tools that carry text like Text does: they are typed, edited, styled and saved the same way, and their settings have the same Text tab. They start as white 14 pixel text on a blue box, wrapped at 240 pixels. On the Style tab you set the box's background colour and opacity and its border colour.

### Note and Anchored note

A **Note** is a pin whose tip sits on the bar and price you clicked. Its text is not on the chart until you ask for it:

- **Hover** the pin and the text shows in a box beside it.
- **Click** the pin (or tap it on a phone) to pin the box open; click it again to close it. A pinned box stays while you look elsewhere. It is not saved: after a reload every box is closed.
- A selected note shows its box too.
- The box is drawn over every other drawing and stays inside the pane, on the left of the pin near the right edge.
- The **Marker colour** on the Style tab colours the pin.

![A pinned note's popup](../evidence/drawing-notes/drawing-notes-pinned-desktop.png)

**Anchored note** is the same tool fixed on the pane like Anchored text: it keeps its spot through panning, zooming, another timeframe and new live bars, has X % and Y % on its Coordinates tab and ignores the magnet.

![Anchored note](../evidence/drawing-notes/drawing-notes-anchored-desktop.png)

### Callout

A **Callout** is a text box with a pointer to a bar. Press where the box goes and drag to the target, or click the box's place and then the target; the box opens for typing once both are placed, with a live preview until then. The pointer is a wedge from the box's nearest edge to the target and is not drawn while the target is inside the box.

- Drag the box handle to move the box and keep the target; drag the target handle to move the target; drag the body to move both.
- Pressing the box or the pointer selects it.

![A Callout moved by its box handle](../evidence/drawing-notes/drawing-notes-callout-moved-desktop.png)

### Comment

A **Comment** is a rounded speech bubble whose tail tip is on the bar and price you clicked. The bubble sits above and to the right of the tip, below it near the top edge and to its left near the right edge. Its text wraps by default. Double-click (double-tap) it to edit.

![A Comment with a long wrapping text](../evidence/drawing-notes/drawing-notes-comment-desktop.png)

All the note tools are saved in your browser with the other drawings, with their lines, and can be hidden on timeframes on the **Visibility** tab.
