import type { Scenario } from '../scenario.ts';

export const optimizer: Scenario = {
  name: 'optimizer',
  description: 'Optimizer pane on demo data: a one-parameter sweep of slow (table and heatmap), then a fractional step on a whole-number parameter, then a grid over the limit',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('open the Optimizer pane', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Optimizer' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByText('Parameter A').waitFor();
    });
    await ctx.step('sweep slow alone', async () => {
      await page.getByLabel('Parameter A').selectOption('slow');
      await page.getByLabel('Parameter B (2D sweep)').selectOption('');
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
      await page.getByText(/Top results/).waitFor();
      await page.getByText('Rows:').scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('slow-sweep');
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
      await page.getByLabel('Parameter B (2D sweep)').selectOption('fast');
      await num.nth(3).fill('1');
      await num.nth(4).fill('400');
      await num.nth(5).fill('1');
      await page.getByText(/Grid too large/).waitFor();
      await page.getByText(/Grid too large/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('over-limit');
  },
};
