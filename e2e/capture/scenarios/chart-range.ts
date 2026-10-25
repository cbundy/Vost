import type { Scenario } from '../scenario.ts';

export const chartRange: Scenario = {
  name: 'chart-range',
  description: 'Top bar Range control on demo data: normal label, a range applied, a refused range, then cleared',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.screenshot('before');
    await ctx.step('apply a range', async () => {
      await page.getByRole('button', { name: 'Range', exact: true }).click();
      await page.getByLabel('Chart range From').fill('2022-03-01T00:00');
      await page.getByLabel('Chart range To').fill('2022-09-30T00:00');
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.getByRole('button', { name: 'Clear range' }).waitFor();
      await page.waitForTimeout(600);
    });
    await ctx.screenshot('applied');
    await ctx.step('refuse a range after the last bar', async () => {
      await page.getByRole('button', { name: 'Range on' }).click();
      await page.getByLabel('Chart range To').fill('2099-01-01T00:00');
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.locator('.toast', { hasText: 'outside the loaded data' }).waitFor();
    });
    await ctx.screenshot('refused');
    await ctx.step('clear the range', async () => {
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Clear range' }).click();
      await page.getByRole('button', { name: 'Clear range' }).waitFor({ state: 'detached' });
      await page.waitForTimeout(600);
    });
    await ctx.screenshot('cleared');
  },
};
