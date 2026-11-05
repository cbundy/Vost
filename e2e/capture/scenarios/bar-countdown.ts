import type { Scenario } from '../scenario.ts';

export const barCountdown: Scenario = {
  name: 'bar-countdown',
  description: 'The demo chart at 1m and 1h shows a countdown label under the last price that ticks each second; turning "Countdown to bar close" off in Settings removes it',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const notes: string[] = [];
    const axis = async () => {
      const box = await page.locator('.chart-container').first().boundingBox();
      if (!box) throw new Error('no chart box');
      return page.screenshot({ clip: { x: box.x + box.width - 90, y: box.y, width: 90, height: box.height } });
    };
    const ticks = async (label: string) => {
      const a = await axis();
      await page.waitForTimeout(2200);
      const b = await axis();
      const moved = !a.equals(b);
      notes.push(`${label}: price-axis pixels changed over 2.2 s: ${moved}`);
      if (!moved) throw new Error(`${label}: the countdown did not tick`);
    };
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    const timeframe = page.locator('.topbar select[title="Timeframe"]');
    for (const tf of ['1m', '1h']) {
      await ctx.step(`timeframe ${tf}`, async () => {
        await timeframe.selectOption(tf);
        await page.waitForTimeout(1200);
      });
      await ctx.step(`the label ticks at ${tf}`, () => ticks(tf));
      await ctx.screenshot(tf);
    }
    await ctx.step('turn the countdown off in Settings', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
      await dialog.getByLabel(/Countdown to bar close/).uncheck();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await page.waitForTimeout(1500);
    });
    await ctx.step('the label is gone', async () => {
      const a = await axis();
      await page.waitForTimeout(2200);
      const still = (await axis()).equals(a);
      notes.push(`off: price-axis pixels unchanged over 2.2 s: ${still}`);
      if (!still) throw new Error('the axis still changes with the countdown off');
    });
    await ctx.screenshot('off');
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
