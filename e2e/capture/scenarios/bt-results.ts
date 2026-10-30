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
    await ctx.step('hover a card in the right-most column and see its tooltip inside the viewport', async () => {
      await page.locator('.metrics-grid').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      const cards = page.locator('.metrics-grid').first().locator('.metric-card');
      const n = await cards.count();
      let best = 0;
      let bestLeft = -1;
      for (let i = 0; i < n; i++) {
        const left = await cards.nth(i).evaluate((el) => el.getBoundingClientRect().left);
        if (left > bestLeft) {
          bestLeft = left;
          best = i;
        }
      }
      await cards.nth(best).hover();
      const tip = page.getByRole('tooltip');
      await tip.waitFor();
      await page.waitForFunction(() => (document.querySelector('[role="tooltip"]') as HTMLElement | null)?.style.visibility !== 'hidden');
      const box = await tip.boundingBox();
      const vp = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: window.innerHeight }));
      if (!box || box.x < 8 - 0.5 || box.y < 0 || box.x + box.width > vp.w - 8 + 0.5 || box.y + box.height > vp.h) {
        throw new Error(`tooltip leaves the viewport: ${JSON.stringify(box)} in ${vp.w}x${vp.h}`);
      }
    });
    await ctx.screenshot('tip-card');
    await ctx.step('keyboard-focus a Long vs short row label and see its tooltip', async () => {
      await page.keyboard.press('Escape');
      await page.getByText('Long vs short', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.locator('.data-table .metric-tip-anchor', { hasText: 'Profit factor' }).first().focus();
      await page.getByRole('tooltip').waitFor();
      await page.waitForFunction(() => (document.querySelector('[role="tooltip"]') as HTMLElement | null)?.style.visibility !== 'hidden');
    });
    await ctx.screenshot('tip-row');
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
