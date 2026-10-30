import type { Scenario } from '../scenario.ts';

export const btRange: Scenario = {
  name: 'bt-range',
  description: 'Backtest pane on demo data: no range, a range before the loaded bars (loads history, moves the chart), then From later than To',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('open the Backtest pane', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.locator('.time-range').waitFor();
      await page.locator('.time-range').scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('no-range');
    const from = page.getByLabel('Time range From');
    const to = page.getByLabel('Time range To');
    await ctx.step('set a range and run', async () => {
      await from.fill('2020-03-01T00:00');
      await to.fill('2020-09-30T00:00');
      await page.locator('.time-range').scrollIntoViewIfNeeded();
      await ctx.screenshot('before-run'); // the range starts before the loaded bars: the hint says older history loads on run
      await page.getByRole('button', { name: /Run backtest/ }).click();
      await page.getByText(/Backtest finished/).waitFor();
      await page.locator('.time-range').scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('range');
    await page.waitForTimeout(500); // the chart takes the range on the frame after the run
    await ctx.screenshot('chart-range'); // the chart has moved to the range (the run loaded the older history)
    await ctx.step('swap to From later than To', async () => {
      await page.locator('.toast button').click();
      await from.fill('2020-10-30T00:00');
      await page.locator('.time-range-error').waitFor();
    });
    await ctx.screenshot('from-after-to');
  },
};
