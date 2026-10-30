import { generateDemoCandles } from '../../../client/src/lib/providers/demo.ts';
import { timeToLogical } from '../../../client/src/lib/drawingGeometry.ts';
import { ghostFeedBars } from '../../../client/src/lib/geometry/ghostFeed.ts';
import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };

const GROUP = 'Forecasting and measurers';
const FAMILY = 'Forecasting and measurers';

export const drawingBars: Scenario = {
  name: 'drawing-bars',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Bars pattern and Ghost feed: a bars pattern by two clicks and by a press-drag-release with the preview, Mirrored, Flipped, a display mode change and a move of the copy; a ghost feed placed point by point and ended by double-click; each selected, resized by a handle and restyled; then a reload and a timeframe change, with the ghost feed bars worked out from the stored anchors compared before and after the reload; at 390 px both are placed by taps',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    const narrow = ctx.viewport === 'narrow';
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as Stored[];
    };
    const mine = async (tool?: string) => (await stored()).filter((d) => (tool ? d.tool === tool : d.tool === 'barsPattern' || d.tool === 'ghostFeed'));
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x, y: b.y + (b.height - 28) * f.y };
    };
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const dialog = page.getByRole('dialog');
    const pickTool = async (label: string) => {
      if (narrow) {
        await menuBtn.tap();
        const btn = menu.getByRole('button', { name: label, exact: true });
        if (!(await btn.isVisible())) await menu.getByRole('button', { name: GROUP, exact: true }).tap();
        await btn.tap();
        return;
      }
      await rail.getByRole('button', { name: `Open ${FAMILY} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    const tap = async (p: { x: number; y: number }) => (narrow ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
    const lastYear = async () => {
      await page.getByRole('button', { name: '1Y', exact: true }).click();
      await page.waitForTimeout(500);
    };
    const ghostBars = (anchors: Stored['anchors']) => {
      const bars = generateDemoCandles({ bars: 5000, timeframe: '1d', seed: 1337 });
      const times = bars.map((b) => b.time);
      return JSON.stringify(ghostFeedBars(anchors, (t) => timeToLogical(times, t), { avgHeight: 2, variance: 50 }));
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await lastYear();

    const s1 = await at({ x: 0.25, y: 0.55 });
    const s2 = await at({ x: 0.4, y: 0.55 });
    await ctx.step('Bars pattern: two clicks place it and the copy follows the run', async () => {
      await pickTool('Bars pattern');
      await tap(s1);
      if (!narrow) {
        await page.mouse.move(s2.x, s2.y, { steps: 6 });
        await ctx.screenshot('bars-preview');
      }
      await tap(s2);
      const list = await mine('barsPattern');
      check('one bars pattern with three anchors', list.length === 1 && list[0].anchors.length === 3, JSON.stringify(list));
      const [a, b, c] = list[0].anchors;
      check('the copy starts after the later source anchor', c.time > Math.max(a.time, b.time), `${a.time} ${b.time} ${c.time}`);
      await ctx.screenshot('bars-placed');
    });

    if (!narrow) {
      await ctx.step('Bars pattern: a press-drag-release places a second one', async () => {
        await pickTool('Bars pattern');
        const d1 = await at({ x: 0.1, y: 0.25 });
        const d2 = await at({ x: 0.2, y: 0.25 });
        await page.mouse.move(d1.x, d1.y);
        await page.mouse.down();
        await page.mouse.move(d2.x, d2.y, { steps: 8 });
        await ctx.screenshot('bars-drag-preview');
        await page.mouse.up();
        check('two bars patterns are stored', (await mine('barsPattern')).length === 2);
      });

      await ctx.step('select, move the copy by its handle, restyle (Mirrored, Flipped, display mode)', async () => {
        await page.mouse.click(s1.x, s1.y);
        await ctx.screenshot('bars-selected');
        const before = (await mine('barsPattern'))[0];
        const c = await at({ x: 0.55, y: 0.55 });
        // The copy starts one bar after the run's end: grab its handle and drag it.
        await page.mouse.move(s2.x + 6, s2.y);
        await page.mouse.down();
        await page.mouse.move(c.x, c.y - 60, { steps: 8 });
        await page.mouse.up();
        const after = (await mine('barsPattern'))[0];
        check('a handle drag changed the stored anchors', JSON.stringify(before.anchors) !== JSON.stringify(after.anchors));
        await ctx.screenshot('bars-moved');
        await page.mouse.dblclick(s1.x, s1.y);
        await dialog.waitFor();
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Bars pattern settings');
        for (const label of ['Colour', 'Opacity', 'Display mode', 'Mirrored', 'Flipped']) {
          check(`bars pattern offers ${label}`, (await dialog.getByText(label, { exact: true }).count()) > 0);
        }
        await ctx.screenshot('bars-settings');
        await dialog.getByLabel('Mirrored').check();
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('Mirrored is stored', (await mine('barsPattern'))[0].style?.mirrored === true);
        await ctx.screenshot('bars-mirrored');
        await page.mouse.dblclick(s1.x, s1.y);
        await dialog.waitFor();
        await dialog.getByLabel('Flipped').check();
        await dialog.getByLabel('Display mode').selectOption('oc');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const st = (await mine('barsPattern'))[0].style;
        check('Flipped and the display mode are stored', st?.flipped === true && st?.mode === 'oc', JSON.stringify(st));
        await ctx.screenshot('bars-flipped');
      });
    }

    const g = [await at({ x: 0.62, y: 0.7 }), await at({ x: 0.72, y: 0.4 }), await at({ x: 0.82, y: 0.5 }), await at({ x: 0.92, y: 0.25 })];
    await ctx.step('Ghost feed: point by point, ended by a double-click', async () => {
      await pickTool('Ghost feed');
      await tap(g[0]);
      await tap(g[1]);
      if (!narrow) {
        await page.mouse.move(g[2].x, g[2].y, { steps: 5 });
        await ctx.screenshot('ghost-preview');
      }
      await tap(g[2]);
      if (narrow) await page.keyboard.press('Enter');
      else await page.mouse.dblclick(g[3].x, g[3].y);
      const list = await mine('ghostFeed');
      check('one ghost feed with at least three anchors', list.length === 1 && list[0].anchors.length >= 3, JSON.stringify(list));
      await ctx.screenshot('ghost-placed');
    });

    if (!narrow) {
      await ctx.step('Ghost feed: select, resize by a handle, restyle', async () => {
        await page.keyboard.press('Escape');
        await page.mouse.click((g[0].x + g[1].x) / 2, (g[0].y + g[1].y) / 2);
        await ctx.screenshot('ghost-selected');
        const before = (await mine('ghostFeed'))[0];
        await page.mouse.move(g[1].x, g[1].y);
        await page.mouse.down();
        await page.mouse.move(g[1].x, g[1].y - 50, { steps: 6 });
        await page.mouse.up();
        const after = (await mine('ghostFeed'))[0];
        check('one anchor moved, the others stayed', after.anchors.length === before.anchors.length && after.anchors.filter((a, i) => JSON.stringify(a) !== JSON.stringify(before.anchors[i])).length === 1);
        await ctx.screenshot('ghost-resized');
        await page.mouse.dblclick((g[0].x + g[1].x) / 2, (g[0].y + g[1].y) / 2 - 25);
        await dialog.waitFor();
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Ghost feed settings');
        for (const label of ['Up colour', 'Down colour', 'Border colour', 'Opacity', 'Average height (ticks)', 'Variance (%)']) {
          check(`ghost feed offers ${label}`, (await dialog.getByText(label, { exact: true }).count()) > 0);
        }
        await ctx.screenshot('ghost-settings');
        await dialog.getByLabel('Variance (%)').fill('100');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('the variance is stored', (await mine('ghostFeed'))[0].style?.variance === 100);
        await page.keyboard.press('Escape');
        await ctx.screenshot('restyled');
      });
    }

    await ctx.step('reload and a timeframe change keep the drawings and draw the same bars', async () => {
      await page.keyboard.press('Escape');
      const before = await mine();
      const bars = ghostBars((await mine('ghostFeed'))[0].anchors);
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(800);
      await lastYear();
      const after = await mine();
      check('storage is unchanged after a reload', JSON.stringify(after) === JSON.stringify(before));
      check('the ghost feed bars worked out from the stored anchors are identical after the reload', ghostBars((await mine('ghostFeed'))[0].anchors) === bars);
      await ctx.screenshot('reloaded');
      if (!narrow) {
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('and after a timeframe change', JSON.stringify(await mine()) === JSON.stringify(before));
        await ctx.screenshot('timeframe');
      }
    });

    check('no console error', consoleErrors.length === 0, consoleErrors.join(' | '));
    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
