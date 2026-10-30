import type { Scenario } from '../scenario.ts';

export const monteCarlo: Scenario = {
  name: 'monte-carlo',
  description:
    'Monte Carlo panel in the Results tab on demo data: the default backtest, 1000 "Shuffle trade order" runs, then "Resample trades", its histogram, then Runs set to 50 (button disabled with its message)',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const toTop = () =>
      page
        .getByText('Monte Carlo', { exact: true })
        .first()
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('run the default backtest', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByRole('button', { name: /Run backtest/ }).click();
      await page.getByText(/Backtest finished/).waitFor();
    });
    await ctx.step('open Results and scroll to Monte Carlo', async () => {
      await page.locator('.dock-tab', { hasText: 'Results' }).click();
      await page.locator('.toast button').click({ timeout: 2000 }).catch(() => {});
      await toTop();
    });
    const runBtn = page.getByRole('button', { name: 'Run Monte Carlo' });
    const table = page.getByRole('table', { name: 'Monte Carlo percentiles' });
    await ctx.step('1000 shuffle runs', async () => {
      await runBtn.click();
      await table.waitFor();
      await page.getByText(/shuffled trade order/).waitFor();
      await toTop();
    });
    await ctx.screenshot('shuffle');
    await ctx.step('resample trades', async () => {
      await page.getByLabel('Method').selectOption('bootstrap');
      await runBtn.click();
      await page.getByText(/resampled trades/).first().waitFor();
      await toTop();
    });
    await ctx.screenshot('resample');
    await ctx.step('scroll to the histogram', () =>
      page.locator('.mc-hist-axis').evaluate((el) => el.scrollIntoView({ block: 'end' })),
    );
    await ctx.screenshot('histogram');
    await ctx.step('Runs below the minimum disables the button', async () => {
      await page.getByLabel('Runs').fill('50');
      await page.getByText(/Runs must be a whole number/).waitFor();
      if (!(await runBtn.isDisabled())) throw new Error('Run Monte Carlo should be disabled for 50 runs');
      await toTop();
    });
    await ctx.screenshot('invalid');
  },
};
