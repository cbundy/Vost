import type { Scenario } from '../scenario.ts';

export const chartPan: Scenario = {
  name: 'chart-pan',
  description: 'Video of the chart being dragged (panned) with the mouse',
  video: true,
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('pan chart', async () => {
      const box = await page.locator('.chart-container').boundingBox();
      if (!box) throw new Error('chart container has no box');
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.7, y);
      await page.waitForTimeout(500);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.2, y, { steps: 40 });
      await page.waitForTimeout(400);
      await page.mouse.move(box.x + box.width * 0.6, y, { steps: 40 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    });
  },
};
