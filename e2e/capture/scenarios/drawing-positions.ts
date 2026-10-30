import { generateDemoCandles } from '../../../client/src/lib/providers/demo.ts';
import { formatMoney, positionOutcome, positionStats, type PositionSide } from '../../../client/src/lib/geometry/position.ts';
import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };

const GROUP = 'Forecasting and measurers';
const FAMILY = 'Forecasting and measurers';

export const drawingPositions: Scenario = {
  name: 'drawing-positions',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Long position and Short position: the shape follows the pointer before the click, one click places entry, target and stop, select shows four handles and the stats, a target dragged across the entry stops one pixel from it, the Inputs tab (risk unit to amount) and Style change the label, a long whose target is hit and a short whose stop is hit show their dashed path and closed profit or loss (checked against the maths on the same bars), then a reload and a timeframe change; at 390 px a tap places a position and a reload keeps it',
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
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
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
    const positions = async () => (await stored()).filter((d) => d.tool === 'longPosition' || d.tool === 'shortPosition');

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    // The last year fills the chart: 5000 daily bars would squeeze a position into a few pixels.
    const lastYear = async () => {
      await page.getByRole('button', { name: '1Y', exact: true }).click();
      await page.waitForTimeout(500);
    };
    await lastYear();

    const where = await at({ x: 0.35, y: 0.5 });
    await ctx.step('Long position: the shape follows the pointer, one click places it', async () => {
      await pickTool('Long position');
      if (!narrow) {
        await page.mouse.move(where.x - 30, where.y - 20);
        await page.mouse.move(where.x, where.y, { steps: 4 });
        await ctx.screenshot('preview');
        check('nothing is stored before the click', (await positions()).length === 0);
      }
      await tap(where);
      const list = await positions();
      check('one long position with three anchors', list.length === 1 && list[0].tool === 'longPosition' && list[0].anchors.length === 3, JSON.stringify(list));
      const [e, t, s] = list[0].anchors;
      check('the target is above and the stop below the entry', t.price > e.price && s.price < e.price, `${e.price} ${t.price} ${s.price}`);
      check('target and stop share the end time, after the start', t.time === s.time && t.time > e.time, `${e.time} ${t.time} ${s.time}`);
      await ctx.screenshot('placed');
    });

    if (!narrow) {
      await ctx.step('select shows four handles and the stats; a target dragged across the entry stops at the entry', async () => {
        await page.mouse.click(where.x + 60, where.y - 15);
        await ctx.screenshot('selected');
        const before = (await positions())[0];
        const [e0, t0] = before.anchors;
        const b = await box();
        // The target handle: the left corner of the target zone, 12 % of the pane above the entry (the pane is the box less the time axis).
        const handle = { x: where.x, y: where.y - (b.height - 28) * 0.12 };
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(handle.x, where.y + 70, { steps: 8 });
        await ctx.screenshot('clamping');
        await page.mouse.up();
        const after = (await positions())[0];
        const [e1, t1] = after.anchors;
        check('the entry did not move', e1.price === e0.price && e1.time === e0.time);
        check('the target moved but stays above the entry', t1.price !== t0.price && t1.price > e1.price, `${t0.price} -> ${t1.price} (entry ${e1.price})`);
        check('and sits within a few pixels of it', t1.price - e1.price < (t0.price - e0.price) * 0.1, `${t1.price - e1.price} of ${t0.price - e0.price}`);
        await ctx.screenshot('clamped');
      });

      await ctx.step('Inputs: the risk unit to amount; Style: always show stats', async () => {
        await page.mouse.dblclick(where.x + 60, where.y + 15);
        await dialog.waitFor();
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Long position settings');
        const tabs = await dialog.getByRole('tab').allTextContents();
        check('the Inputs tab follows Style', tabs.join(',') === 'Style,Inputs,Coordinates,Visibility', tabs.join(','));
        await dialog.getByRole('tab', { name: 'Inputs', exact: true }).click();
        await ctx.screenshot('inputs');
        await dialog.getByLabel('Risk unit').selectOption('amount');
        await dialog.getByLabel('Risk', { exact: true }).fill('100');
        await dialog.getByLabel('Account size').fill('5000');
        await dialog.getByRole('tab', { name: 'Style', exact: true }).click();
        await dialog.getByLabel('Always show stats').check();
        await ctx.screenshot('style');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const s = (await positions())[0].style ?? {};
        check('the inputs and style are stored', s.riskUnit === 'amount' && s.risk === 100 && s.accountSize === 5000 && s.alwaysStats === true, JSON.stringify(s));
        await page.mouse.click(where.x + 400, where.y - 150);
        await ctx.screenshot('restyled');
      });

      await ctx.step('a long whose target is hit and a short whose stop is hit show the closed profit or loss', async () => {
        const bars = generateDemoCandles({ bars: 5000, timeframe: '1d', seed: 1337 });
        const n = bars.length;
        const span = 60;
        const seeded: Stored[] = [];
        const notes: string[] = [];
        const find = (side: PositionSide, from: number) => {
          for (let i = from; i > n - 300; i--) {
            const win = bars.slice(i + 1, i + span + 1);
            const entry = bars[i].close;
            const high = Math.max(...win.map((c) => c.high));
            const low = Math.min(...win.map((c) => c.low));
            if (side === 'long' && high - entry > 0.05 * entry && low > entry * 0.7) {
              return { i, entry, target: entry + 0.6 * (high - entry), stop: Math.min(low, entry) - 0.02 * entry };
            }
            if (side === 'short' && high - entry > 0.05 * entry && low > entry * 0.7) {
              return { i, entry, target: low - 0.02 * entry, stop: entry + 0.6 * (high - entry) };
            }
          }
          throw new Error(`no ${side} setup found in the demo bars`);
        };
        for (const [side, from, id] of [['long', n - span - 20, 'seed-long'], ['short', n - span - 110, 'seed-short']] as const) {
          const f = find(side, from);
          const end = bars[f.i + span].time;
          const style = { alwaysStats: true, riskUnit: 'percent', risk: 10, accountSize: 10000 };
          seeded.push({ id, tool: side === 'long' ? 'longPosition' : 'shortPosition', style, anchors: [{ time: bars[f.i].time, price: f.entry }, { time: end, price: f.target }, { time: end, price: f.stop }] });
          const prices = { entry: f.entry, target: f.target, stop: f.stop };
          const outcome = positionOutcome(side, prices, bars[f.i].time, end, bars);
          const stats = positionStats(prices, { accountSize: 10000, lotSize: 1, risk: 10, riskUnit: 'percent' });
          const pnl = outcome.result === 'target' ? stats.targetPnl : stats.stopPnl;
          check(`${side}: the bars decide it as designed`, outcome.result === (side === 'long' ? 'target' : 'stop'), JSON.stringify(outcome));
          notes.push(`${side}: entry ${f.entry.toFixed(2)} target ${f.target.toFixed(2)} stop ${f.stop.toFixed(2)}, risk ${formatMoney(stats.riskAmount)}, Qty ${stats.quantity}, R/R ${stats.riskReward}, closed at ${outcome.result}, Closed P&L ${formatMoney(pnl)}`);
        }
        const kept = await stored();
        await page.evaluate((all) => localStorage.setItem('vost.drawings.v2', JSON.stringify({ version: 2, sources: { 'demo:DEMO': all } })), [...kept, ...seeded]);
        await page.reload();
        await ctx.waitForChart();
        await lastYear();
        checks.push(...notes.map((x) => `info ${x}`));
        await ctx.screenshot('outcomes');
      });
    }

    await ctx.step('reload and a timeframe change keep the positions', async () => {
      await page.keyboard.press('Escape');
      const before = JSON.stringify(await stored());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(800);
      await lastYear();
      check('storage is unchanged after a reload', JSON.stringify(await stored()) === before);
      await ctx.screenshot('reloaded');
      if (!narrow) {
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('and after a timeframe change', JSON.stringify(await stored()) === before);
        await ctx.screenshot('timeframe');
      }
    });

    if (!narrow) {
      await ctx.step('Short position: placed by one click', async () => {
        await page.locator('select[title="Timeframe"]').selectOption('1d');
        await page.waitForTimeout(1000);
        const count = (await positions()).length;
        await pickTool('Short position');
        await page.mouse.click(where.x + 200, where.y - 40);
        const list = await positions();
        const s = list[list.length - 1];
        check('a short position with the target below and the stop above', list.length === count + 1 && s.tool === 'shortPosition' && s.anchors[1].price < s.anchors[0].price && s.anchors[2].price > s.anchors[0].price, JSON.stringify(s));
        await ctx.screenshot('short');
      });
    }

    check('no console error', consoleErrors.length === 0, consoleErrors.join(' | '));
    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
