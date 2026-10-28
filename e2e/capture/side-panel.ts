import type { Page } from 'playwright';

/**
 * Shows one section of the side panel: the rail button on desktop (opening the panel if collapsed),
 * or the drawer's section button when the drawer is open. A button that is already pressed is left alone,
 * because clicking the active rail button collapses the panel.
 */
export async function showSideSection(page: Page, name: 'Watchlist' | 'Data and library' | 'Indicators', drawer: boolean): Promise<void> {
  const scope = drawer ? page.getByRole('dialog', { name: 'Sidebar' }) : page.getByRole('toolbar', { name: 'Side panel' });
  const button = scope.getByRole('button', { name, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await page.locator('#sidebar').waitFor();
}
