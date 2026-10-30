import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };
type Pt = { x: number; y: number };

/** The four Gann tools: label, stored id, where (canvas fractions) each is placed, clear of the others, the level to turn off and the setting to change. */
const TOOLS = [
  { label: 'Gann box', id: 'gannBox', at: [{ x: 0.03, y: 0.9 }, { x: 0.2, y: 0.6 }], level: '0.382', text: 'Left labels' },
  { label: 'Gann square fixed', id: 'gannSquareFixed', at: [{ x: 0.3, y: 0.9 }, { x: 0.4, y: 0.62 }], level: '0.5', text: 'Show labels' },
  { label: 'Gann square', id: 'gannSquare', at: [{ x: 0.52, y: 0.5 }, { x: 0.68, y: 0.2 }], level: '0.5', text: 'Show labels' },
  { label: 'Gann fan', id: 'gannFan', at: [{ x: 0.74, y: 0.9 }, { x: 0.82, y: 0.7 }], level: '1', text: 'Show labels' },
] as const;
type ToolSpec = (typeof TOOLS)[number];

const GROUP = 'Fibonacci and Gann';

export const drawingGann: Scenario = {
  name: 'drawing-gann',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'The Gann tools (box, square fixed, square, fan): draw each with a live preview, select with handles, move, resize, restyle in the settings dialog (a level off, a Text tab label toggle), undo and redo, reload and a timeframe change',
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
      const [a, b] = await Promise.all(t.at.map(at));
      if (narrow) {
        for (const p of [a, b]) {
          await page.touchscreen.tap(p.x, p.y);
          await page.waitForTimeout(150);
        }
        return;
      }
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 12 });
      if (t.id === 'gannSquareFixed') await ctx.screenshot('placing-gannSquareFixed');
      await page.mouse.up();
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (!narrow) {
      await ctx.step('click-click placement shows a live preview, and Escape cancels', async () => {
        await pickTool('Gann square fixed');
        const [a, b] = await Promise.all(TOOLS[1].at.map(at));
        await page.mouse.click(a.x, a.y);
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await ctx.screenshot('preview-gannSquareFixed');
        await page.keyboard.press('Escape');
        await page.mouse.click(b.x, b.y);
        check('nothing stored after Escape', (await stored()).length === 0);
      });
    }

    for (const [i, t] of TOOLS.entries()) {
      await ctx.step(`draw a ${t.label}${narrow ? ' by taps' : ' (press-drag-release)'}`, async () => {
        await draw(t);
        const list = await stored();
        check(`${t.label} stored`, list.length === i + 1 && list[i].tool === t.id && list[i].anchors.length === 2, list.map((d) => `${d.tool}:${d.anchors.length}`).join(','));
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
          const [a, b0] = await Promise.all(t.at.map(at));
          /** The fixed square holds itself square, so its handle sits at the squared corner. */
          const side = Math.max(Math.abs(b0.x - a.x), Math.abs(b0.y - a.y));
          const b = t.id === 'gannSquareFixed' ? { x: a.x + (b0.x < a.x ? -side : side), y: a.y + (b0.y < a.y ? -side : side) } : b0;
          // The second handle is grabbed first to select the drawing and then dragged to resize.
          await page.mouse.click(b.x, b.y);
          await page.waitForTimeout(300);
          await ctx.screenshot(`selected-${t.id}`);
          const before = await one(t.id);
          await drag(b, { x: b.x, y: b.y + 18 });
          const resized = await one(t.id);
          check(`${t.label} resized by a handle`, (resized.anchors[1].price !== before.anchors[1].price || resized.anchors[1].time !== before.anchors[1].time) && resized.anchors[0].price === before.anchors[0].price, JSON.stringify([before.anchors, resized.anchors]));
          const first = { x: a.x, y: a.y };
          await drag(first, { x: first.x + 12, y: first.y });
          const moved = await one(t.id);
          // A box corner drag keeps the opposite corner as the first anchor (like the rectangle), so the box is compared by its two times.
          const times = (d: Stored) => d.anchors.map((x) => x.time).sort((p, q) => p - q);
          const kept = t.id === 'gannBox' ? times(moved).some((x) => times(resized).includes(x)) && JSON.stringify(times(moved)) !== JSON.stringify(times(resized)) : moved.anchors[0].time !== resized.anchors[0].time && moved.anchors[1].time === resized.anchors[1].time;
          check(`${t.label} first point moved`, kept, JSON.stringify([resized.anchors, moved.anchors]));
          await page.keyboard.press('Control+z');
          check(`${t.label} undo reverts the move`, JSON.stringify((await one(t.id)).anchors) === JSON.stringify(resized.anchors));
          await page.keyboard.press('Control+Shift+z');
          await page.mouse.dblclick(b.x, b.y + 18);
          await dialog.waitFor({ state: 'visible' });
          check(`${t.label} settings are titled for the tool`, (await dialog.getByRole('heading').textContent()) === `${t.label} settings`);
          if ('level' in t) await dialog.getByLabel(`Level ${t.level} on`).first().uncheck();
          if ('toggle' in t) await dialog.getByLabel(t.toggle, { exact: true }).check();
          if ('text' in t) {
            await dialog.getByRole('tab', { name: 'Text' }).click();
            await dialog.getByLabel(t.text, { exact: true }).uncheck();
          }
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          const styled = (await one(t.id)).style ?? {};
          check(`${t.label} restyled`, JSON.stringify(styled).length > 2, JSON.stringify(styled).slice(0, 200));
          await ctx.screenshot(`styled-${t.id}`);
          await page.keyboard.press('Control+z');
          check(`${t.label} undo reverts the restyle`, JSON.stringify((await one(t.id)).style ?? {}) !== JSON.stringify(styled));
          await page.keyboard.press('Control+Shift+z');
          check(`${t.label} redo restores the restyle`, JSON.stringify((await one(t.id)).style ?? {}) === JSON.stringify(styled));
        });
      }
    }

    await ctx.step('reload and a timeframe change keep every Gann drawing', async () => {
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
