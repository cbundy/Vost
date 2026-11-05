import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

const BAR_SECONDS = 3600; // the chart runs on 1h bars

/** The bar time (UTC seconds, read in the browser's zone as if it were UTC) under the plot's x fraction, from the legend. */
async function barTimeAt(page: Page, fraction: number): Promise<number> {
  const box = await page.locator('.chart-container canvas').first().boundingBox();
  if (!box) throw new Error('chart has no box');
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const text = (await page.locator('.chart-legend .legend-sub span').last().innerText()).trim();
  const ms = Date.parse(`${text} UTC`);
  if (Number.isNaN(ms)) throw new Error(`cannot read a time from the legend: "${text}"`);
  return ms / 1000;
}

export const symbolView: Scenario = {
  name: 'symbol-view',
  description: 'Switching symbol on the same timeframe keeps the dates and zoom: at the live edge the new last bar ends the same bar count, scrolled back the same time window shows (older pages load when the window starts before the new first bar)',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const history = () => ctx.requests.filter((u) => u.includes('/api/history?'));
    const pagedCount = () => history().filter((u) => new URL(u).searchParams.get('to') != null).length;
    const lines: string[] = [];
    const iso = (t: number) => new Date(t * 1000).toISOString();
    const win = async () => ({ left: await barTimeAt(page, 0.15), right: await barTimeAt(page, 0.8) });
    const box = async () => {
      const b = await page.locator('.chart-container canvas').first().boundingBox();
      if (!b) throw new Error('chart has no box');
      return b;
    };
    const drag = async (from: number, to: number) => {
      const b = await box();
      const y = b.y + b.height / 2;
      await page.mouse.move(b.x + b.width * from, y);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * to, y, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
    };
    const switchTo = async (symbol: string) => {
      const input = page.locator('.topbar .symbol-search input');
      await input.fill(symbol);
      await input.press('Escape');
      await input.press('Enter');
      await page.locator('.chart-legend .legend-title', { hasText: symbol }).waitFor();
      await page.waitForTimeout(1500);
    };
    const check = (name: string, ok: boolean, detail: string) => {
      lines.push(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);

      if (!ok) throw new Error(`${name}: ${detail}`);
    };

    await ctx.step('open Binance 1h', async () => {
      await page.goto('/');
      await ctx.waitForChart();
      await page.locator('.topbar select').first().selectOption('binance');
      await page.locator('.chart-legend .legend-title', { hasText: '· 1h' }).waitFor();
      await page.locator('.chart-legend .legend-ohlc').waitFor();
      await page.waitForTimeout(1500);
    });

    // 1. Live edge, at the Reset view window.
    await ctx.step('live edge: reset view, switch symbol', async () => {
      await page.locator('button[title="Reset view"]').click(); // the timeframe's window ending at the last bar
      await page.waitForTimeout(1500);
      const before = await win();
      await ctx.screenshot('live-before');
      await switchTo('ETHUSDT');
      const after = await win();
      await ctx.screenshot('live-after');
      const span = before.right - before.left;
      check('live edge right', Math.abs(after.right - before.right) <= BAR_SECONDS, `${iso(before.right)} -> ${iso(after.right)}`);
      check('live edge span', Math.abs(after.right - after.left - span) <= BAR_SECONDS, `${span / BAR_SECONDS} bars -> ${(after.right - after.left) / BAR_SECONDS} bars`);
    });

    // 2. Scrolled back inside the loaded bars.
    await ctx.step('scrolled back inside loaded bars: switch symbol, no history request', async () => {
      await drag(0.5, 0.6);
      const before = await win();
      await ctx.screenshot('back-before');
      const paged = pagedCount();
      await switchTo('SOLUSDT');
      const after = await win();
      await ctx.screenshot('back-after');
      check('scrolled back left', Math.abs(after.left - before.left) <= BAR_SECONDS, `${iso(before.left)} -> ${iso(after.left)}`);
      check('scrolled back right', Math.abs(after.right - before.right) <= BAR_SECONDS, `${iso(before.right)} -> ${iso(after.right)}`);
      check('no extra history request', pagedCount() === paged, `${pagedCount() - paged} new paged requests`);
    });

    // 3. Scrolled back past the new symbol's loaded bars.
    await ctx.step('scrolled back past the loaded bars: older pages load', async () => {
      for (let i = 0; i < 14; i++) await drag(0.1, 0.9);
      await page.waitForTimeout(1500);
      const before = await win();
      const paged = pagedCount();
      await ctx.screenshot('past-before');
      await switchTo('BNBUSDT');
      await page.waitForTimeout(1500);
      const after = await win();
      await ctx.screenshot('past-after');
      check('past loaded left', Math.abs(after.left - before.left) <= BAR_SECONDS, `${iso(before.left)} -> ${iso(after.left)}`);
      check('older pages loaded for the new symbol', pagedCount() > paged, `${pagedCount() - paged} new paged requests`);
      check('past loaded right', Math.abs(after.right - before.right) <= BAR_SECONDS, `${iso(before.right)} -> ${iso(after.right)}`);
    });

    await ctx.writeText('checks', [...lines, 'history requests:', ...history().map((u) => `  ${u}`), ''].join('\n'));
  },
};
