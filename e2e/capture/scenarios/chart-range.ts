import type { Scenario } from '../scenario.ts';

export const chartRange: Scenario = {
  name: 'chart-range',
  description: 'Top bar Range control on demo data: normal label, a range applied, a refused range, a span fetched from before the loaded data, then cleared',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    // Where the top bar is narrow the Range control lives in the More menu.
    const more = page.getByRole('button', { name: 'More', exact: true });
    const menuOpen = async () => (await more.count()) > 0 && (await more.getAttribute('aria-expanded')) === 'true';
    const openMenu = async () => {
      if ((await more.count()) > 0 && !(await menuOpen())) await more.click();
    };
    const closeMenu = async () => {
      if (await menuOpen()) await more.click();
    };
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.screenshot('before');
    await ctx.step('apply a range', async () => {
      await openMenu();
      await page.getByRole('button', { name: 'Range', exact: true }).click();
      await page.getByLabel('Chart range From').fill('2022-03-01T00:00');
      await page.getByLabel('Chart range To').fill('2022-09-30T00:00');
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.getByRole('button', { name: 'Clear range' }).waitFor();
      await page.waitForTimeout(600);
    });
    await ctx.step('close the menu', closeMenu);
    await ctx.screenshot('applied');
    await ctx.step('refuse a range after the last bar', async () => {
      await openMenu();
      await page.getByRole('button', { name: 'Range on' }).click();
      await page.getByLabel('Chart range From').fill('2099-01-01T00:00');
      await page.getByLabel('Chart range To').fill('2022-09-30T00:00');
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.locator('.toast', { hasText: 'From is later than To' }).waitFor();
    });
    await ctx.screenshot('refused');
    await ctx.step('fetch a range before the loaded data', async () => {
      await page.getByLabel('Chart range From').fill('2005-01-01T00:00');
      await page.getByLabel('Chart range To').fill('2006-12-31T00:00');
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.getByRole('dialog', { name: 'Chart range' }).waitFor({ state: 'detached' });
      await page.getByText('2005', { exact: false }).first().waitFor();
      await page.waitForTimeout(600);
    });
    await ctx.screenshot('fetched');
    await ctx.step('clear the range', async () => {
      await openMenu();
      await page.getByRole('button', { name: 'Clear range' }).click();
      await page.getByRole('button', { name: 'Clear range' }).waitFor({ state: 'detached' });
      await page.waitForTimeout(600);
    });
    await ctx.step('close the menu again', closeMenu);
    await ctx.screenshot('cleared');
  },
};
