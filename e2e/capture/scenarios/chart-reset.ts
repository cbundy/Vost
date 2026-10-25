import type { Scenario } from '../scenario.ts';

export const chartReset: Scenario = {
  name: 'chart-reset',
  description: 'Video of pan, zoom and price-axis drag, then the Reset view button restoring the fresh view',
  video: true,
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.screenshot('fresh');
    await ctx.step('move the view', async () => {
      const box = await page.locator('.chart-container').boundingBox();
      if (!box) throw new Error('chart container has no box');
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.6, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.3, y, { steps: 30 });
      await page.mouse.up();
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(300);
      // drag the right price axis vertically
      const ax = box.x + box.width - 25;
      await page.mouse.move(ax, y);
      await page.mouse.down();
      await page.mouse.move(ax, y - 80, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    });
    await ctx.screenshot('moved');
    await ctx.step('click Reset view', async () => {
      await page.locator('button[title="Reset view"]').click();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('reset');
  },
};
