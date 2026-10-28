import { PROVIDER_CATALOG } from '../../../shared/providerCatalog.ts';
import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

/** The top-bar live button: LIVE / ... / RETRY / ERR when on, "Live" when off. */
const liveButton = (page: Page) => page.locator('.topbar button.badge:has(.live-dot)');

/** One line per distinct URL: how many times the browser asked for it, then the URL. */
function countLines(urls: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const u of urls) counts.set(u, (counts.get(u) ?? 0) + 1);
  return [...counts].map(([url, n]) => `${String(n).padStart(4)}  ${url}`).join('\n') + '\n';
}

export const networkAudit: Scenario = {
  name: 'network-audit',
  description: 'Walks every remote data source in the UI (history, timeframes, search, watchlist, live, status) and fails if the browser contacts anything but the Vost server',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const title = (name: string, symbol: string, tf: string) => page.locator('.chart-legend .legend-title', { hasText: `${name} · ${symbol} · ${tf}` });
    const providerSelect = page.locator('.topbar select').first();

    const startedAt = Date.now();
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    for (const info of PROVIDER_CATALOG) {
      await ctx.step(`switch to ${info.id}`, async () => {
        await providerSelect.selectOption(info.id);
        await title(info.name, info.defaultSymbol, info.defaultTimeframe).waitFor();
        await page.locator('.chart-legend .legend-ohlc').waitFor();
      });
      await ctx.screenshot(`provider-${info.id}`);
    }

    await ctx.step('switch to binance for the timeframe, search and live steps', async () => {
      await providerSelect.selectOption('binance');
      await title('Binance', 'BTCUSDT', '1h').waitFor();
    });
    for (const tf of ['15m', '5m']) {
      await ctx.step(`timeframe ${tf}`, async () => {
        await page.locator('select[title="Timeframe"]').selectOption(tf);
        await title('Binance', 'BTCUSDT', tf).waitFor();
      });
    }
    await ctx.screenshot('timeframe');

    await ctx.step('symbol search and pick a result', async () => {
      const input = page.locator('.symbol-search input');
      await input.click();
      await input.fill('ETH');
      await page.locator('.symbol-suggestion', { hasText: 'ETHUSDT' }).first().click();
      await title('Binance', 'ETHUSDT', '5m').waitFor();
    });
    await ctx.screenshot('search');

    await ctx.step('add the symbol to the watchlist, leave, and open it', async () => {
      const panel = page.locator('.watchlist');
      await panel.getByTitle('Add current symbol').click();

      const row = panel.locator('.wl-row', { hasText: 'ETHUSDT' }).first();
      await row.waitFor();
      await providerSelect.selectOption('coinbase');
      await title('Coinbase', 'BTC-USD', '1h').waitFor();
      await row.click();
      // The seeded list already holds ETHUSDT, so opening it loads the provider's default timeframe.
      await title('Binance', 'ETHUSDT', '1h').waitFor();
    });
    await ctx.screenshot('watchlist');

    await ctx.step('live on, then off', async () => {
      await liveButton(page).click();
      await liveButton(page).filter({ hasText: /^\s*LIVE\s*$/ }).waitFor();
      await ctx.screenshot('live');
      await liveButton(page).click();
      await liveButton(page).filter({ hasText: /^\s*Live\s*$/ }).waitFor();
    });

    await ctx.step('open the status popover', async () => {
      await page.locator('.conn-btn').click();
      await page.locator('.conn-row').first().waitFor();
    });
    await ctx.screenshot('status');
    await ctx.step('close the status popover', () => page.keyboard.press('Escape'));

    await ctx.step('daily quote requests stay within one per minute per URL', async () => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const limit = 1 + Math.floor(elapsedSeconds / 60);
      const counts = new Map<string, number>();
      for (const u of ctx.requests) {
        const url = new URL(u);
        if (url.pathname !== '/api/history' || url.searchParams.get('timeframe') !== '1d') continue;
        counts.set(u, (counts.get(u) ?? 0) + 1);
      }
      const over = [...counts].filter(([, n]) => n > limit);
      if (over.length) throw new Error(`daily quote URLs requested more than ${limit} times: ${over.map(([u, n]) => `${n}x ${u}`).join(', ')}`);
    });

    await ctx.writeText('requests', countLines(ctx.requests));
  },
};
