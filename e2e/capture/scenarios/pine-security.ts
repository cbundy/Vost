import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const SCRIPT = `//@version=6
indicator("Daily EMA on hourly", overlay=true)
plot(request.security(syminfo.tickerid, "D", ta.ema(close, 10)), "Daily EMA 10", color=color.orange, linewidth=2)`;

const DECLARED = `//@version=6
indicator("Daily SMA", overlay=true, timeframe="D", timeframe_gaps=false)
plot(ta.sma(close, 5), "Daily SMA 5", color=color.orange, linewidth=2)`;

const OTHER_SCRIPT = `//@version=6
indicator("Bybit ETHUSDT on a Binance BTCUSDT chart", overlay=false)
plot(request.security("BYBIT:ETHUSDT", "", close), "Bybit ETHUSDT close", color=color.orange, linewidth=2)`;

export const pineSecurity: Scenario = {
  name: 'pine-security',
  description: 'Binance 1h chart on the fake upstream with a Pine script plotting request.security(syminfo.tickerid, "D", ta.ema(close, 10)): the script loads the same symbol\'s daily bars (one /api/history request for 1d) and the line steps once a day, at the day\'s last bar; then the script is replaced by indicator(timeframe="D", timeframe_gaps=false) plotting ta.sma(close, 5), which runs on daily bars and steps the same way; a third script reads BYBIT:ETHUSDT on the same chart, which asks the fake upstream for Bybit history',
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
    for (const [name, script, shot] of [
      ['replace the script with one that declares the daily timeframe', DECLARED, 'declared-timeframe'],
      ['replace it with a script that reads another symbol from Bybit', OTHER_SCRIPT, ''],
    ] as const) {
      await ctx.step(name, async () => {
        await showSideSection(page, 'Indicators', false);
        await page.getByRole('button', { name: /^Edit .* source$/ }).click();
        await pane.waitFor();
        await page.locator('.pine-pane .pine-editor .cm-content').click();
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(script);
        await page.locator('.pine-error').waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Close Pine editor' }).click();
        await pane.waitFor({ state: 'detached' });
        await page.waitForTimeout(1500);
      });
      if (shot) await ctx.screenshot(shot);
    }
    await ctx.step('the fake upstream got a Bybit history request for ETHUSDT', async () => {
      const bybit = ctx.upstream.requests.filter((r) => r.host === 'api.bybit.com' && r.path.startsWith('/v5/market/kline') && r.path.includes('symbol=ETHUSDT'));
      if (bybit.length < 1) throw new Error('the script did not ask Bybit for ETHUSDT');
    });
    await ctx.screenshot('other-symbol');
  },
};
