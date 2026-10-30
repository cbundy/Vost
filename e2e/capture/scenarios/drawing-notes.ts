import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; text?: string; style?: Record<string, unknown> };

const GROUP = 'Annotations';
const LONG = 'a long comment that has to wrap onto several lines inside its speech bubble so the bubble grows';

export const drawingNotes: Scenario = {
  name: 'drawing-notes',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Note tools: Note (a pin whose text pops up on hover, a click pins it open and another unpins it), Anchored note (kept on the pane through a pan), Callout (placed by press-drag-release and by two clicks, its box handle dragged with the target kept, restyled), Comment (a long wrapping text, edited by double-click), then undo, redo and a reload; at 360 px they are placed and pinned with touch',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as Stored[];
    };
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    /** A canvas fraction; the canvas holds the price axis on its right, so x is scaled to stay in the plot. */
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const narrow = ctx.viewport === 'narrow';
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const input = page.getByLabel('Note text');
    const dialog = page.getByRole('dialog');
    const click = (p: { x: number; y: number }) => (narrow ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
    const cursorAt = async (p: { x: number; y: number }) => {
      await page.mouse.move(p.x - 30, p.y - 30);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      return page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
    };
    const pickTool = async (label: string) => {
      if (narrow) {
        await menuBtn.tap();
        const btn = menu.getByRole('button', { name: label, exact: true });
        if (!(await btn.isVisible())) await menu.getByRole('button', { name: GROUP, exact: true }).tap();
        await btn.tap();
        return;
      }
      await rail.getByRole('button', { name: `Open ${GROUP} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    const type = async (text: string) => {
      await input.waitFor({ state: 'visible' });
      await page.keyboard.type(text);
      await page.keyboard.press('Control+Enter');
      await input.waitFor({ state: 'hidden' });
    };
    const openSettings = async (x: number, y: number) => {
      await page.keyboard.down('Shift');
      await page.mouse.dblclick(x, y);
      await page.keyboard.up('Shift');
      await dialog.waitFor();
    };
    const last = async (tool: string) => (await stored()).filter((d) => d.tool === tool).at(-1)!;

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    const NOTE = { x: 0.1, y: 0.3 };
    const EMPTY = { x: 0.9, y: 0.85 };
    /** A strip of the chart beside the pin, where its popup is. */
    const strip = async () => {
      const p = await at(NOTE);
      return page.screenshot({ clip: { x: p.x + 8, y: p.y - 60, width: 230, height: 80 } });
    };
    const same = (a: Buffer, b: Buffer) => a.equals(b);

    await ctx.step('Note: placed and typed, its popup shown on hover, pinned by a click and unpinned by another', async () => {
      await pickTool('Note');
      await click(await at(NOTE));
      await type('Earnings gap to fill\nwatch the open');
      const n = await last('note');
      check('a note is stored with its two lines', !!n && n.text === 'Earnings gap to fill\nwatch the open' && n.anchors.length === 1, JSON.stringify(n));
      const pin = await at(NOTE);
      const pinHead = { x: pin.x, y: pin.y - 20 };
      const away = await at(EMPTY);
      await click(away); // deselect
      await page.mouse.move(away.x, away.y);
      const closed = await strip();
      await ctx.screenshot('closed');
      if (!narrow) {
        await page.mouse.move(pinHead.x + 40, pinHead.y - 40);
        await page.mouse.move(pinHead.x, pinHead.y, { steps: 4 });
        await page.waitForTimeout(150);
        check('hovering the pin shows the popup', !same(closed, await strip()));
        await ctx.screenshot('hover');
        await page.mouse.move(away.x, away.y, { steps: 4 });
        await page.waitForTimeout(150);
        check('moving away closes it', same(closed, await strip()));
      }
      await click(pinHead);
      await click(away);
      await page.mouse.move(away.x, away.y);
      await page.waitForTimeout(150);
      check('a click pins the popup open after deselecting', !same(closed, await strip()));
      await ctx.screenshot('pinned');
      await click(pinHead);
      await click(away);
      await page.mouse.move(away.x, away.y);
      await page.waitForTimeout(150);
      check('another click unpins it', same(closed, await strip()));
      check('pinning stores nothing: the note is unchanged', (await stored()).length === 1);
    });

    const ANCHORED = { x: 0.5, y: 0.2 };
    await ctx.step('Anchored note: placed, and it keeps its spot after a pan, a zoom and a timeframe change', async () => {
      await pickTool('Anchored note');
      await click(await at(ANCHORED));
      await type('pinned to the pane');
      const d = await last('anchoredNote');
      check('stored with pane fractions in 0..1', !!d && d.anchors[0].time > 0 && d.anchors[0].time < 1 && d.anchors[0].price > 0 && d.anchors[0].price < 1, JSON.stringify(d?.anchors));
      if (!narrow) {
        const b = await box();
        const spot = { x: b.x + b.width * d.anchors[0].time, y: b.y + b.height * d.anchors[0].price - 20 };
        const y = b.y + b.height * 0.9;
        await page.mouse.move(b.x + b.width * 0.6, y);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width * 0.3, y, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        check('its pin still answers at its anchor after a pan', (await cursorAt(spot)) === 'pointer');
        check('its stored anchor never changed', JSON.stringify((await last('anchoredNote')).anchors) === JSON.stringify(d.anchors));
        await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.8);
        await page.mouse.wheel(0, -600);
        await page.waitForTimeout(400);
        check('and after a zoom', (await cursorAt(spot)) === 'pointer');
        check('its stored anchor is unchanged after the zoom', JSON.stringify((await last('anchoredNote')).anchors) === JSON.stringify(d.anchors));
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('and after a timeframe change', (await cursorAt(spot)) === 'pointer');
        check('its stored anchor is unchanged after the timeframe change', JSON.stringify((await last('anchoredNote')).anchors) === JSON.stringify(d.anchors));
        await ctx.screenshot('timeframe');
      }
      await ctx.screenshot('anchored');
    });

    await ctx.step('Callout: placed by press-drag-release', async () => {
      await pickTool('Callout');
      const a = await at({ x: 0.1, y: 0.45 });
      const t = await at({ x: 0.3, y: 0.62 });
      if (narrow) {
        await page.touchscreen.tap(a.x, a.y);
        await page.touchscreen.tap(t.x, t.y);
      } else {
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(t.x, t.y, { steps: 8 });
        await page.mouse.up();
      }
      await type('breakout level');
      const c = await last('callout');
      check('two different anchors stored', !!c && c.anchors.length === 2 && (c.anchors[0].time !== c.anchors[1].time || c.anchors[0].price !== c.anchors[1].price), JSON.stringify(c?.anchors));
      check('with its text', c.text === 'breakout level');
      await ctx.screenshot('callout');
    });

    await ctx.step('Callout: placed by two clicks', async () => {
      await pickTool('Callout');
      const a = await at({ x: 0.45, y: 0.4 });
      const t = await at({ x: 0.6, y: 0.5 });
      await click(a);
      await click(t);
      await type('second callout');
      const all = (await stored()).filter((d) => d.tool === 'callout');
      check('two callouts stored', all.length === 2 && all[1].text === 'second callout', all.map((d) => d.text).join(','));
    });

    if (!narrow) {
      await ctx.step('Callout: the box handle moves the box and keeps the target; Bold on the Text tab', async () => {
        const before = await last('callout');
        const a = await at({ x: 0.45, y: 0.4 });
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(a.x + 40, a.y - 30, { steps: 8 });
        await page.mouse.up();
        const after = await last('callout');
        check('the box moved', after.anchors[0].time !== before.anchors[0].time || after.anchors[0].price !== before.anchors[0].price);
        check('the target stayed', JSON.stringify(after.anchors[1]) === JSON.stringify(before.anchors[1]));
        await openSettings(a.x + 60, a.y - 20);
        await dialog.getByRole('tab', { name: 'Text', exact: true }).click();
        await dialog.getByLabel('Bold').check();
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('bold stored', (await last('callout')).style?.bold === true);
        await ctx.screenshot('callout-moved');
      });
    }

    const COMMENT = { x: 0.15, y: 0.78 };
    await ctx.step('Comment: a long wrapping text, edited by double-click (double-tap on a phone)', async () => {
      await pickTool('Comment');
      const tip = await at(COMMENT);
      await click(tip);
      await type(LONG);
      check('the comment is stored', (await last('comment')).text === LONG);
      await ctx.screenshot('comment');
      const inBubble = { x: tip.x + 20, y: tip.y - 40 };
      if (narrow) {
        await page.touchscreen.tap(inBubble.x, inBubble.y);
        await page.waitForTimeout(100);
        await page.touchscreen.tap(inBubble.x, inBubble.y);
      } else await page.mouse.dblclick(inBubble.x, inBubble.y);
      await input.waitFor({ state: 'visible' });
      await page.keyboard.type(' (edited)');
      await page.keyboard.press('Control+Enter');
      await input.waitFor({ state: 'hidden' });
      check('the edit is stored', (await last('comment')).text === `${LONG} (edited)`);
      await ctx.screenshot('comment-edited');
    });

    if (!narrow) {
      await ctx.step('undo and redo the edit', async () => {
        await page.keyboard.press('Control+z');
        check('undo restores the text', (await last('comment')).text === LONG);
        await page.keyboard.press('Control+Shift+z');
        check('redo applies it again', (await last('comment')).text === `${LONG} (edited)`);
      });
    }

    await ctx.step('reload keeps all four tools', async () => {
      const before = JSON.stringify(await stored());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      const list = await stored();
      check('storage is unchanged', JSON.stringify(list) === before);
      const tools = list.map((d) => d.tool);
      check('all four tools are there', ['note', 'anchoredNote', 'callout', 'comment'].every((t) => tools.includes(t)), tools.join(','));
      await ctx.screenshot('reloaded');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
