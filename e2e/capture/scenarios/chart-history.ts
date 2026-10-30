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

export const chartHistory: Scenario = {
  name: 'chart-history',
  description: 'Binance on the fake upstream opens on its latest 1000 bars with no Bars menu; zooming out with the wheel pages older bars in (paged /api/history?...&to= requests) and the visible time window stays the same through a prepend',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const history = () => ctx.requests.filter((u) => u.includes('/api/history?'));
    const param = (u: string, k: string) => new URL(u).searchParams.get(k);
    // Hold the first older page so the view can be measured before it arrives (the fitted 1000 bars sit at the left edge,
    // so the page follows by itself).
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = 0;
    await page.route(/\/api\/history\?.*[&?]to=/, async (route) => {
      held++;
      await gate;
      await route.fallback();
    });
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('switch to Binance 1h', async () => {
      await page.locator('.topbar select').first().selectOption('binance');
      await page.locator('.chart-legend .legend-title', { hasText: 'Binance' }).waitFor();
      await page.locator('.chart-legend .legend-title', { hasText: '· 1h' }).waitFor(); // Binance's default timeframe
      await page.locator('.chart-legend .legend-ohlc').waitFor();
      await page.waitForTimeout(800);
    });
    await ctx.step('no Bars menu in the top bar', async () => {
      const n = await page.getByLabel('Number of bars', { exact: true }).count();
      if (n !== 0) throw new Error(`the Bars select is shown (${n})`);
    });
    const firstRequest = history().filter((u) => param(u, 'provider') === 'binance' && param(u, 'timeframe') === '1h')[0];
    await ctx.step('the first request asks for 1000 bars and has no "to"', async () => {
      if (!firstRequest) throw new Error('no Binance 1h history request');
      if (param(firstRequest, 'bars') !== '1000' || param(firstRequest, 'to') != null) throw new Error(`first request was ${firstRequest}`);
    });
    await ctx.screenshot('opened');

    await ctx.step('the fitted 1000 bars sit at the left edge: the first older page is requested', async () => {
      for (let i = 0; i < 50 && held === 0; i++) await page.waitForTimeout(100);
      if (held === 0) throw new Error('no older page was requested');
      await page.waitForTimeout(500);
    });
    const loaded = async () => ((await page.getByText(/[\d,]+ bars · /).first().innerText()).match(/([\d,]+) bars/)?.[1] ?? '?');
    const barsBefore = await loaded();
    const before = { mid: await barTimeAt(page, 0.5), right: await barTimeAt(page, 0.9) };
    await ctx.screenshot('before');
    const response = page.waitForResponse((r) => r.url().includes('/api/history?') && r.url().includes('to='));
    release();
    await response;
    await page.waitForTimeout(800);
    const barsAfter = await loaded();
    const after = { mid: await barTimeAt(page, 0.5), right: await barTimeAt(page, 0.9) };
    await ctx.screenshot('after');
    const moved = Math.max(Math.abs(after.mid - before.mid), Math.abs(after.right - before.right));
    await ctx.step('the prepend added bars', async () => {
      if (barsBefore === barsAfter) throw new Error(`the loaded bars stayed at ${barsBefore}`);
    });
    await ctx.step('the visible time window is the same through the prepend, to within one bar', async () => {
      if (moved > BAR_SECONDS) throw new Error(`the view moved by ${moved / BAR_SECONDS} bars`);
    });

    await ctx.step('zoom out further: more pages arrive and earlier dates show', async () => {
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(1500);
    });
    await ctx.screenshot('zoomed-out');
    await ctx.writeText(
      'checks',
      [
        `loaded bars before and after the first prepend: ${barsBefore} -> ${barsAfter}`,
        `window before the first prepend (bar times under 50% and 90% of the plot): ${new Date(before.mid * 1000).toISOString()} ${new Date(before.right * 1000).toISOString()}`,
        `window after the first prepend:  ${new Date(after.mid * 1000).toISOString()} ${new Date(after.right * 1000).toISOString()}`,
        `largest move: ${moved / BAR_SECONDS} bars (allowed: 1)`,
        'history requests:',
        ...history().map((u) => `  ${u}`),
        '',
      ].join('\n'),
    );
    const paged = history().filter((u) => param(u, 'provider') === 'binance' && param(u, 'timeframe') === '1h' && param(u, 'to') != null);
    await ctx.step('the network log shows paged history requests', async () => {
      if (paged.length < 2) throw new Error(`only ${paged.length} paged requests`);
      if (paged.some((u) => param(u, 'bars') !== '1000')) throw new Error('a page did not ask for 1000 bars');
      const tos = paged.map((u) => Number(param(u, 'to')));
      if (tos.some((t, i) => i > 0 && t >= tos[i - 1])) throw new Error('the pages did not move back in time');
    });
  },
};
