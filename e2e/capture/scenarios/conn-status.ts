import type { StatusCheck, StatusResponse } from '../../../shared/status.ts';
import type { Scenario } from '../scenario.ts';

const NOW = Date.now();
const check = (provider: string, providerName: string, feed: StatusCheck['feed'], over: Partial<StatusCheck> = {}): StatusCheck => ({
  provider,
  providerName,
  feed,
  state: 'ok',
  latencyMs: 180,
  checkedAt: NOW - 20_000,
  lastOkAt: NOW - 20_000,
  error: null,
  source: 'probe',
  ...over,
});

/** A fixed payload with ok, degraded and down rows and a relay row; the server runs with probes off. */
const payload = (refreshed?: boolean): StatusResponse => ({
  server: { state: 'ok', version: '0.4.0', uptimeSeconds: 7_260 },
  intervalSeconds: 60,
  ...(refreshed === undefined ? {} : { refreshed }),
  checks: [
    check('binance', 'Binance', 'history', { latencyMs: 142 }),
    check('binance', 'Binance', 'symbols', { latencyMs: 640 }),
    check('binance', 'Binance', 'live', { latencyMs: null, source: 'relay' }),
    check('coinbase', 'Coinbase', 'history', { latencyMs: 96 }),
    check('coinbase', 'Coinbase', 'symbols', { latencyMs: 4_200, state: 'degraded', error: 'slow answer (4200 ms)' }),
    check('kraken', 'Kraken', 'history', { latencyMs: 310 }),
    check('kraken', 'Kraken', 'symbols', { latencyMs: 450 }),
    check('kraken', 'Kraken', 'live', {
      state: 'down',
      latencyMs: null,
      lastOkAt: NOW - 25 * 60_000,
      source: 'relay',
      error: 'close code 1006, reason (none), wasClean false - the exchange may be blocked in your region or by a firewall',
    }),
    check('bybit', 'Bybit', 'history', { latencyMs: 220 }),
    check('bybit', 'Bybit', 'symbols', { latencyMs: 300 }),
    check('bybit', 'Bybit', 'live', { latencyMs: 410 }),
    check('okx', 'OKX', 'history', { latencyMs: 260 }),
    check('okx', 'OKX', 'symbols', { latencyMs: 280 }),
    check('okx', 'OKX', 'live', { state: 'degraded', latencyMs: 10_000, error: 'connected but sent no data within 10 s' }),
    check('yahoo', 'Yahoo Finance', 'history', { latencyMs: 520 }),
    check('yahoo', 'Yahoo Finance', 'symbols', { latencyMs: 480 }),
    check('stooq', 'Stooq', 'history', { latencyMs: 700 }),
  ],
});

export const connStatus: Scenario = {
  name: 'conn-status',
  description: 'Top-bar connection light closed and open (stubbed /api/status with ok, degraded and down rows), then Test now',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await page.route('**/api/status*', (route) => {
      const refresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
      return route.fulfill({ json: payload(refresh ? true : undefined) });
    });
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('wait for the light', () => page.locator('.conn-count').waitFor());
    await ctx.screenshot('closed');
    await ctx.step('open the list', async () => {
      await page.locator('.conn-btn').click();
      await page.locator('.conn-row').first().waitFor();
    });
    await ctx.screenshot('open');
    await ctx.step('Test now and Escape', async () => {
      await page.locator('.conn-test').click();
      await page.locator('.conn-test', { hasText: 'Test now' }).waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.conn-pop').waitFor({ state: 'detached' });
      const focused = await page.evaluate(() => document.activeElement?.classList.contains('conn-btn'));
      if (!focused) throw new Error('focus did not return to the connection button');
    });
  },
};
