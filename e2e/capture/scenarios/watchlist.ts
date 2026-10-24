import type { Scenario } from '../scenario.ts';

export const watchlist: Scenario = {
  name: 'watchlist',
  description: 'Video and screenshots of the watchlist: add the symbol, add a section, drag the symbol into it',
  video: true,
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const panel = page.locator('.watchlist');
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('show watchlist', () => panel.waitFor({ state: 'visible' }));
    await ctx.screenshot('initial');
    await ctx.step('add current symbol', async () => {
      await panel.getByTitle('Add current symbol').click();
      await panel.locator('.wl-row', { hasText: 'DEMO' }).first().waitFor({ state: 'visible' });
    });
    await ctx.step('add section', async () => {
      page.once('dialog', (d) => void d.accept('Favourites'));
      await panel.getByTitle('Add section').click();
      await panel.locator('.wl-section-head', { hasText: 'Favourites' }).waitFor({ state: 'visible' });
    });
    await ctx.screenshot('with-section');
    await ctx.step('drag symbol into section', async () => {
      await page.waitForTimeout(500);
      await panel.locator('.wl-row', { hasText: 'DEMO' }).first().dragTo(
        panel.locator('.wl-section', { hasText: 'Favourites' }).locator('.wl-section-head'),
      );
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('after-drag');
  },
};
