import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };
type Pt = { x: number; y: number };

/** The five three-point Fibonacci tools: label, stored id, where (canvas fractions) each is placed, clear of the others, how it is drawn with a mouse, and which two anchors the body is grabbed between. */
const TOOLS = [
  { label: 'Trend-based fib extension', id: 'fibExtension', how: 'clicks', body: [1, 2], at: [{ x: 0.03, y: 0.85 }, { x: 0.1, y: 0.55 }, { x: 0.16, y: 0.7 }] },
  { label: 'Fib channel', id: 'fibChannel', how: 'drag then click', body: [1, 2], at: [{ x: 0.2, y: 0.85 }, { x: 0.35, y: 0.75 }, { x: 0.3, y: 0.55 }] },
  { label: 'Fib wedge', id: 'fibWedge', how: 'clicks', body: [0, 1], at: [{ x: 0.45, y: 0.85 }, { x: 0.56, y: 0.8 }, { x: 0.46, y: 0.6 }] },
  { label: 'Pitchfan', id: 'pitchfan', how: 'drag then click', body: [1, 2], at: [{ x: 0.4, y: 0.3 }, { x: 0.62, y: 0.12 }, { x: 0.62, y: 0.4 }] },
  { label: 'Trend-based fib time', id: 'fibTrendTime', how: 'clicks', body: [1, 2], at: [{ x: 0.7, y: 0.7 }, { x: 0.76, y: 0.4 }, { x: 0.8, y: 0.55 }] },
] as const;
type ToolSpec = (typeof TOOLS)[number];

const GROUP = 'Fibonacci and Gann';

export const drawingFibTrend: Scenario = {
  name: 'drawing-fib-trend',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'The three-point Fibonacci tools (Trend-based fib extension, Fib channel, Fib wedge, Pitchfan, Trend-based fib time): draw each (three clicks, press-drag then click, or taps) with a live preview and Escape to cancel, select with axis labels, move, resize by a handle, restyle in the settings dialog (a level switched off or on, a Text tab toggle), undo and redo, reload and a timeframe change',
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
    const at = async (f: { x: number; y: number }): Promise<Pt> => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
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
        await page.mouse.move(pts[2].x, pts[2].y, { steps: 8 });
        await ctx.screenshot(`placing-${t.id}`);
        await page.mouse.click(pts[2].x, pts[2].y);
      }
    };
    /** The middle of the line between two anchors (B-C, or A-B for the wedge) of a tool moved by `shift`: always on the drawing, clear of its handles. */
    const body = async (t: ToolSpec, shift: Pt): Promise<Pt> => {
      const pts = await Promise.all(t.at.map(at));
      const [p, q] = [pts[t.body[0]], pts[t.body[1]]];
      return { x: (p.x + q.x) / 2 + shift.x, y: (p.y + q.y) / 2 + shift.y };
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (!narrow) {
      await ctx.step('Escape cancels a three-point drawing in flight', async () => {
        await pickTool('Trend-based fib extension');
        const [a, b, c] = await Promise.all(TOOLS[0].at.map(at));
        await page.mouse.click(a.x, a.y);
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await page.mouse.click(b.x, b.y);
        await page.mouse.move(c.x, c.y, { steps: 8 });
        await ctx.screenshot('preview-fibExtension');
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
        check(`${t.label} stored`, list.length === i + 1 && list[i].tool === t.id && list[i].anchors.length === 3, list.map((d) => `${d.tool}:${d.anchors.length}`).join(','));
        await ctx.screenshot(`drawn-${t.id}`);
      });
    }

    await ctx.step('all five stay in the pane (the chart still paints)', async () => {
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
          await drag(grab, { x: grab.x - 20, y: grab.y });
          const moved = await one(t.id);
          check(`${t.label} moved by its body`, moved.anchors[0].time !== before.anchors[0].time, JSON.stringify([before.anchors, moved.anchors]));
          const first = await at(t.at[0]);
          const h = { x: first.x - 20, y: first.y };
          await drag(h, { x: h.x, y: h.y + 18 });
          const after = await one(t.id);
          check(`${t.label} resized by a handle`, after.anchors[0].price !== moved.anchors[0].price && after.anchors[1].price === moved.anchors[1].price, JSON.stringify([moved.anchors, after.anchors]));
          const target = await body(t, { x: -20, y: 0 });
          await page.mouse.move(target.x, target.y);
          await page.mouse.dblclick(target.x, target.y);
          await dialog.waitFor({ state: 'visible' });
          check(`${t.label} settings are titled for the tool`, (await dialog.getByRole('heading').textContent()) === `${t.label} settings`);
          const level = dialog.getByLabel('Level 0.618 on', { exact: true });
          if (t.id === 'pitchfan') {
            await level.check();
            await dialog.getByLabel('Level 0.618 colour', { exact: true }).fill('#ff00ff');
            await dialog.getByLabel('Background', { exact: true }).uncheck();
          } else {
            await level.uncheck();
          }
          if (t.id === 'fibExtension') {
            await dialog.getByLabel('Extend right', { exact: true }).check();
            await dialog.getByRole('tab', { name: 'Text' }).click();
            await dialog.getByLabel('Show percent', { exact: true }).check();
          }
          if (t.id === 'fibChannel') {
            await dialog.getByRole('tab', { name: 'Text' }).click();
            await dialog.getByLabel('Show levels', { exact: true }).uncheck();
          }
          if (t.id === 'fibWedge' || t.id === 'fibTrendTime') {
            await dialog.getByRole('tab', { name: 'Text' }).click();
            await dialog.getByLabel('Show labels', { exact: true }).uncheck();
          }
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          const styled = (await one(t.id)).style as { levels?: { value: number; on: boolean; color: string }[]; background?: boolean; extendRight?: boolean; showPercent?: boolean; showLevels?: boolean; showLabels?: boolean };
          const lv = styled?.levels?.find((l) => l.value === 0.618);
          check(`${t.label} level 0.618 ${t.id === 'pitchfan' ? 'on and recoloured' : 'switched off'}`, t.id === 'pitchfan' ? lv?.on === true && lv.color.toLowerCase() === '#ff00ff' : lv?.on === false, JSON.stringify(styled));
          if (t.id === 'pitchfan') check('Background off stored', styled.background === false);
          if (t.id === 'fibExtension') check('Extend right and Show percent stored', styled.extendRight === true && styled.showPercent === true);
          if (t.id === 'fibChannel') check('Show levels off stored', styled.showLevels === false);
          if (t.id === 'fibWedge' || t.id === 'fibTrendTime') check('Show labels off stored', styled.showLabels === false);
          await ctx.screenshot(`styled-${t.id}`);
          await page.keyboard.press('Control+z');
          check(`${t.label} undo reverts the restyle`, !(await one(t.id)).style?.levels);
          await page.keyboard.press('Control+Shift+z');
          check(`${t.label} redo restores the restyle`, !!(await one(t.id)).style?.levels);
        });
      }
    }

    await ctx.step('reload and a timeframe change keep every three-point Fibonacci drawing', async () => {
      const before = await stored();
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('five drawings after reload', (await stored()).length === 5);
      await ctx.screenshot('reloaded');
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('unchanged by the timeframe change', JSON.stringify(await stored()) === JSON.stringify(before));
      await ctx.screenshot('timeframe');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
