import type { Scenario } from '../scenario.ts';

export const builtTimeframe: Scenario = {
  name: 'built-timeframe',
  description: 'Coinbase on the fake upstream: the timeframe picker marks built options, and 4h loads a chart built from 1h',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const providerSelect = page.locator('.topbar select').first();
    const title = (name: string, symbol: string, tf: string) => page.locator('.chart-legend .legend-title', { hasText: `${name} · ${symbol} · ${tf}` });
    const timeframeSelect = page.locator('.topbar select[title="Timeframe"]');
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('switch to Coinbase', async () => {
      await providerSelect.selectOption('coinbase');
      await title('Coinbase', 'BTC-USD', '1h').waitFor();
    });
    await ctx.step('the picker lists native and built timeframes, built ones marked', async () => {
      const labels = await timeframeSelect.locator('option').allTextContents();
      const expected = ['1m', '5m', '15m', '30m *', '1h', '4h *', '1d', '1w *', '1M *'];
      if (JSON.stringify(labels) !== JSON.stringify(expected)) throw new Error(`picker shows ${labels.join(', ')}, expected ${expected.join(', ')}`);
      const title = await timeframeSelect.locator('option', { hasText: '4h' }).getAttribute('title');
      if (title !== 'Built from a lower timeframe') throw new Error(`built option title is ${title}`);
    });
    await ctx.step('pick 4h and keep it', async () => {
      await timeframeSelect.selectOption('4h');
      await title('Coinbase', 'BTC-USD', '4h').waitFor();
      await page.locator('.chart-legend .legend-ohlc').waitFor();
      const value = await timeframeSelect.inputValue();
      if (value !== '4h') throw new Error(`timeframe snapped back to ${value}`);
    });
    await ctx.screenshot('chart');
    await ctx.step('show the picker options', async () => {
      // A native dropdown does not render in a headless screenshot: draw its options as a list under the select.
      await timeframeSelect.evaluate((el) => {
        const select = el as HTMLSelectElement;
        const box = select.getBoundingClientRect();
        const list = document.createElement('div');
        list.style.cssText = `position:fixed;z-index:1000;left:${box.left}px;top:${box.bottom + 2}px;min-width:${box.width}px;background:#1e222d;border:1px solid #434651;border-radius:4px;padding:4px 0;color:#d1d4dc;font:13px sans-serif`;
        for (const option of Array.from(select.options)) {
          const row = document.createElement('div');
          row.textContent = option.text;
          row.title = option.title;
          row.style.cssText = `padding:3px 10px;${option.selected ? 'background:#2962ff;color:#fff' : ''}`;
          list.appendChild(row);
        }
        document.body.appendChild(list);
      });
    });
    await ctx.screenshot('picker');
  },
};
