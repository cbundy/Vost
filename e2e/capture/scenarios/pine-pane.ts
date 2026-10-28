import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

export const pinePane: Scenario = {
  name: 'pine-pane',
  description: 'Pine editor pane beside the chart (a dialog when narrow): add through the side panel, edit, error, close then Edit, top bar toggle, keyboard resize, empty state',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const pane = page.getByRole(narrow ? 'dialog' : 'region', { name: 'Pine editor' });
    const toggle = page.getByRole('button', { name: 'Pine Editor', exact: true });
    const openSidebar = async () => {
      if (narrow) {
        await page.getByRole('button', { name: 'Toggle sidebar' }).click();
        await page.getByRole('dialog', { name: 'Sidebar' }).waitFor();
      }
      await showSideSection(page, 'Indicators', narrow);
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add a Pine indicator', async () => {
      await openSidebar();
      await page.locator('#add-indicator-select').selectOption('pine');
      await pane.waitFor();
      await page.locator('.pine-pane .pine-editor .cm-content').waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    });
    await ctx.screenshot('editor');
    await ctx.step('the status line shows the cursor and the version', async () => {
      await page.locator('.pine-status').getByText(/^Ln \d+, Col \d+$/).waitFor();
      await page.locator('.pine-status').getByText(/^Pine v\d+$|^no version$/).waitFor();
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') throw new Error('the Pine Editor button is not pressed');
    });
    await ctx.step('type a syntax error', async () => {
      await page.locator('.pine-editor .cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('\nplot(1 +');
      await page.locator('.pine-error').waitFor();
    });
    await ctx.screenshot('error');
    await ctx.step('close, then Edit reopens it', async () => {
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await pane.waitFor({ state: 'detached' });
      await openSidebar();
      await page.getByRole('button', { name: /^Edit .* source$/ }).click();
      await pane.waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    });
    await ctx.screenshot('reopened');
    if (narrow) {
      await ctx.step('Escape closes the dialog and focus returns to the top bar button', async () => {
        await page.keyboard.press('Escape');
        await pane.waitFor({ state: 'detached' });
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
        if (focused !== 'Pine Editor') throw new Error(`focus is on "${focused}", not the Pine Editor button`);
      });
      await ctx.step('the top bar button opens it again', async () => {
        await toggle.click();
        await pane.waitFor();
      });
    } else {
      await ctx.step('the top bar button closes and opens it', async () => {
        await toggle.click();
        await pane.waitFor({ state: 'detached' });
        await toggle.click();
        await pane.waitFor();
      });
      await ctx.step('resize by keyboard', async () => {
        const width = async () => (await pane.boundingBox())!.width;
        const before = await width();
        await page.getByRole('separator', { name: 'Resize Pine editor' }).focus();
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        const grown = await width();
        if (grown <= before) throw new Error(`pane did not grow: ${before} then ${grown}`);
        await page.keyboard.press('Home');
        if ((await width()) >= grown) throw new Error('Home did not shrink the pane');
        await page.keyboard.press('End');
        const chart = (await page.locator('.chart-area').boundingBox())!.width;
        if (chart < 360 - 1) throw new Error(`chart is ${chart}px wide at the pane's maximum`);
      });
      await ctx.screenshot('resized');
    }
    await ctx.step('remove the indicator', async () => {
      if (narrow) await page.keyboard.press('Escape');
      await openSidebar();
      await page.getByTitle('Remove').last().click();
      if (narrow) {
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
        await toggle.click();
      }
      await pane.locator('.pine-empty').waitFor();
    });
    await ctx.screenshot('empty');
  },
};
