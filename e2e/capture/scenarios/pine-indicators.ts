import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';
import { CLOSED_INDICATOR_SHORT_ID } from '../../fake-upstream/pine-indicators.ts';

export const pineIndicators: Scenario = {
  name: 'pine-indicators',
  description: 'TradingView indicators: search by name, add an open-source indicator, see its author and licence, open it in the editor, refuse a closed-source link, remove it',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const dialog = page.locator('.modal', { has: page.getByRole('heading', { name: 'TradingView indicators' }) });
    const openDialog = async () => {
      await page.getByRole('button', { name: 'TradingView indicators', exact: true }).click();
      await dialog.waitFor();
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('open the Pine pane: its head has the Libraries and TradingView indicators buttons', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await page.getByRole(narrow ? 'dialog' : 'region', { name: 'Pine editor' }).waitFor();
      await page.getByRole('button', { name: 'Libraries', exact: true }).waitFor();
    });
    await ctx.screenshot('pane-head');
    await ctx.step('open the dialog and search for Supertrend: only the open-source indicator is listed', async () => {
      await openDialog();
      await dialog.getByLabel('Search TradingView').fill('Supertrend');
      await dialog.getByRole('button', { name: 'Search', exact: true }).click();
      await dialog.getByRole('list', { name: 'Search results' }).getByText('Supertrend', { exact: true }).waitFor();
      const rows = await dialog.getByRole('list', { name: 'Search results' }).locator('li').count();
      if (rows !== 1) throw new Error(`the results list has ${rows} rows`);
    });
    await ctx.screenshot('search');
    await ctx.step('Add stores it: the result shows Added and the list shows author and licence', async () => {
      await dialog.getByRole('button', { name: /^Add Supertrend by alice/ }).click();
      await dialog.getByRole('list', { name: 'Search results' }).getByText('Added', { exact: true }).waitFor();
      const added = dialog.getByRole('list', { name: 'Added indicators' });
      await added.getByText('by alice').waitFor();
      await added.getByText(/Mozilla Public License/).waitFor();
    });
    await ctx.screenshot('added');
    await ctx.step('a closed-source link is refused with a clear reason', async () => {
      await dialog.getByLabel('Script link').fill(`https://www.tradingview.com/script/${CLOSED_INDICATOR_SHORT_ID}/`);
      await dialog.getByRole('button', { name: 'Add link' }).click();
      await dialog.getByRole('alert').filter({ hasText: 'closed-source' }).waitFor();
    });
    await ctx.screenshot('closed-source');
    await ctx.step('Open in editor adds the script to the chart and shows its code', async () => {
      await dialog.getByRole('button', { name: 'Open Supertrend in editor' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.locator('.pine-pane .pine-editor .cm-content').getByText('ta.supertrend').waitFor();
    });
    await ctx.screenshot('opened');
    // The server keeps the copy, so remove it: the next viewport (and a rerun) starts empty.
    await ctx.step('Remove drops the stored copy', async () => {
      await openDialog();
      await dialog.getByRole('button', { name: 'Remove Supertrend' }).click();
      await dialog.getByText('No TradingView indicators added yet.').waitFor();
    });
    await ctx.screenshot('removed');
  },
};
