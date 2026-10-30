import type { Scenario } from '../scenario.ts';

export const optimizer: Scenario = {
  name: 'optimizer',
  description: 'Optimizer pane on demo data: a one-parameter sweep of slow (table and heatmap), a sortable full results table, a fractional step on a whole-number parameter, a grid over the limit, an in-sample / out-of-sample split with its held-out check and a refused 99%, then a three-parameter MACD sweep with the heatmap axis pickers and a cancelled long run',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('open the Optimizer pane', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Optimizer' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByText('Parameter 1', { exact: true }).waitFor();
    });
    await ctx.step('sweep slow alone', async () => {
      await page.getByRole('button', { name: 'Remove parameter 1' }).click();
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
      await page.getByText(/Results ·/).waitFor();
      await page.getByText('Rows:').scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('slow-sweep');
    await ctx.step('split 70% in-sample, check the top 10', async () => {
      await page.getByLabel('Validation').selectOption('split');
      await page.getByLabel('In-sample %').fill('70');
      await page.getByLabel('Top results to check').fill('10');
      await page.getByText(/^In-sample: [\d,]+ bars/).waitFor();
      await page.getByText('Parameter 1', { exact: true }).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('split-settings');
    await ctx.step('run the split and show the held-out check', async () => {
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
      await page.getByText(/Held-out check/).waitFor();
      await page.getByText(/Results \(in-sample\)/).waitFor();
      await page.getByText(/Held-out check/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('held-out-check');
    await ctx.step('refuse 99% in-sample', async () => {
      await page.getByLabel('In-sample %').fill('99');
      await page.getByText(/In-sample % must be a whole number/).waitFor();
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).isDisabled();
      await page.getByText(/In-sample % must be a whole number/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('split-invalid');
    await ctx.step('back to no validation', async () => {
      await page.getByLabel('In-sample %').fill('70');
      await page.getByLabel('Validation').selectOption('none');
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
      await page.getByText(/Results ·/).waitFor();
    });
    await ctx.step('sort the results by Trades, then reverse', async () => {
      const header = page.getByRole('columnheader', { name: /Trades/ });
      await header.getByRole('button').click();
      await page.locator('th[aria-sort="descending"]').waitFor();
      await header.getByRole('button').click();
      await page.locator('th[aria-sort="ascending"]', { hasText: 'Trades' }).waitFor();
      await page.getByText(/Results ·/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('results-sorted');
    const num = page.locator('.form-grid input[type=number]');
    const step = num.nth(2);
    await ctx.step('fractional step on a whole-number parameter', async () => {
      await step.fill('0.5');
      await page.getByText(/whole-number parameter/).waitFor();
      await page.getByText(/whole-number parameter/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('fractional-step');
    await ctx.step('grid over the limit', async () => {
      await step.fill('1');
      await num.nth(0).fill('1');
      await num.nth(1).fill('400');
      await page.getByRole('button', { name: 'Add parameter' }).click();
      await num.nth(3).fill('1');
      await num.nth(4).fill('400');
      await num.nth(5).fill('1');
      await page.getByText(/Grid too large/).waitFor();
      await page.getByText(/Grid too large/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('over-limit');
    await ctx.step('three-parameter MACD sweep', async () => {
      await page.goto('/');
      await ctx.waitForChart();
      await page.locator('.dock-tab', { hasText: 'Backtest' }).click();
      await page.getByLabel('Strategy').selectOption('macd_cross');
      await page.locator('.dock-tab', { hasText: 'Optimizer' }).click();
      await page.getByText('Parameter 1', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Add parameter' }).click();
      await page.getByText('Parameter 3', { exact: true }).waitFor();
      const n = page.locator('.form-grid input[type=number]');
      const ranges = [
        [8, 12, 2],
        [20, 30, 5],
        [6, 10, 2],
      ];
      for (const [i, r] of ranges.entries()) {
        await n.nth(i * 3).fill(String(r[0]));
        await n.nth(i * 3 + 1).fill(String(r[1]));
        await n.nth(i * 3 + 2).fill(String(r[2]));
      }
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
      await page.getByText(/Results ·/).waitFor();
      await page.getByText(/Other parameters fixed at the best result/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('three-parameters');
    await ctx.step('show the paging count', async () => {
      await page.getByText(/Results ·/).scrollIntoViewIfNeeded();
      await page.getByText(/^Rows 1-\d+ of \d+$/).waitFor();
    });
    await ctx.screenshot('paging');
    await ctx.step('cancel a long run and keep the previous result', async () => {
      const n = page.locator('.form-grid input[type=number]');
      await n.nth(0).fill('1');
      await n.nth(1).fill('40');
      await n.nth(2).fill('1');
      await n.nth(3).fill('2');
      await n.nth(4).fill('40');
      await n.nth(5).fill('1');
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
    });
    await ctx.screenshot('cancel-visible');
    await ctx.step('press Cancel', async () => {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByText(/Optimizer cancelled/).waitFor();
      await page.getByText(/Results ·/).waitFor();
    });
    await ctx.screenshot('cancelled-restored');
  },
};
