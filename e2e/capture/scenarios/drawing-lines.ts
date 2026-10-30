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
  description: 'The line tools (info line, extended line, trend angle, horizontal ray, vertical line, cross line): draw each (press-drag or tap), select with axis labels, move, resize, restyle in the settings dialog (with a Text tab for the labelled lines), undo and redo, a vertical line dragged keeps its price, reload and timeframe change',
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

    if (!narrow) {
      const dialog = page.getByRole('dialog');
      const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
        await page.mouse.move(from.x, from.y);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 12 });
        await page.mouse.up();
      };
      const one = async (id: string) => (await stored()).find((d) => d.tool === id)!;
      /** A pixel on the drawing's body, clear of its handles and of the other tools. */
      const body = async (t: (typeof TOOLS)[number], shift: { x: number; y: number }) => {
        const pts = (await Promise.all(t.at.map(at))).map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }));
        if (t.id === 'horizontalRay') return { x: pts[0].x + 60, y: pts[0].y };
        if (t.id === 'verticalLine') return { x: pts[0].x, y: (await box()).y + (await box()).height * 0.9 };
        if (t.id === 'crossLine') return { x: pts[0].x, y: (await box()).y + (await box()).height * 0.62 };
        return { x: pts[0].x + (pts[1].x - pts[0].x) * 0.75, y: pts[0].y + (pts[1].y - pts[0].y) * 0.75 };
      };

      for (const t of TOOLS) {
        await ctx.step(`${t.label}: resize, move, restyle in settings, undo and redo`, async () => {
          const shift = { x: 0, y: 0 };
          if (t.at.length === 2) {
            const first = await at(t.at[0]);
            const before = await one(t.id);
            await page.mouse.click((await body(t, shift)).x, (await body(t, shift)).y);
            await drag(first, { x: first.x, y: first.y + 18 });
            const after = await one(t.id);
            check(`${t.label} resized by its handle`, after.anchors[0].price !== before.anchors[0].price && after.anchors[1].time === before.anchors[1].time && after.anchors[1].price === before.anchors[1].price);
          }
          const beforeMove = await one(t.id);
          const grab = await body(t, { x: t.id === 'verticalLine' ? -30 : 0, y: t.at.length === 2 ? 4.5 : 0 });
          await page.keyboard.press('Escape');
          await page.mouse.click(grab.x, grab.y);
          await drag(grab, { x: grab.x - 40, y: grab.y });
          const moved = await one(t.id);
          check(`${t.label} moved by its body`, moved.anchors[0].time !== beforeMove.anchors[0].time, JSON.stringify([beforeMove.anchors, moved.anchors, grab]));
          const grab2 = { x: grab.x - 40, y: grab.y };
          await page.mouse.move(grab2.x, grab2.y);
          await page.mouse.dblclick(grab2.x, grab2.y);
          await dialog.waitFor({ state: 'visible' });
          check(`${t.label} settings are titled for the tool`, (await dialog.getByRole('heading').textContent()) === `${t.label} settings`);
          const labelled = t.id === 'infoLine' || t.id === 'trendAngle' || t.id === 'extendedLine';
          const tabs = (await dialog.getByRole('tab').allTextContents()).join(',');
          check(`${t.label} has a Text tab only when it can draw a label`, tabs.includes('Text') === labelled, tabs);
          await dialog.getByLabel('Width', { exact: true }).fill('3');
          if (labelled) {
            await dialog.getByRole('tab', { name: 'Text', exact: true }).click();
            await dialog.getByLabel('Text size', { exact: true }).fill('16');
          }
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          const styled = (await one(t.id)).style as Record<string, unknown> | undefined;
          check(`${t.label} restyled`, styled?.width === 3 && (!labelled || styled?.textSize === 16), JSON.stringify(styled));
          await ctx.screenshot(`styled-${t.id}`);
          await page.keyboard.press('Control+z');
          check(`${t.label} undo reverts the restyle`, ((await one(t.id)).style as Record<string, unknown> | undefined)?.width !== 3);
          await page.keyboard.press('Control+Shift+z');
          check(`${t.label} redo restores the restyle`, ((await one(t.id)).style as Record<string, unknown> | undefined)?.width === 3);
        });
      }

      await ctx.step('undo and redo a deleted drawing', async () => {
        const n = (await stored()).length;
        await page.keyboard.press('Delete');
        check('delete removes the selected drawing', (await stored()).length === n - 1);
        await page.keyboard.press('Control+z');
        check('undo brings it back', (await stored()).length === n);
        await page.keyboard.press('Control+Shift+z');
        check('redo removes it again', (await stored()).length === n - 1);
        await page.keyboard.press('Control+z');
        check('undo again brings it back', (await stored()).length === n);
      });
    }

    await ctx.step('a selected cross line shows its price and time on the axes', async () => {
      const p = await at(TOOLS[5].at[0]);
      if (narrow) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(300);
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
