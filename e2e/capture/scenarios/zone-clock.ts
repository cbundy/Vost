import type { Scenario } from '../scenario.ts';

export const zoneClock: Scenario = {
  name: 'zone-clock',
  description: 'Dock clock, the open and filtered zone list, then every date after switching to Asia/Tehran',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.screenshot('clock');
    await ctx.step('open the zone list', async () => {
      await page.locator('.zone-clock-btn').click();
      await page.locator('.zone-row').first().waitFor();
    });
    await ctx.screenshot('list');
    await ctx.step('filter the list', async () => {
      await page.locator('.zone-search').fill('tehran');
      await page.locator('.zone-row', { hasText: 'Asia/Tehran' }).waitFor();
    });
    await ctx.screenshot('filtered');
    await ctx.step('pick Asia/Tehran', async () => {
      await page.keyboard.press('Enter');
      await page.locator('.zone-pop').waitFor({ state: 'detached' });
      await page.waitForTimeout(600);
    });
    await ctx.screenshot('tehran');
  },
};
