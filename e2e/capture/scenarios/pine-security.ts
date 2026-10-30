import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const SCRIPT = `//@version=6
indicator("Daily EMA on hourly", overlay=true)
plot(request.security(syminfo.tickerid, "D", ta.ema(close, 10)), "Daily EMA 10", color=color.orange, linewidth=2)`;

export const pineSecurity: Scenario = {
  name: 'pine-security',
  description: 'Binance 1h chart on the fake upstream with a Pine script plotting request.security(syminfo.tickerid, "D", ta.ema(close, 10)): the script loads the same symbol\'s daily bars (one /api/history request for 1d) and the line steps once a day, at the day\'s last bar',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const pane = page.getByRole('region', { name: 'Pine editor' });
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('switch to Binance 1h', async () => {
      await page.locator('.topbar select').first().selectOption('binance');
      await page.locator('.chart-legend .legend-title', { hasText: '· 1h' }).waitFor();
      await page.locator('.chart-legend .legend-ohlc').waitFor();
    });
    await ctx.step('add a Pine indicator that reads the daily EMA', async () => {
      await showSideSection(page, 'Indicators', false);
      await page.locator('#add-indicator-select').selectOption('pine');
      await pane.waitFor();
      await page.locator('.pine-pane .pine-editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(SCRIPT);
      await page.locator('.pine-error').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await pane.waitFor({ state: 'detached' });
      await page.waitForTimeout(1500);
    });
    await ctx.step('the daily bars of the same symbol were loaded once', async () => {
      const daily = ctx.requests.filter((u) => {
        const q = new URL(u).searchParams;
        return u.includes('/api/history?') && q.get('timeframe') === '1d' && q.get('symbol') === 'BTCUSDT' && q.has('from');
      });
      if (daily.length < 1) throw new Error('the script did not ask for daily bars');
      // Later runs of the same script on the same chart may fetch a newly finished day, never the whole range again.
      if (daily.filter((u) => Number(new URL(u).searchParams.get('bars')) > 1).length !== 1) throw new Error(`the daily range was fetched more than once: ${daily.join(' ; ')}`);
    });
    await ctx.screenshot('daily-ema');
  },
};
