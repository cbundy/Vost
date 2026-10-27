import type { Scenario } from '../scenario.ts';

export const pineTab: Scenario = {
  name: 'pine-tab',
  description: 'Pine tab in the bottom dock: add through the sidebar, edit, error, collapsed then Edit, empty state',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add a Pine indicator', async () => {
      await page.locator('#add-indicator-select').selectOption('pine');
      await page.locator('.pine-editor .cm-content').waitFor();
    });
    await ctx.screenshot('sidebar-edit');
    await ctx.screenshot('editor');
    await ctx.step('type a syntax error', async () => {
      await page.locator('.pine-editor .cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('\nplot(1 +');
      await page.locator('.pine-error').waitFor();
    });
    await ctx.screenshot('error');
    await ctx.step('collapse the dock and click Edit', async () => {
      await page.getByTitle('Collapse').click();
      await page.locator('.pine-editor').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: /^Edit .* source$/ }).click();
      await page.locator('.pine-editor .cm-content').waitFor();
    });
    await ctx.screenshot('collapsed-edit');
    await ctx.step('remove the indicator', async () => {
      await page.getByTitle('Remove').last().click();
      await page.locator('.pine-empty').waitFor();
    });
    await ctx.screenshot('empty');
  },
};
