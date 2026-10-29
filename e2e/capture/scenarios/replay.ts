import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

export const replay: Scenario = {
  name: 'replay',
  description: 'Bar replay on demo data: before, Replay clicked (start-bar hint), a bar clicked, stepped forward and back, an oscillator Pine indicator in its own pane filling while played at 10x, paused, then exited back to the same chart',
  video: true,
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    // Where the top bar is narrow the Replay button lives in the More menu.
    const more = page.getByRole('button', { name: 'More', exact: true });
    const strip = page.getByRole('toolbar', { name: 'Replay' });
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add an oscillator Pine indicator in its own pane', async () => {
      if (narrow) {
        await page.getByRole('button', { name: 'Toggle sidebar' }).click();
        await page.getByRole('dialog', { name: 'Sidebar' }).waitFor();
      }
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await page.locator('.pine-pane .pine-editor .cm-content').waitFor();
      await page.locator('.pine-editor .cm-content').click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('//@version=5\nindicator("RSI", overlay=false)\nplot(ta.rsi(close, 14))\n');
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
      await page.waitForTimeout(1200);
    });
    await ctx.screenshot('before');
    await ctx.step('click Replay', async () => {
      if ((await more.count()) > 0) {
        await more.click();
        await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: 'Replay', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Replay', exact: true }).click();
      }
      await strip.getByText('Click a bar to start replay').waitFor();
    });
    await ctx.screenshot('picking');
    await ctx.step('click a bar mid-chart', async () => {
      const box = await page.locator('.chart-container canvas').first().boundingBox();
      if (!box) throw new Error('no chart canvas');
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await strip.getByRole('button', { name: 'Exit replay' }).waitFor();
      await page.waitForTimeout(600);
    });
    await ctx.screenshot('start');
    await ctx.step('step forward 5 and back 2', async () => {
      for (let i = 0; i < 5; i++) await strip.getByRole('button', { name: 'Step forward' }).click();
      for (let i = 0; i < 2; i++) await strip.getByRole('button', { name: 'Step back' }).click();
      await page.waitForTimeout(600);
    });
    await ctx.screenshot('stepped');
    await ctx.step('play at 10x for a second, then pause', async () => {
      await strip.getByLabel('Replay speed').selectOption('10');
      await strip.getByRole('button', { name: 'Play', exact: true }).click();
      await page.waitForTimeout(700);
      await ctx.screenshot('playing');
      await page.waitForTimeout(300);
      await strip.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.waitForTimeout(400);
    });
    await ctx.screenshot('played');
    await ctx.step('exit replay', async () => {
      await strip.getByRole('button', { name: 'Exit replay' }).click();
      await page.getByRole('toolbar', { name: 'Quick ranges' }).waitFor();
      await page.waitForTimeout(600);
    });
    await ctx.screenshot('exited');
  },
};
