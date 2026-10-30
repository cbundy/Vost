import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };
type Pt = { x: number; y: number };

/** The three volume-based tools: label, stored id and where (canvas fractions) each is placed. */
const TOOLS = [
  { label: 'Anchored VWAP', id: 'anchoredVwap', how: 'clicks', at: [{ x: 0.2, y: 0.5 }] },
  { label: 'Fixed range volume profile', id: 'fixedRangeVolumeProfile', how: 'drag', at: [{ x: 0.35, y: 0.3 }, { x: 0.6, y: 0.3 }] },
  { label: 'Anchored volume profile', id: 'anchoredVolumeProfile', how: 'clicks', at: [{ x: 0.7, y: 0.7 }] },
] as const;
type ToolSpec = (typeof TOOLS)[number];

const GROUP = 'Forecasting and measurers';

export const drawingVolume: Scenario = {
  name: 'drawing-volume',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'The volume-based tools (Anchored VWAP, Fixed range volume profile, Anchored volume profile): place each by a click, press-drag-release or taps with a live preview, select with axis labels, drag a handle, restyle (bands, rows, value area), undo and redo, reload, a timeframe change and zoom out',
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
      } else if (pts.length === 1) {
        await page.mouse.click(pts[0].x, pts[0].y);
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
      }
    };
    /** A pixel the chart reports as on a drawing (its pointer cursor), found by moving down a column; null when there is none. */
    const probe = async (x: number, from: number, to: number): Promise<Pt | null> => {
      for (let y = from; y <= to; y += 3) {
        await page.mouse.move(x, y);
        const over = await page.evaluate(([px, py]) => {
          let el = document.elementFromPoint(px, py) as HTMLElement | null;
          while (el && el.style.cursor === '') el = el.parentElement;
          return el?.style.cursor ?? '';
        }, [x, y] as const);
        if (over === 'pointer') return { x, y };
      }
      return null;
    };
    /** A pixel on a drawing's body: the VWAP line a few bars after its anchor, or the profile's left rows. */
    const body = async (t: ToolSpec): Promise<Pt> => {
      const b = await box();
      const a = await at(t.at[0]);
      const x = t.id === 'anchoredVwap' ? a.x + 60 : a.x + 6;
      const p = await probe(x, b.y + 10, b.y + b.height - 40);
      if (!p) throw new Error(`no ${t.id} under the pointer at x ${x}`);
      return p;
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (!narrow) {
      await ctx.step('the Volume-based section is in the Forecasting and measurers flyout', async () => {
        await rail.getByRole('button', { name: `Open ${GROUP} tools`, exact: true }).click();
        check('section heading', await page.getByText('Volume-based', { exact: true }).isVisible());
        await ctx.screenshot('flyout');
        await page.keyboard.press('Escape');
      });
      await ctx.step('the live preview follows the pointer while a profile is placed', async () => {
        await pickTool('Fixed range volume profile');
        const [a, b] = await Promise.all(TOOLS[1].at.map(at));
        await page.mouse.move(a.x, a.y, { steps: 6 });
        await page.mouse.click(a.x, a.y);
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await ctx.screenshot('preview-fixedRangeVolumeProfile');
        await page.keyboard.press('Escape');
        await page.mouse.click(b.x, b.y);
        check('nothing stored after Escape', (await stored()).length === 0);
      });
      await ctx.step('the Fixed range volume profile is also placed by two clicks', async () => {
        await pickTool('Fixed range volume profile');
        const [a, b] = await Promise.all(TOOLS[1].at.map(at));
        await page.mouse.move(a.x, a.y, { steps: 6 });
        await page.mouse.click(a.x, a.y);
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await page.mouse.click(b.x, b.y);
        const list = await stored();
        check('click-click placement stored', list.length === 1 && list[0].tool === 'fixedRangeVolumeProfile' && list[0].anchors.length === 2, list.map((d) => `${d.tool}:${d.anchors.length}`).join(','));
        await ctx.screenshot('clicked-fixedRangeVolumeProfile');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+z');
        check('undo removes the click-placed profile', (await stored()).length === 0);
      });
    }

    for (const [i, t] of TOOLS.entries()) {
      await ctx.step(`draw ${t.label}${narrow ? ' by taps' : ` (${t.how})`}`, async () => {
        await draw(t);
        const list = await stored();
        check(`${t.label} stored`, list.length === i + 1 && list[i].tool === t.id && list[i].anchors.length === t.at.length, list.map((d) => `${d.tool}:${d.anchors.length}`).join(','));
        await ctx.screenshot(`drawn-${t.id}`);
      });
    }

    if (!narrow) {
      const dialog = page.getByRole('dialog');
      const drag = async (from: Pt, to: Pt) => {
        await page.mouse.move(from.x, from.y);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 12 });
        await page.mouse.up();
      };
      const settings: Record<string, () => Promise<void>> = {
        anchoredVwap: async () => {
          await dialog.getByLabel('Band 2', { exact: true }).check();
          await dialog.getByLabel('Band 1 multiplier').fill('1.5');
        },
        fixedRangeVolumeProfile: async () => {
          await dialog.getByLabel('Row size').fill('12');
          await dialog.getByLabel('Value area volume (%)').fill('60');
        },
        anchoredVolumeProfile: async () => {
          await dialog.getByLabel('Placement').selectOption('right');
          await dialog.getByLabel('Row size').fill('16');
        },
      };
      const keys: Record<string, [string, unknown]> = {
        anchoredVwap: ['showBand2', true],
        fixedRangeVolumeProfile: ['rowSize', 12],
        anchoredVolumeProfile: ['rowSize', 16],
      };

      for (const t of TOOLS) {
        await ctx.step(`${t.label}: select, move, drag a handle, restyle, undo and redo`, async () => {
          await page.keyboard.press('Escape');
          const grab = await body(t);
          await page.mouse.click(grab.x, grab.y);
          await page.waitForTimeout(300);
          await ctx.screenshot(`selected-${t.id}`);
          if (t.id === 'fixedRangeVolumeProfile') {
            const left = await at(t.at[0]);
            const bx = await box();
            /** The handle sits halfway up the range box, which on the demo data is a fixed 55% down the chart. */
            const h = { x: left.x, y: bx.y + bx.height * 0.548 };
            const pre = await one(t.id);
            await drag(h, { x: h.x - 20, y: h.y + 25 });
            const post = await one(t.id);
            check(`${t.label} handle drag changed the anchor's time`, post.anchors[0].time !== pre.anchors[0].time, `${pre.anchors[0].time} -> ${post.anchors[0].time}`);
            check(`${t.label} handle drag kept the anchor's price`, post.anchors[0].price === pre.anchors[0].price);
            check(`${t.label} handle drag left the other anchor`, post.anchors[1].time === pre.anchors[1].time && post.anchors[1].price === pre.anchors[1].price);
            await ctx.screenshot(`handle-${t.id}`);
          }
          const before = await one(t.id);
          await drag(grab, { x: grab.x - 20, y: grab.y });
          const moved = await one(t.id);
          check(`${t.label} moved by its body`, moved.anchors.every((a, k) => a.time !== before.anchors[k].time));
          check(`${t.label} kept its prices`, moved.anchors.every((a, k) => a.price === before.anchors[k].price));
          const grab2 = await body(t);
          await page.mouse.dblclick(grab2.x, grab2.y);
          await dialog.waitFor({ state: 'visible' });
          check(`${t.label} settings are titled for the tool`, (await dialog.getByRole('heading').textContent()) === `${t.label} settings`);
          await settings[t.id]();
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          const [key, val] = keys[t.id];
          const styled = (await one(t.id)).style;
          check(`${t.label} restyled`, styled?.[key] === val, JSON.stringify(styled));
          await ctx.screenshot(`styled-${t.id}`);
          await page.keyboard.press('Control+z');
          check(`${t.label} undo reverts the restyle`, (await one(t.id)).style?.[key] !== val);
          await page.keyboard.press('Control+Shift+z');
          check(`${t.label} redo restores the restyle`, (await one(t.id)).style?.[key] === val);
          await ctx.screenshot(`redone-${t.id}`);
        });
      }
    }

    await ctx.step('reload and a timeframe change keep every volume tool', async () => {
      const before = await stored();
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('three drawings after reload', (await stored()).length === 3);
      await ctx.screenshot('reloaded');
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('unchanged by the timeframe change', JSON.stringify(await stored()) === JSON.stringify(before));
      await ctx.screenshot('timeframe');
      const plot = await box();
      await page.mouse.move(plot.x + plot.width * 0.4, plot.y + plot.height * 0.5);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(800);
      await ctx.screenshot('zoomed-out');
      check('zoom keeps the drawings', (await stored()).length === 3);
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
