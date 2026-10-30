import type { Scenario } from '../scenario.ts';

export const btResults: Scenario = {
  name: 'bt-results',
  description: 'Results tab on demo data with shorts, a stop loss and a take profit on: long vs short, streaks and exit reasons; no horizontal page scroll',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('open the Backtest pane', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByLabel('Strategy').waitFor();
    });
    await ctx.step('turn on shorts, a stop loss and a take profit, then run', async () => {
      await page.getByLabel('Shorts').selectOption('yes');
      await page.getByLabel('Direction').selectOption('3');
      await page.getByLabel('Stop loss (%)').fill('2');
      await page.getByLabel('Take profit (%)').fill('4');
      await page.getByRole('button', { name: /Run backtest/ }).click();
      await page.getByText(/Backtest finished/).waitFor();
      await page.locator('.toast button').click();
    });
    await ctx.step('open Results', async () => {
      await page.locator('.dock-tab', { hasText: 'Results' }).click();
      await page.getByText('Long vs short', { exact: true }).waitFor();
      await page.getByText('Streaks', { exact: true }).waitFor();
      await page.getByText('Exit reasons', { exact: true }).waitFor();
    });
    await ctx.step('scroll to the equity chart and its legend', async () => {
      await page.getByText('Buy & hold', { exact: false }).and(page.locator('.equity-legend-item')).waitFor();
      await page.getByText('Equity curve & drawdown', { exact: false }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    });
    await ctx.screenshot('equity');
    await ctx.step('scroll to the breakdown', async () => {
      await page.getByText('Long vs short', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    });
    await ctx.step('no horizontal page scroll', async () => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) throw new Error(`page scrolls horizontally by ${over}px`);
    });
    await ctx.screenshot('breakdown');
    await ctx.step('scroll to the streaks and exit reasons', async () => {
      await page.getByText('Streaks', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    });
    await ctx.screenshot('streaks');
    await ctx.step('scroll to the exit reasons', async () => {
      await page.getByText('Exit reasons', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    });
    await ctx.screenshot('exit-reasons');
  },
};
