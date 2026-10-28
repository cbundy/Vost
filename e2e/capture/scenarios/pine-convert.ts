import { readFileSync } from 'node:fs';
import type { Scenario } from '../scenario.ts';

const legacy = readFileSync(new URL('../../../client/src/lib/pine/fixtures/legacy-wavetrend.pine', import.meta.url), 'utf8');

export const pineConvert: Scenario = {
  name: 'pine-convert',
  description: 'Old Pine (LazyBear WaveTrend): the plain message with Convert to v6, then the converted script running',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add a Pine indicator', async () => {
      if (viewport === 'narrow') {
        await page.getByRole('button', { name: 'Toggle sidebar' }).click();
        await page.getByRole('dialog', { name: 'Sidebar' }).waitFor();
      }
      await page.locator('#add-indicator-select').selectOption('pine');
      if (viewport === 'narrow') {
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
      }
      await page.locator('.pine-editor .cm-content').waitFor();
    });
    await ctx.step('paste the old script', async () => {
      await page.locator('.pine-editor .cm-content').click();
      await page.keyboard.press('Control+A');
      // insertText avoids closeBrackets mangling typed text
      await page.keyboard.insertText(legacy);
      await page.locator('.pine-error').waitFor();
    });
    await ctx.screenshot('legacy');
    await ctx.step('convert to v6', async () => {
      await page.getByRole('button', { name: 'Convert to v6' }).click();
      await page.locator('.pine-convert-note').waitFor();
      await page.locator('.pine-error').waitFor({ state: 'detached' });
      await page.locator('.pine-entry .indicator-params').waitFor();
    });
    await ctx.screenshot('converted');
  },
};
