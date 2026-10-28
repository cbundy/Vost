import type { Scenario } from '../scenario.ts';

/** Reads the saved drawings of the demo source (waits past the 400 ms debounce first). */
const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v1');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

/** The trend line's anchors as fractions of the chart canvas: near the right end, so a timeframe change keeps it in view. */
const TA = { x: 0.915, y: 0.55 };
const TB = { x: 0.94, y: 0.25 };

export const drawings: Scenario = {
  name: 'drawings',
  description: 'Drawing tools: rail, draw a trend line and a horizontal line, select, drag a handle and the body, delete, undo, reload, timeframe change, pan after drawing',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as { id: string; tool: string; anchors: { time: number; price: number }[] }[];
    };
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (ctx.viewport === 'narrow') {
      await ctx.step('the rail is hidden and the chart takes the full width', async () => {
        check('rail hidden', !(await rail.isVisible()));
        const b = await box();
        check('chart starts at the left edge', Math.round(b.x) === 0, `x=${b.x}`);
        await ctx.screenshot('narrow');
      });
      await ctx.writeText('checks', checks.join('\n') + '\n');
      return;
    }

    await ctx.step('the rail sits left of the chart canvas', async () => {
      const r = await rail.boundingBox();
      const b = await box();
      if (!r) throw new Error('no rail box');
      check('rail left of canvas', r.x + r.width <= b.x + 0.5, `rail right=${r.x + r.width} canvas left=${b.x}`);
      check('rail about 40px wide', Math.abs(r.width - 40) <= 2, `${r.width}`);
      for (const name of ['Cursor', 'Trend line', 'Horizontal line']) {
        const btn = rail.getByRole('button', { name, exact: true });
        check(`${name} button has title and aria-pressed`, (await btn.getAttribute('title')) === name && (await btn.getAttribute('aria-pressed')) !== null);
      }
      check('Cursor pressed at start', (await rail.getByRole('button', { name: 'Cursor' }).getAttribute('aria-pressed')) === 'true');
    });
    await ctx.screenshot('rail');

    const at = async (fx: number, fy: number) => {
      const b = await box();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    };

    await ctx.step('draw a trend line', async () => {
      await rail.getByRole('button', { name: 'Trend line' }).click();
      check('Trend line pressed', (await rail.getByRole('button', { name: 'Trend line' }).getAttribute('aria-pressed')) === 'true');
      const a = await at(TA.x, TA.y);
      const b = await at(TB.x, TB.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 15 });
      await page.mouse.up();
      check('one drawing saved', (await stored()).length === 1);
      check('tool back to Cursor', (await rail.getByRole('button', { name: 'Cursor' }).getAttribute('aria-pressed')) === 'true');
    });

    await ctx.step('draw a horizontal line', async () => {
      await rail.getByRole('button', { name: 'Horizontal line' }).click();
      const p = await at(0.5, 0.8);
      await page.mouse.click(p.x, p.y);
      const list = await stored();
      check('two drawings saved', list.length === 2, list.map((d) => d.tool).join(','));
    });
    await ctx.screenshot('drawn');

    await ctx.step('click the trend line to select it', async () => {
      const empty = await at(0.2, 0.2);
      await page.mouse.click(empty.x, empty.y); // empty chart: nothing selected
      const mid = await at((TA.x + TB.x) / 2, (TA.y + TB.y) / 2);
      await page.mouse.move(mid.x, mid.y);
      const cursor = await page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
      check('pointer cursor over a drawing', cursor === 'pointer', cursor);
      await page.mouse.click(mid.x, mid.y);
      await page.waitForTimeout(200);
    });
    await ctx.screenshot('selected');

    await ctx.step('drag a handle', async () => {
      const before = (await stored()).find((d) => d.tool === 'trendLine')!;
      const h = await at(TB.x, TB.y);
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.move(h.x - 40, h.y - 40, { steps: 10 });
      await page.mouse.up();
      const after = (await stored()).find((d) => d.tool === 'trendLine')!;
      check('second anchor moved', after.anchors[1].time !== before.anchors[1].time && after.anchors[1].price !== before.anchors[1].price);
      check('first anchor kept', JSON.stringify(after.anchors[0]) === JSON.stringify(before.anchors[0]));
    });

    await ctx.step('drag the body', async () => {
      const before = (await stored()).find((d) => d.tool === 'trendLine')!;
      // the midpoint of the (moved) line: between its two anchors
      const bx = await box();
      const ax = bx.x + bx.width * TA.x;
      const ay = bx.y + bx.height * TA.y;
      const ex = bx.x + bx.width * TB.x - 40;
      const ey = bx.y + bx.height * TB.y - 40;
      const mx = (ax + ex) / 2;
      const my = (ay + ey) / 2;
      await page.mouse.move(mx, my);
      await page.mouse.down();
      await page.mouse.move(mx - 30, my + 50, { steps: 10 });
      await page.mouse.up();
      const after = (await stored()).find((d) => d.tool === 'trendLine')!;
      const dt = after.anchors.map((a, i) => a.time - before.anchors[i].time);
      check('both anchors moved by the same time', dt[0] !== 0 && Math.abs(dt[0] - dt[1]) < 1, `${dt.join(',')}`);
    });
    await ctx.screenshot('moved');

    await ctx.step('delete, then undo', async () => {
      await page.keyboard.press('Delete');
      check('one drawing left', (await stored()).length === 1);
      await ctx.screenshot('deleted');
      await page.keyboard.press('Control+z');
      check('undo brings it back', (await stored()).length === 2);
      await page.keyboard.press('Control+Shift+z');
      check('redo removes it again', (await stored()).length === 1);
      await page.keyboard.press('Control+z');
      check('undo again', (await stored()).length === 2);
    });
    await ctx.screenshot('undone');

    await ctx.step('reload keeps both', async () => {
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('two drawings in storage after reload', (await stored()).length === 2);
    });
    await ctx.screenshot('reloaded');

    await ctx.step('a timeframe change keeps time and price', async () => {
      const before = await stored();
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('drawings unchanged by the change', JSON.stringify(await stored()) === JSON.stringify(before));
    });
    await ctx.screenshot('timeframe');

    await ctx.step('pan still works with drawings present', async () => {
      const shot = () => page.locator('.chart-container').screenshot();
      const first = await shot();
      const y = (await at(0.5, 0.15)).y;
      const b = await box();
      await page.mouse.move(b.x + b.width * 0.8, y);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.4, y, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      check('chart panned', !first.equals(await shot()));
    });
    await ctx.screenshot('panned');

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
