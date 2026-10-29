import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';
import { CLOSED_LIB_PATH, CLOSED_LIB_SOURCE } from '../../fake-upstream/pine-libraries.ts';

const fetchedScript = `//@version=6
indicator("Open library demo", overlay=true)
import alice/OpenLib/1 as lib
len = input.int(5, "Len")
plot(lib.smooth(close, len), "Smooth")
`;

const closedScript = `//@version=6
indicator("Closed library demo", overlay=true)
import ${CLOSED_LIB_PATH} as lib
len = input.int(5, "Len")
plot(lib.mid(high, low), "Mid")
`;

export const pineLibraries: Scenario = {
  name: 'pine-libraries',
  description: 'Pine libraries: a script importing an open-source TradingView library runs, a closed-source one shows the error and Paste library, and the pasted copy makes it run',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const setSource = async (text: string) => {
      await page.locator('.pine-pane .pine-editor .cm-content').click();
      await page.keyboard.press('Control+A');
      // insertText avoids closeBrackets mangling typed text
      await page.keyboard.insertText(text);
    };
    const dialog = page.locator('.modal', { has: page.getByRole('heading', { name: 'Pine libraries' }) });

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add a Pine indicator', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await page.getByRole(narrow ? 'dialog' : 'region', { name: 'Pine editor' }).waitFor();
      await page.locator('.pine-pane .pine-editor .cm-content').waitFor();
    });
    await ctx.step('a script importing an open-source library runs (fetched through the server)', async () => {
      await setSource(fetchedScript);
      await page.locator('.pine-entry .indicator-params').getByText('Len').waitFor();
      await page.locator('.pine-error').waitFor({ state: 'detached' });
    });
    await ctx.screenshot('fetched');
    await ctx.step('a closed-source library names itself and offers Paste library', async () => {
      await setSource(closedScript);
      await page.locator('.pine-error').filter({ hasText: `Library "${CLOSED_LIB_PATH}" could not be loaded` }).waitFor();
      await page.getByRole('button', { name: 'Paste library' }).waitFor();
    });
    await ctx.screenshot('missing');
    await ctx.step('Paste library opens the dialog with the path filled in', async () => {
      await page.getByRole('button', { name: 'Paste library' }).click();
      await dialog.waitFor();
      const value = await dialog.getByLabel('Path').inputValue();
      if (value !== CLOSED_LIB_PATH) throw new Error(`the path field holds "${value}"`);
    });
    await ctx.screenshot('dialog');
    await ctx.step('paste the source and save: it is listed as Pasted and the script runs', async () => {
      await dialog.locator('.cm-content').click();
      await page.keyboard.insertText(CLOSED_LIB_SOURCE);
      await dialog.getByRole('button', { name: 'Save library' }).click();
      await dialog.getByRole('list', { name: 'Stored libraries' }).getByText('Pasted').waitFor();
      await page.locator('.pine-error').waitFor({ state: 'detached' });
      await page.locator('.pine-entry .indicator-params').getByText('Len').waitFor();
    });
    await ctx.screenshot('pasted');
    await ctx.step('closing the dialog leaves the script running', async () => {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      if ((await page.locator('.pine-error').count()) !== 0) throw new Error('the script shows an error');
    });
    // The server keeps the paste, so remove it: the next viewport (and a rerun) starts from the missing library.
    await ctx.step('Remove drops the pasted copy and the script shows the error again', async () => {
      await page.getByRole('button', { name: 'Libraries', exact: true }).click();
      await dialog.getByRole('button', { name: `Remove ${CLOSED_LIB_PATH}` }).click();
      await dialog.getByRole('button', { name: `Remove ${CLOSED_LIB_PATH}` }).waitFor({ state: 'detached' });
      await page.locator('.pine-error').filter({ hasText: `Library "${CLOSED_LIB_PATH}" could not be loaded` }).waitFor();
    });
    await ctx.screenshot('removed');
  },
};
