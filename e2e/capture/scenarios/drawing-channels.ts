import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };
type Pt = { x: number; y: number };

/** The four channel tools: label, stored id, where (canvas fractions) each is placed, clear of the others, and how it is drawn with a mouse. */
const TOOLS = [
  { label: 'Parallel channel', id: 'parallelChannel', how: 'clicks', at: [{ x: 0.08, y: 0.78 }, { x: 0.3, y: 0.62 }, { x: 0.2, y: 0.9 }] },
  { label: 'Regression trend', id: 'regressionTrend', how: 'drag', at: [{ x: 0.38, y: 0.7 }, { x: 0.62, y: 0.5 }] },
  { label: 'Flat top/bottom', id: 'flatTopBottom', how: 'drag then click', at: [{ x: 0.68, y: 0.3 }, { x: 0.92, y: 0.18 }, { x: 0.8, y: 0.5 }] },
  { label: 'Disjoint channel', id: 'disjointChannel', how: 'clicks', at: [{ x: 0.06, y: 0.12 }, { x: 0.3, y: 0.08 }, { x: 0.12, y: 0.35 }] },
] as const;
type ToolSpec = (typeof TOOLS)[number];

const GROUP = 'Lines';

export const drawingChannels: Scenario = {
  name: 'drawing-channels',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'The channel tools (parallel channel, regression trend, flat top/bottom, disjoint channel): draw each (three clicks, press-drag then click, or taps) with a live preview and Escape to cancel, select with axis labels, move, resize by a handle, restyle in the settings dialog (the regression source and deviation), undo and redo, reload and a timeframe change',
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
    const one = async (id: string) => (await stored()).find((d) => d.tool === id)!;
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (f: { x: number; y: number }): Promise<Pt> => {
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
    const draw = async (t: ToolSpec) => {
      await pickTool(t.label);
      const pts = await Promise.all(t.at.map(at));
      if (narrow) {
        for (const p of pts) {
          await page.touchscreen.tap(p.x, p.y);
          await page.waitForTimeout(150);
        }
      } else if (t.how === 'clicks') {
        for (const p of pts) {
          await page.mouse.move(p.x, p.y, { steps: 6 });
          await page.mouse.click(p.x, p.y);
        }
      } else {
        await page.mouse.move(pts[0].x, pts[0].y);
        await page.mouse.down();
        await page.mouse.move(pts[1].x, pts[1].y, { steps: 12 });
        await page.mouse.up();
        if (pts[2]) {
          await page.mouse.move(pts[2].x, pts[2].y, { steps: 8 });
          if (t.id === 'flatTopBottom') await ctx.screenshot('placing-flatTopBottom');
          await page.mouse.click(pts[2].x, pts[2].y);
        }
      }
    };
    /** Pixel rows (client y) of the blue lines painted in a column of the chart: the regression's upper, base and lower line. */
    const lineRows = async (x: number): Promise<number[]> =>
      page.evaluate((cx) => {
        const rows: number[] = [];
        for (const c of Array.from(document.querySelectorAll('.chart-container canvas'))) {
          const r = c.getBoundingClientRect();
          const g = c.getContext('2d');
          if (!g) continue;
          const px = Math.round(((cx - r.left) * c.width) / r.width);
          if (px < 0 || px >= c.width) continue;
          const data = g.getImageData(px, 0, 1, c.height).data;
          let run: number[] = [];
          const flush = () => {
            if (run.length) rows.push(r.top + ((run.reduce((a, b) => a + b, 0) / run.length) * r.height) / c.height);
            run = [];
          };
          for (let y = 0; y < c.height; y++) {
            const [rr, , bb, aa] = [data[y * 4], data[y * 4 + 1], data[y * 4 + 2], data[y * 4 + 3]];
            if (aa > 200 && bb > 120 && bb - rr > 70) run.push(y);
            else flush();
          }
          flush();
        }
        return rows.sort((a, b) => a - b);
      }, x);
    /** A pixel on a drawing's body, clear of its handles and of the other tools. */
    const body = async (t: ToolSpec, shift: Pt, resized = 0): Promise<Pt> => {
      const pts = (await Promise.all(t.at.map(at))).map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }));
      if (t.id === 'regressionTrend') {
        const x = (pts[0].x + pts[1].x) / 2;
        const rows = await lineRows(x);
        if (rows.length < 3) throw new Error(`regression lines not found at x ${x}: ${rows.join(',')}`);
        return { x, y: rows[Math.floor(rows.length / 2)] };
      }
      const f = resized ? 0.75 : 0.5;
      const a = { x: pts[0].x, y: pts[0].y + resized };
      return { x: a.x + (pts[1].x - a.x) * f, y: a.y + (pts[1].y - a.y) * f };
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (!narrow) {
      await ctx.step('Escape cancels a three-point drawing in flight', async () => {
        await pickTool('Parallel channel');
        const [a, b, c] = await Promise.all(TOOLS[0].at.map(at));
        await page.mouse.click(a.x, a.y);
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await page.mouse.click(b.x, b.y);
        await page.mouse.move(c.x, c.y, { steps: 8 });
        await ctx.screenshot('preview-parallelChannel');
        await page.keyboard.press('Escape');
        await page.mouse.click(c.x, c.y);
        await page.mouse.click(a.x, a.y);
        check('nothing stored after Escape', (await stored()).length === 0);
      });
    }

    for (const [i, t] of TOOLS.entries()) {
      await ctx.step(`draw a ${t.label}${narrow ? ' by taps' : ` (${t.how})`}`, async () => {
        await draw(t);
        const list = await stored();
        check(`${t.label} stored`, list.length === i + 1 && list[i].tool === t.id && list[i].anchors.length === t.at.length, list.map((d) => `${d.tool}:${d.anchors.length}`).join(','));
        await ctx.screenshot(`drawn-${t.id}`);
      });
    }

    await ctx.step('all four stay in the pane (the chart still paints)', async () => {
      const shot = await page.locator('.chart-container').screenshot();
      check('chart painted', shot.length > 1000);
      await ctx.screenshot('all');
    });

    if (!narrow) {
      const dialog = page.getByRole('dialog');
      const drag = async (from: Pt, to: Pt) => {
        await page.mouse.move(from.x, from.y);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 12 });
        await page.mouse.up();
      };

      for (const t of TOOLS) {
        await ctx.step(`${t.label}: select, move, resize, restyle in settings, undo and redo`, async () => {
          await page.keyboard.press('Escape');
          const grab = await body(t, { x: 0, y: 0 });
          await page.mouse.click(grab.x, grab.y);
          await page.waitForTimeout(300);
          await ctx.screenshot(`selected-${t.id}`);
          const before = await one(t.id);
          await drag(grab, { x: grab.x - 40, y: grab.y });
          const moved = await one(t.id);
          check(`${t.label} moved by its body`, moved.anchors[0].time !== before.anchors[0].time, JSON.stringify([before.anchors, moved.anchors]));
          const shift = { x: -40, y: 0 };
          let resized = 0;
          if (t.id !== 'regressionTrend') {
            const first = await at(t.at[0]);
            const h = { x: first.x + shift.x, y: first.y };
            await drag(h, { x: h.x, y: h.y + 18 });
            resized = 18;
            const after = await one(t.id);
            check(`${t.label} resized by a handle`, after.anchors[0].price !== moved.anchors[0].price && after.anchors[1].time === moved.anchors[1].time && after.anchors[1].price === moved.anchors[1].price, JSON.stringify([moved.anchors, after.anchors]));
            if (t.id === 'parallelChannel') {
              check('parallel channel keeps its third point at the same time', after.anchors[2].time === moved.anchors[2].time && after.anchors[2].price !== moved.anchors[2].price);
              const c = await at(t.at[2]);
              const edge = { x: c.x + shift.x, y: c.y + 18 };
              void edge;
            }
          }
          const target = await body(t, shift, resized);
          await page.mouse.move(target.x, target.y);
          await page.mouse.dblclick(target.x, target.y);
          await dialog.waitFor({ state: 'visible' });
          check(`${t.label} settings are titled for the tool`, (await dialog.getByRole('heading').textContent()) === `${t.label} settings`);
          await dialog.getByLabel('Line width', { exact: true }).fill('3');
          if (t.id === 'regressionTrend') {
            await dialog.getByLabel('Source', { exact: true }).selectOption('hlc3');
            await dialog.getByLabel('Deviation', { exact: true }).fill('3');
          }
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          const styled = (await one(t.id)).style;
          check(`${t.label} restyled`, styled?.width === 3 && (t.id !== 'regressionTrend' || (styled?.source === 'hlc3' && styled?.deviation === 3)), JSON.stringify(styled));
          await ctx.screenshot(`styled-${t.id}`);
          await page.keyboard.press('Control+z');
          check(`${t.label} undo reverts the restyle`, (await one(t.id)).style?.width !== 3);
          await page.keyboard.press('Control+Shift+z');
          check(`${t.label} redo restores the restyle`, (await one(t.id)).style?.width === 3);
        });
      }
    }

    await ctx.step('reload and a timeframe change keep every channel', async () => {
      const before = await stored();
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('four drawings after reload', (await stored()).length === 4);
      await ctx.screenshot('reloaded');
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('unchanged by the timeframe change', JSON.stringify(await stored()) === JSON.stringify(before));
      await ctx.screenshot('timeframe');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
