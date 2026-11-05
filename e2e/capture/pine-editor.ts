import type { Page } from 'playwright';

/** Clicks Add to chart in the Pine pane, which puts the edited script on the chart. */
export async function addToChart(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add to chart' }).click();
}

/**
 * Replaces the text of the Pine pane's editor and puts it on the chart: edits are only a draft until Add to chart.
 * insertText avoids closeBrackets mangling typed text.
 */
export async function setPineSource(page: Page, text: string): Promise<void> {
  await page.locator('.pine-pane .pine-editor .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
  await addToChart(page);
}
