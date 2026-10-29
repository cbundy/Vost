import type { Scenario } from '../scenario.ts';

export const builtTimeframe: Scenario = {
  name: 'built-timeframe',
  description: 'Coinbase on the fake upstream: the timeframe picker marks built options, 4h loads a chart built from 1h and streams live, and the Build setting builds every higher timeframe from the next lower one',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const narrow = ctx.viewport === 'narrow';
    const more = page.getByRole('button', { name: 'More', exact: true });
    const providerSelect = narrow ? page.getByRole('dialog', { name: 'More' }).locator('select').first() : page.locator('.topbar select').first();
    const title = (name: string, symbol: string, tf: string) => page.locator('.chart-legend .legend-title', { hasText: `${name} · ${symbol} · ${tf}` });
    const timeframeSelect = page.locator('.topbar select[title="Timeframe"]');
    // The picker ends with a disabled separator and the "Add interval..." entry: compare only the timeframe options.
    const timeframeOptions = timeframeSelect.locator('option:not([disabled]):not([value="__add-interval"])');
    const expectPicker = async (expected: string[]) => {
      const labels = await timeframeOptions.allTextContents();
      if (JSON.stringify(labels) !== JSON.stringify(expected)) throw new Error(`picker shows ${labels.join(', ')}, expected ${expected.join(', ')}`);
    };
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('switch to Coinbase', async () => {
      if (narrow) await more.click();
      await providerSelect.selectOption('coinbase');
      await title('Coinbase', 'BTC-USD', '1h').waitFor();
      if (narrow) await page.keyboard.press('Escape');
    });
    await ctx.step('the picker lists native and built timeframes, built ones marked', async () => {
      const labels = await timeframeOptions.allTextContents();
      const expected = ['1m', '5m', '15m', '30m *', '1h', '4h *', '1d', '1w *', '1M *'];
      if (JSON.stringify(labels) !== JSON.stringify(expected)) throw new Error(`picker shows ${labels.join(', ')}, expected ${expected.join(', ')}`);
      const title = await timeframeSelect.locator('option', { hasText: '4h' }).getAttribute('title');
      if (title !== 'Built from 1h') throw new Error(`built option title is ${title}`);
    });
    await ctx.step('pick 4h and keep it', async () => {
      await timeframeSelect.selectOption('4h');
      await title('Coinbase', 'BTC-USD', '4h').waitFor();
      await page.locator('.chart-legend .legend-ohlc').waitFor();
      const value = await timeframeSelect.inputValue();
      if (value !== '4h') throw new Error(`timeframe snapped back to ${value}`);
    });
    await ctx.screenshot('chart');
    const buildButton = () => (narrow ? page.getByRole('dialog', { name: 'More' }) : page.locator('.topbar')).getByRole('button', { name: 'Build higher timeframes from lower ones' });
    if (narrow) {
      await ctx.step('the Build setting sits in the More menu, off', async () => {
        await more.click();
        const pressed = await buildButton().getAttribute('aria-pressed');
        if (pressed !== 'false') throw new Error(`Build is aria-pressed=${pressed}, expected false`);
      });
      await ctx.screenshot('setting-off');
      await ctx.step('turn Build on: every option above 1m is marked and 4h reloads', async () => {
        await buildButton().click();
        await page.keyboard.press('Escape');
        await title('Coinbase', 'BTC-USD', '4h').waitFor();
        await expectPicker(['1m', '5m *', '15m *', '30m *', '1h *', '4h *', '1d *', '1w *', '1M *']);
      });
      await more.click();
      await ctx.screenshot('setting-on');
      return;
    }
    await ctx.step('turn Live on: LIVE and the last 4h bar updates from the 1h stream', async () => {
      const liveButton = page.locator('.topbar button.badge').first();
      const ohlc = page.locator('.chart-legend .legend-ohlc');
      const before = await ohlc.innerText();
      await liveButton.click();
      await liveButton.filter({ hasText: /^\s*LIVE\s*$/ }).waitFor();
      await page.waitForFunction(
        (text) => (document.querySelector('.chart-legend .legend-ohlc') as HTMLElement | null)?.innerText !== text,
        before,
        { timeout: 20_000 },
      );
    });
    await ctx.screenshot('live');
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
    await ctx.step('the Build setting is off: the picker is unchanged', async () => {
      const pressed = await buildButton().getAttribute('aria-pressed');
      if (pressed !== 'false') throw new Error(`Build is aria-pressed=${pressed}, expected false`);
    });
    await ctx.step('turn Build on: every option above 1m is marked, Live stays on, and 4h reloads', async () => {
      const liveButton = page.locator('.topbar button.badge').first();
      await buildButton().click();
      await expectPicker(['1m', '5m *', '15m *', '30m *', '1h *', '4h *', '1d *', '1w *', '1M *']);
      const built = await timeframeSelect.locator('option', { hasText: '1h' }).getAttribute('title');
      if (built !== 'Built from 15m') throw new Error(`1h option title is ${built}`);
      await title('Coinbase', 'BTC-USD', '4h').waitFor();
      await liveButton.filter({ hasText: /^\s*LIVE\s*$/ }).waitFor();
    });
    await ctx.step('pick 1h: the chart loads built from 15m', async () => {
      const before = ctx.requests.length;
      await timeframeSelect.selectOption('1h');
      await title('Coinbase', 'BTC-USD', '1h').waitFor();
      const asked = ctx.requests.slice(before).filter((u) => u.includes('/api/history') && u.includes('timeframe=1h'));
      if (!asked.some((u) => u.includes('source=built'))) throw new Error(`no source=built history request: ${asked.join(', ')}`);
    });
    await ctx.screenshot('setting-on');
  },
};
