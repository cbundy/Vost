import { generateDemoCandles } from '../../../client/src/lib/providers/demo.ts';
import { forecastVerdict } from '../../../client/src/lib/geometry/forecast.ts';
import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };

const GROUP = 'Forecasting and measurers';
const FAMILY = 'Forecasting and measurers';

export const drawingForecast: Scenario = {
  name: 'drawing-forecast',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Forecast and Projection: the forecast follows a press-drag-release, the projection takes three clicks, each shows handles and axis labels when selected and is resized by a handle, the settings dialogs and a restyle, three seeded forecasts (a past target reached shows Success, a past target missed shows Failure, a future target shows no verdict) checked against the maths on the same bars, then a reload and a timeframe change; at 390 px both are placed by taps',
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
    const mine = async () => (await stored()).filter((d) => d.tool === 'forecast' || d.tool === 'projection');
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

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    const lastYear = async () => {
      await page.getByRole('button', { name: '1Y', exact: true }).click();
      await page.waitForTimeout(500);
    };
    await lastYear();

    const f1 = await at({ x: 0.2, y: 0.7 });
    const f2 = await at({ x: 0.5, y: 0.3 });
    await ctx.step('Forecast: press, drag, release places it', async () => {
      await pickTool('Forecast');
      if (!narrow) {
        await page.mouse.move(f1.x, f1.y);
        await page.mouse.down();
        await page.mouse.move(f2.x, f2.y, { steps: 8 });
        await ctx.screenshot('forecast-preview');
        await page.mouse.up();
      } else {
        await tap(f1);
        await tap(f2);
      }
      const list = await mine();
      check('one forecast with two anchors', list.length === 1 && list[0].tool === 'forecast' && list[0].anchors.length === 2, JSON.stringify(list));
      const [s, t] = list[0].anchors;
      check('the target is later and higher than the source', t.time > s.time && t.price > s.price, `${s.time}/${s.price} -> ${t.time}/${t.price}`);
      await ctx.screenshot('forecast-placed');
    });

    const p1 = await at({ x: 0.15, y: 0.25 });
    const p2 = await at({ x: 0.4, y: 0.25 });
    const p3 = await at({ x: 0.3, y: 0.05 });
    await ctx.step('Projection: three clicks place it', async () => {
      await pickTool('Projection');
      await tap(p1);
      await tap(p2);
      if (!narrow) {
        await page.mouse.move(p3.x, p3.y, { steps: 4 });
        await ctx.screenshot('projection-preview');
      }
      await tap(p3);
      const list = (await mine()).filter((d) => d.tool === 'projection');
      check('one projection with three anchors', list.length === 1 && list[0].anchors.length === 3, JSON.stringify(list));
      await ctx.screenshot('projection-placed');
    });

    if (!narrow) {
      await ctx.step('select shows handles and axis labels; a handle resizes the forecast', async () => {
        const mid = { x: (f1.x + f2.x) / 2, y: (f1.y + f2.y) / 2 };
        await page.mouse.click(mid.x, mid.y);
        await ctx.screenshot('forecast-selected');
        const before = (await mine()).find((d) => d.tool === 'forecast')!;
        await page.mouse.move(f2.x, f2.y);
        await page.mouse.down();
        await page.mouse.move(f2.x + 40, f2.y + 50, { steps: 6 });
        await page.mouse.up();
        const after = (await mine()).find((d) => d.tool === 'forecast')!;
        check('the source stayed, the target moved', after.anchors[0].time === before.anchors[0].time && after.anchors[0].price === before.anchors[0].price && (after.anchors[1].time !== before.anchors[1].time || after.anchors[1].price !== before.anchors[1].price), JSON.stringify([before.anchors, after.anchors]));
        await ctx.screenshot('forecast-resized');
        await page.mouse.click((p1.x + p2.x) / 2, p1.y);
        await ctx.screenshot('projection-selected');
        const pb = (await mine()).find((d) => d.tool === 'projection')!;
        await page.mouse.move(p3.x, p3.y);
        await page.mouse.down();
        await page.mouse.move(p3.x + 60, p3.y + 30, { steps: 6 });
        await page.mouse.up();
        const pa = (await mine()).find((d) => d.tool === 'projection')!;
        check('the projection\'s third point moved, the leg stayed', JSON.stringify(pa.anchors.slice(0, 2)) === JSON.stringify(pb.anchors.slice(0, 2)) && JSON.stringify(pa.anchors[2]) !== JSON.stringify(pb.anchors[2]));
        await ctx.screenshot('projection-resized');
      });

      await ctx.step('settings dialogs and a restyle', async () => {
        const mid = { x: (f1.x + (f2.x + 40)) / 2, y: (f1.y + (f2.y + 50)) / 2 };
        await page.mouse.dblclick(mid.x, mid.y);
        await dialog.waitFor();
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Forecast settings');
        for (const label of ['Source colour', 'Target colour', 'Success colour', 'Failure colour', 'Line width', 'Text colour']) {
          check(`forecast offers ${label}`, (await dialog.getByText(label, { exact: true }).count()) > 0);
        }
        await ctx.screenshot('forecast-settings');
        await dialog.getByLabel('Line width').fill('3');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('the width is stored', (await mine()).find((d) => d.tool === 'forecast')!.style?.width === 3);
        await page.mouse.dblclick((p1.x + p2.x) / 2, p1.y);
        await dialog.waitFor();
        check('projection titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Projection settings');
        for (const label of ['Line colour', 'Line width', 'Fill colour', 'Fill opacity', 'Text colour']) {
          check(`projection offers ${label}`, (await dialog.getByText(label, { exact: true }).count()) > 0);
        }
        await ctx.screenshot('projection-settings');
        await dialog.getByLabel('Line width').fill('2');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.mouse.click(f1.x, (await box()).y + 40);
        await ctx.screenshot('restyled');
      });

      await ctx.step('a reached target shows Success, a missed one Failure, a future one no verdict', async () => {
        const bars = generateDemoCandles({ bars: 5000, timeframe: '1d', seed: 1337 });
        const n = bars.length;
        const span = 40;
        const notes: string[] = [];
        const seeded: Stored[] = [];
        const make = (id: string, from: number, kind: 'success' | 'failure' | 'future') => {
          const i = n - from;
          const entry = bars[i].close;
          const win = bars.slice(i + 1, i + span + 1);
          const high = Math.max(...win.map((c) => c.high));
          const target = kind === 'success' ? entry + 0.5 * Math.max(high - entry, entry * 0.01) : kind === 'failure' ? high * 1.05 : entry * 1.05;
          const time = kind === 'future' ? bars[n - 1].time + 25 * 86400 : bars[i + span].time;
          const verdict = forecastVerdict({ time: bars[i].time, price: entry }, { time, price: target }, bars);
          const want = kind === 'future' ? 'pending' : kind;
          check(`${id}: the bars decide it as designed`, verdict === want, `${verdict} vs ${want}`);
          notes.push(`info ${id}: source ${entry.toFixed(2)} at bar ${i}, target ${target.toFixed(2)}, highest high in range ${high.toFixed(2)}, verdict ${verdict}`);
          seeded.push({ id, tool: 'forecast', anchors: [{ time: bars[i].time, price: entry }, { time, price: target }] });
        };
        make('seed-success', 120, 'success');
        make('seed-failure', 90, 'failure');
        make('seed-future', 30, 'future');
        const kept = await stored();
        await page.evaluate((all) => localStorage.setItem('vost.drawings.v2', JSON.stringify({ version: 2, sources: { 'demo:DEMO': all } })), [...kept, ...seeded]);
        await page.reload();
        await ctx.waitForChart();
        await lastYear();
        checks.push(...notes);
        await ctx.screenshot('verdicts');
      });
    } else {
      await ctx.step('a second forecast by taps', async () => {
        await pickTool('Forecast');
        await tap(await at({ x: 0.3, y: 0.85 }));
        await tap(await at({ x: 0.65, y: 0.6 }));
        { const list = await mine(); check('two forecasts and a projection are stored', list.length === 3, JSON.stringify(list.map((d) => d.tool))); }
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
