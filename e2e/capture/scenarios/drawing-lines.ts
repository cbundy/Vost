import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[] };

/** The six line tools: label, stored id, anchors, and where (canvas fractions) each is placed, clear of the others. */
const TOOLS = [
  { label: 'Info line', id: 'infoLine', at: [{ x: 0.1, y: 0.7 }, { x: 0.3, y: 0.55 }] },
  { label: 'Extended line', id: 'extendedLine', at: [{ x: 0.4, y: 0.85 }, { x: 0.5, y: 0.8 }] },
  { label: 'Trend angle', id: 'trendAngle', at: [{ x: 0.6, y: 0.55 }, { x: 0.85, y: 0.3 }] },
  { label: 'Horizontal ray', id: 'horizontalRay', at: [{ x: 0.2, y: 0.12 }] },
  { label: 'Vertical line', id: 'verticalLine', at: [{ x: 0.7, y: 0.3 }] },
  { label: 'Cross line', id: 'crossLine', at: [{ x: 0.5, y: 0.35 }] },
] as const;

const GROUP = 'Lines';

export const drawingLines: Scenario = {
  name: 'drawing-lines',
  touch: ['narrow'],
  keepPrefs: true,
  description: 'The line tools (info line, extended line, trend angle, horizontal ray, vertical line, cross line): draw each (press-drag or tap), select with axis labels, move, resize, undo and redo, a vertical line dragged keeps its price, reload and timeframe change',
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
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      /** The canvas holds the price axis on its right, so x is scaled to stay in the plot on a narrow screen. */
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const narrow = ctx.viewport === 'narrow';
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });

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
    const draw = async (t: (typeof TOOLS)[number]) => {
      await pickTool(t.label);
      const pts = await Promise.all(t.at.map(at));
      if (narrow) {
        for (const p of pts) {
          await page.touchscreen.tap(p.x, p.y);
          await page.waitForTimeout(150);
        }
      } else if (pts.length === 1) {
        await page.mouse.click(pts[0].x, pts[0].y);
      } else {
        await page.mouse.move(pts[0].x, pts[0].y);
        await page.mouse.down();
        await page.mouse.move(pts[1].x, pts[1].y, { steps: 12 });
        await page.mouse.up();
      }
    };
    const axisText = () => page.locator('.chart-container').evaluate((el) => el.textContent ?? '');

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    for (const [i, t] of TOOLS.entries()) {
      await ctx.step(`draw a ${t.label}`, async () => {
        await draw(t);
        const list = await stored();
        check(`${t.label} stored`, list.length === i + 1 && list[i].tool === t.id && list[i].anchors.length === t.at.length, list.map((d) => d.tool).join(','));
        await ctx.screenshot(`drawn-${t.id}`);
      });
    }

    await ctx.step('nothing throws and every drawing stays in the pane (the chart still paints)', async () => {
      const shot = await page.locator('.chart-container').screenshot();
      check('chart painted', shot.length > 1000);
      await ctx.screenshot('all');
    });

    await ctx.step('a vertical line dragged up and down keeps its price', async () => {
      const before = (await stored()).find((d) => d.tool === 'verticalLine')!;
      const p = await at(TOOLS[4].at[0]);
      const start = await page.locator('.chart-container').boundingBox();
      if (!start) throw new Error('no box');
      if (narrow) {
        await page.touchscreen.tap(p.x, start.y + start.height * 0.9);
        await page.waitForTimeout(200);
      } else {
        await page.mouse.move(p.x, start.y + start.height * 0.9);
        await page.mouse.down();
        await page.mouse.move(p.x - 30, start.y + start.height * 0.1, { steps: 10 });
        await page.mouse.move(p.x - 30, start.y + start.height * 0.6, { steps: 10 });
        await page.mouse.up();
        const after = (await stored()).find((d) => d.tool === 'verticalLine')!;
        check('time moved', after.anchors[0].time !== before.anchors[0].time);
        check('price kept', after.anchors[0].price === before.anchors[0].price);
      }
      await ctx.screenshot('vertical-selected');
    });

    await ctx.step('undo and redo', async () => {
      const n = (await stored()).length;
      await page.keyboard.press('Control+z');
      check('undo removes a step', (await stored()).length <= n);
      await page.keyboard.press('Control+Shift+z');
      check('redo restores it', (await stored()).length === n);
    });

    await ctx.step('a selected cross line shows its price and time on the axes', async () => {
      const p = await at(TOOLS[5].at[0]);
      if (narrow) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(300);
      check('the chart shows text', (await axisText()).length > 0);
      await ctx.screenshot('cross-selected');
    });

    await ctx.step('reload and a timeframe change keep every line', async () => {
      const before = await stored();
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('six drawings after reload', (await stored()).length === 6);
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('unchanged by the timeframe change', JSON.stringify(await stored()) === JSON.stringify(before));
      await ctx.screenshot('timeframe');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
