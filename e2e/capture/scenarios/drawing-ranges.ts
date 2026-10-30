import { generateDemoCandles } from '../../../client/src/lib/providers/demo.ts';
import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };

const GROUP = 'Forecasting and measurers';
const FAMILY = 'Forecasting and measurers';
const IDS = ['priceRange', 'dateRange', 'datePriceRange'];

export const drawingRanges: Scenario = {
  name: 'drawing-ranges',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Price range, Date range and Date and price range: each is placed by press-drag-release (preview captured mid-drag) or two clicks, selected with handles and axis labels, resized by a handle, restyled (colour, fill off, extend on) through its settings dialog, its figures worked out again on the same bars and written out for comparison with the labels, then a reload and a timeframe change; at 390 px each is placed by taps',
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
    const mine = async () => (await stored()).filter((d) => IDS.includes(d.tool));
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

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await lastYear();

    const specs = [
      { id: 'priceRange', label: 'Price range', a: { x: 0.15, y: 0.75 }, b: { x: 0.35, y: 0.4 } },
      { id: 'dateRange', label: 'Date range', a: { x: 0.4, y: 0.35 }, b: { x: 0.58, y: 0.55 } },
      { id: 'datePriceRange', label: 'Date and price range', a: { x: 0.62, y: 0.3 }, b: { x: 0.8, y: 0.7 } },
    ];
    const pts: Record<string, { a: { x: number; y: number }; b: { x: number; y: number } }> = {};
    for (const s of specs) pts[s.id] = { a: await at(s.a), b: await at(s.b) };

    await ctx.step('each tool is placed', async () => {
      for (const s of specs) {
        const { a, b } = pts[s.id];
        await pickTool(s.label);
        if (!narrow) {
          // Press-drag-release first, undone, then the same tool placed by two clicks.
          await page.mouse.move(a.x, a.y);
          await page.mouse.down();
          await page.mouse.move(b.x, b.y, { steps: 8 });
          await ctx.screenshot(`${s.id}-preview`);
          await page.mouse.up();
          const dragged = (await mine()).filter((d) => d.tool === s.id);
          check(`${s.id} placed by press-drag-release, stored with two anchors`, dragged.length === 1 && dragged[0].anchors.length === 2, JSON.stringify(dragged));
          await page.keyboard.press('Control+z');
          check(`${s.id} dragged copy undone`, (await mine()).filter((d) => d.tool === s.id).length === 0);
          await pickTool(s.label);
        }
        await tap(a);
        await tap(b);
        const list = (await mine()).filter((d) => d.tool === s.id);
        check(`${s.id} placed by ${narrow ? 'taps' : 'two clicks'}, stored with two anchors`, list.length === 1 && list[0].anchors.length === 2, JSON.stringify(list));
      }
      await ctx.screenshot('placed');
    });

    if (!narrow) {
      await ctx.step('select shows handles and axis labels; a handle resizes', async () => {
        const { a, b } = pts.priceRange;
        await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
        await ctx.screenshot('price-range-selected');
        const before = (await mine()).find((d) => d.tool === 'priceRange')!;
        await page.mouse.move(b.x, b.y);
        await page.mouse.down();
        await page.mouse.move(b.x + 30, b.y - 40, { steps: 6 });
        await page.mouse.up();
        const after = (await mine()).find((d) => d.tool === 'priceRange')!;
        check('the first anchor stayed, the second moved', JSON.stringify(after.anchors[0]) === JSON.stringify(before.anchors[0]) && JSON.stringify(after.anchors[1]) !== JSON.stringify(before.anchors[1]));
        await ctx.screenshot('price-range-resized');
        const d = pts.datePriceRange;
        await page.mouse.click((d.a.x + d.b.x) / 2, (d.a.y + d.b.y) / 2);
        await ctx.screenshot('date-price-range-selected');
      });

      await ctx.step('settings dialog and a restyle', async () => {
        for (const [id, title, extend] of [
          ['dateRange', 'Date range', ['Extend top', 'Extend bottom']],
          ['priceRange', 'Price range', ['Extend left', 'Extend right']],
        ] as const) {
          const { a, b } = pts[id];
          await page.mouse.dblclick((a.x + b.x) / 2, (a.y + b.y) / 2);
          await dialog.waitFor();
          check(`${id} dialog titled for the tool`, (await dialog.getByRole('heading').textContent()) === `${title} settings`);
          if (id === 'dateRange') {
            for (const label of ['Line colour', 'Line width', 'Background', 'Background opacity', 'Text colour', 'Font size', 'Label background', ...extend]) {
              check(`offers ${label}`, (await dialog.getByText(label, { exact: true }).count()) > 0);
            }
            await ctx.screenshot('date-range-settings');
          }
          await dialog.getByLabel('Line colour', { exact: true }).fill('#ff00ff');
          await dialog.getByLabel('Line width', { exact: true }).fill('3');
          await dialog.getByLabel('Background', { exact: true }).uncheck();
          for (const label of extend) await dialog.getByLabel(label, { exact: true }).check();
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          const style = (await mine()).find((d) => d.tool === id)!.style ?? {};
          check(`${id} colour, width, Background off and both extends stored`, style.color === '#ff00ff' && style.width === 3 && style.fill === false && style[id === 'dateRange' ? 'extendTop' : 'extendLeft'] === true && style[id === 'dateRange' ? 'extendBottom' : 'extendRight'] === true, JSON.stringify(style));
          await page.keyboard.press('Escape');
        }
        await ctx.screenshot('restyled');
      });

      await ctx.step('the figures worked out again on the same bars', async () => {
        const bars = generateDemoCandles({ bars: 5000, timeframe: '1d', seed: 1337 });
        for (const d of await mine()) {
          const [x, y] = d.anchors;
          const lo = Math.min(x.time, y.time);
          const hi = Math.max(x.time, y.time);
          const inside = bars.filter((c) => c.time >= lo && c.time <= hi);
          const volume = inside.reduce((n, c) => n + (Number.isFinite(c.volume) && (c.volume as number) > 0 ? (c.volume as number) : 0), 0);
          const change = y.price - x.price;
          check(`${d.tool} figures are finite and the bars inside are counted`, Number.isFinite(change) && Number.isFinite(volume) && inside.length > 0, `change ${change}, volume ${volume}, bars ${inside.length}`);
          checks.push(`info ${d.tool}: change ${change.toFixed(2)}, pct ${x.price === 0 ? '-' : ((change / x.price) * 100).toFixed(2)}, ticks ${Math.round(change / 0.01)}, seconds ${hi - lo}, bars inside ${inside.length}, volume ${volume}`);
        }
      });
    } else {
      await ctx.step('all three are stored after taps', async () => {
        check('three drawings stored', (await mine()).length === 3);
        await ctx.screenshot('tapped');
      });
    }

    await ctx.step('reload and a timeframe change keep the drawings', async () => {
      await page.keyboard.press('Escape');
      const before = JSON.stringify(await mine());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(800);
      await lastYear();
      check('storage is unchanged after a reload', JSON.stringify(await mine()) === before);
      await ctx.screenshot('reloaded');
      if (!narrow) {
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('and after a timeframe change', JSON.stringify(await mine()) === before);
        await ctx.screenshot('timeframe');
      }
    });

    check('no console error', consoleErrors.length === 0, consoleErrors.join(' | '));
    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
