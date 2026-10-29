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
    await ctx.step('quotes load for rows other than the chart symbol and in the card', async () => {
      const priced = panel.locator('.wl-row:not(.wl-head):not(.active) .wl-quote', { hasText: /\d/ });
      await priced.first().waitFor({ state: 'visible' });
      await page.locator('.symbol-card .sc-last').waitFor({ state: 'visible' });
    });
    await ctx.screenshot('quotes');
    await page.locator('.symbol-card').scrollIntoViewIfNeeded();
    await ctx.screenshot('card');
    await panel.scrollIntoViewIfNeeded();
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
    await ctx.step('card stays pinned while the list scrolls', async () => {
      await page.setViewportSize({ width: 1440, height: 560 });
      for (let i = 0; i < 12; i++) {
        page.once('dialog', (d) => void d.accept(`Section ${i + 1}`));
        await panel.getByTitle('Add section').click();
        await panel.locator('.wl-section-head', { hasText: `Section ${i + 1}` }).waitFor({ state: 'visible' });
      }
      const measure = () =>
        page.evaluate(() => {
          const wl = document.querySelector('.watchlist') as HTMLElement;
          const card = document.querySelector('.symbol-card') as HTMLElement;
          const sb = document.querySelector('.sidebar') as HTMLElement;
          const c = card.getBoundingClientRect();
          return { top: c.top, bottom: c.bottom, sidebarBottom: sb.getBoundingClientRect().bottom, sh: wl.scrollHeight, ch: wl.clientHeight };
        });
      const before = await measure();
      await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const after = await measure();
      if (!(after.sh > after.ch)) throw new Error(`watchlist does not overflow (${after.sh} <= ${after.ch})`);
      if (before.top !== after.top) throw new Error(`card moved while scrolling: ${before.top} -> ${after.top}`);
      if (after.bottom > after.sidebarBottom + 0.5) throw new Error(`card bottom ${after.bottom} is below the sidebar ${after.sidebarBottom}`);
    });
    await ctx.screenshot('pinned-card');
  },
};
