import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

const liveButton = (page: Page) => page.locator('.topbar button.badge');
const lastCandle = (page: Page) => page.locator('.chart-legend .legend-ohlc').innerText();

export const outage: Scenario = {
  name: 'outage',
  description: 'Video: live data on Binance, the market-data service goes away (RETRY, the live row not ok) and comes back (LIVE, ok, candle moving) with no reload',
  video: true,
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const binanceLive = () => page.locator('.conn-provider', { hasText: 'Binance' }).locator('.conn-row', { hasText: 'Live stream' });
    const testNow = async (): Promise<void> => {
      await page.locator('.conn-test', { hasText: 'Test now' }).click();
    };
    /** Waits until the candle in the legend differs from `before`: the live feed moved it. */
    const candleMovesFrom = (before: string) =>
      page.waitForFunction((was) => document.querySelector('.chart-legend .legend-ohlc')?.textContent !== was, before);

    let navigations = 0;
    page.on('framenavigated', () => navigations++);

    try {
      await ctx.step('open app and switch to Binance', async () => {
        await page.goto('/');
        await ctx.waitForChart();
        await page.locator('.topbar select').first().selectOption('binance');
        await page.locator('.chart-legend .legend-title', { hasText: 'Binance · BTCUSDT · 1h' }).waitFor();
        // A page reload would clear this marker.
        await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
        navigations = 0;
      });

      await ctx.step('the chart opens live: LIVE and a moving last candle', async () => {
        await liveButton(page).filter({ hasText: /^\s*LIVE\s*$/ }).waitFor();
        await candleMovesFrom(await lastCandle(page));
      });

      await ctx.step('status popover: the live row is ok', async () => {
        await page.locator('.conn-btn').click();
        await page.locator('.conn-row').first().waitFor();
        await testNow();
        await binanceLive().and(page.locator('[data-state="ok"]')).waitFor();
      });
      await ctx.screenshot('live');

      const beforeOutage = await lastCandle(page);
      await ctx.step('the market-data service goes away: RETRY and the live row not ok', async () => {
        await ctx.upstream.stop();
        await liveButton(page).filter({ hasText: /RETRY|ERR/ }).waitFor();
        await testNow();
        // A "Test now" within 15 s of the last round only reads the live state; after that it runs a full round (about 4 s of staggered probes).
        await binanceLive().and(page.locator(':not([data-state="ok"])')).waitFor({ timeout: 20_000 });
      });
      await ctx.screenshot('outage');

      await ctx.step('the service comes back: LIVE again', async () => {
        await ctx.upstream.start();
        // The outage is a few seconds, inside the fast reconnect backoff (700 ms doubling, server/live/socket.ts):
        // the next attempt is at most 11.2 s away (the fifth backoff step), so 20 s is that step plus slack.
        await liveButton(page).filter({ hasText: /^\s*LIVE\s*$/ }).waitFor({ timeout: 20_000 });
      });

      await ctx.step('the live row is ok again and the last candle moves again', async () => {
        await testNow();
        // Same bound as above: a fresh round of staggered probes takes about 4 s plus the probes' own time.
        await binanceLive().and(page.locator('[data-state="ok"]')).waitFor({ timeout: 20_000 });
        await candleMovesFrom(beforeOutage);
        const next = await lastCandle(page);
        await candleMovesFrom(next);
      });
      await ctx.screenshot('recovered');

      await ctx.step('no reload and no navigation happened', async () => {
        const marker = await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);
        if (!marker || navigations !== 0) throw new Error(`the page was reloaded or navigated (marker ${marker}, navigations ${navigations})`);
      });
    } finally {
      await ctx.upstream.start(); // never leave the service down for the next scenario
    }
  },
};
