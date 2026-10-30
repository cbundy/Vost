import { readFileSync } from 'node:fs';
import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../client/src/lib/pine/fixtures/${name}.pine`, import.meta.url), 'utf8');

export const pineRender: Scenario = {
  name: 'pine-render',
  description: 'Pine shapes: a separate-pane script draws its shapes and characters in its own pane (none on the candles); an overlay script keeps them on the candles',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const pane = page.getByRole(narrow ? 'dialog' : 'region', { name: 'Pine editor' });
    const setSource = async (text: string) => {
      await page.locator('.pine-pane .pine-editor .cm-content').click();
      await page.keyboard.press('Control+A');
      // insertText avoids closeBrackets mangling typed text
      await page.keyboard.insertText(text);
      await page.locator('.pine-error').waitFor({ state: 'detached' });
    };
    const closeEditor = async () => {
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await pane.waitFor({ state: 'detached' });
    };
    const reopenEditor = async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.getByRole('button', { name: /^Edit .* source$/ }).click();
      await pane.waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add a Pine indicator', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await pane.waitFor();
      await page.locator('.pine-pane .pine-editor .cm-content').waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    });
    await ctx.step('a separate-pane script with a shape and a character', async () => {
      await setSource(fixture('pane-shapes'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('pane');
    await ctx.step('an overlay script keeps its shapes on the candles', async () => {
      await reopenEditor();
      await setSource(fixture('overlays'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('overlay');
  },
};
