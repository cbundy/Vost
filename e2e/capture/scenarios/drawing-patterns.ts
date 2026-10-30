import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };
type Pt = { x: number; y: number };

/** The six pattern tools: label, stored id, whether it has ratios and where (canvas fractions) each point is placed, clear of the others (two rows). */
const TOOLS = [
  { label: 'XABCD pattern', id: 'xabcdPattern', how: 'clicks', ratios: true, at: [{ x: 0.03, y: 0.44 }, { x: 0.09, y: 0.26 }, { x: 0.15, y: 0.4 }, { x: 0.21, y: 0.28 }, { x: 0.27, y: 0.44 }] },
  { label: 'Cypher pattern', id: 'cypherPattern', how: 'drag then click', ratios: true, at: [{ x: 0.35, y: 0.46 }, { x: 0.42, y: 0.28 }, { x: 0.47, y: 0.4 }, { x: 0.53, y: 0.24 }, { x: 0.6, y: 0.38 }] },
  { label: 'ABCD pattern', id: 'abcdPattern', how: 'clicks', ratios: true, at: [{ x: 0.7, y: 0.44 }, { x: 0.78, y: 0.28 }, { x: 0.86, y: 0.4 }, { x: 0.94, y: 0.24 }] },
  { label: 'Head and shoulders', id: 'headAndShoulders', how: 'clicks', ratios: false, at: [{ x: 0.03, y: 0.8 }, { x: 0.08, y: 0.64 }, { x: 0.13, y: 0.72 }, { x: 0.19, y: 0.54 }, { x: 0.25, y: 0.72 }, { x: 0.3, y: 0.64 }, { x: 0.35, y: 0.8 }] },
  { label: 'Triangle pattern', id: 'trianglePattern', how: 'clicks', ratios: false, at: [{ x: 0.42, y: 0.54 }, { x: 0.46, y: 0.8 }, { x: 0.52, y: 0.62 }, { x: 0.56, y: 0.74 }] },
  { label: 'Three drives', id: 'threeDrives', how: 'clicks', ratios: true, at: [{ x: 0.68, y: 0.8 }, { x: 0.73, y: 0.7 }, { x: 0.77, y: 0.74 }, { x: 0.82, y: 0.62 }, { x: 0.86, y: 0.66 }, { x: 0.91, y: 0.54 }, { x: 0.95, y: 0.58 }] },
] as const;
type ToolSpec = (typeof TOOLS)[number];

const GROUP = 'Patterns';

export const drawingPatterns: Scenario = {
  name: 'drawing-patterns',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'The chart pattern tools (XABCD, Cypher, ABCD, Head and shoulders, Triangle pattern, Three drives): place each point by point with a live preview (clicks, drag then click, or taps) and Escape to cancel, select with axis labels, drag a handle and the body, restyle (width, plus the ratio switch or the fill), undo and redo, reload and a timeframe change',
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
        for (const p of pts.slice(2)) {
          await page.mouse.move(p.x, p.y, { steps: 8 });
          await page.mouse.click(p.x, p.y);
        }
      }
    };
    /** A pixel on a drawing's body, clear of its handles: the middle of its first leg. */
    const body = async (t: ToolSpec, shift: Pt): Promise<Pt> => {
      const [a, b] = (await Promise.all(t.at.slice(0, 2).map(at))).map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }));
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (!narrow) {
      await ctx.step('Escape cancels an XABCD in flight; the preview shows the placed points', async () => {
        await pickTool('XABCD pattern');
        const [x, a, b, c] = await Promise.all(TOOLS[0].at.map(at));
        for (const p of [x, a, b]) {
          await page.mouse.move(p.x, p.y, { steps: 6 });
          await page.mouse.click(p.x, p.y);
        }
        await page.mouse.move(c.x, c.y, { steps: 8 });
        await ctx.screenshot('preview-xabcdPattern');
        await page.keyboard.press('Escape');
        await page.mouse.click(c.x, c.y);
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

    await ctx.step('all six together', async () => {
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
        await ctx.step(`${t.label}: select, move, drag a handle, restyle, undo and redo`, async () => {
          await page.keyboard.press('Escape');
          const grab = await body(t, { x: 0, y: 0 });
          await page.mouse.click(grab.x, grab.y);
          await page.waitForTimeout(300);
          await ctx.screenshot(`selected-${t.id}`);
          const before = await one(t.id);
          await drag(grab, { x: grab.x - 20, y: grab.y });
          const moved = await one(t.id);
          check(`${t.label} moved by its body`, moved.anchors.every((a, k) => a.time !== before.anchors[k].time));
          const first = await at(t.at[0]);
          const h = { x: first.x - 20, y: first.y };
          await drag(h, { x: h.x, y: h.y + 18 });
          const after = await one(t.id);
          check(`${t.label} point moved alone by its handle`, after.anchors[0].price !== moved.anchors[0].price && after.anchors.slice(1).every((a, k) => a.price === moved.anchors[k + 1].price && a.time === moved.anchors[k + 1].time), JSON.stringify([moved.anchors, after.anchors]));
          const target = await body(t, { x: -20, y: 0 });
          await page.mouse.move(target.x, target.y);
          await page.mouse.dblclick(target.x, target.y);
          await dialog.waitFor({ state: 'visible' });
          check(`${t.label} settings are titled for the tool`, (await dialog.getByRole('heading').textContent()) === `${t.label} settings`);
          await dialog.getByLabel('Line width', { exact: true }).fill('3');
          if (t.ratios) {
            await dialog.getByRole('tab', { name: 'Text' }).click();
            await dialog.getByLabel('Show ratios', { exact: true }).uncheck();
          } else if (t.id === 'trianglePattern') {
            await dialog.getByLabel('Background', { exact: true }).uncheck();
          } else {
            await dialog.getByLabel('Fill opacity', { exact: true }).fill('0.5');
          }
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          const styled = (await one(t.id)).style;
          check(`${t.label} restyled`, styled?.width === 3 && (t.ratios ? styled?.showRatios === false : t.id === 'trianglePattern' ? styled?.background === false : styled?.fillOpacity === 0.5), JSON.stringify(styled));
          await ctx.screenshot(`styled-${t.id}`);
          await page.keyboard.press('Control+z');
          check(`${t.label} undo reverts the restyle`, (await one(t.id)).style?.width !== 3);
          await page.keyboard.press('Control+Shift+z');
          check(`${t.label} redo restores the restyle`, (await one(t.id)).style?.width === 3);
        });
      }
    }

    await ctx.step('reload and a timeframe change keep every pattern', async () => {
      const before = await stored();
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('six drawings after reload', (await stored()).length === 6);
      await ctx.screenshot('reloaded');
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('unchanged by the timeframe change', JSON.stringify(await stored()) === JSON.stringify(before));
      await ctx.screenshot('timeframe');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
