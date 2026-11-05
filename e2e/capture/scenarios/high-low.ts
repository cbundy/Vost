import type { Scenario } from '../scenario.ts';

export const highLow: Scenario = {
  name: 'high-low',
  description: 'The demo chart shows High and Low labels on the price scale for the visible candles; zooming moves them, and turning "High and low price labels" off in Settings removes them',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const notes: string[] = [];
    const axis = async () => {
      const box = await page.locator('.chart-container').first().boundingBox();
      if (!box) throw new Error('no chart box');
      return page.screenshot({ clip: { x: box.x + box.width - 90, y: box.y, width: 90, height: box.height } });
    };
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await page.waitForTimeout(1200);
    const first = await axis();
    await ctx.screenshot('default');
    await ctx.step('zoom in', async () => {
      const box = await page.locator('.chart-container').first().boundingBox();
      if (!box) throw new Error('no chart box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -400);
      await page.waitForTimeout(1200);
    });
    const zoomed = await axis();
    const moved = !first.equals(zoomed);
    notes.push(`zoomed: price-axis pixels changed: ${moved}`);
    await ctx.screenshot('zoomed');
    if (!moved) throw new Error('the labels did not move with the zoom');
    await ctx.step('turn the labels off in Settings', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
      await dialog.getByLabel(/High and low price labels/).uncheck();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await page.waitForTimeout(1200);
    });
    const off = await axis();
    const changed = !zoomed.equals(off);
    notes.push(`off: price-axis pixels changed: ${changed}`);
    await ctx.screenshot('off');
    if (!changed) throw new Error('the axis did not change with the labels off');
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
