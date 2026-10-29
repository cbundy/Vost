import type { Page } from 'playwright';

/**
 * Shows one section of the side panel. On desktop it clicks the rail button (opening the panel if collapsed).
 * In drawer mode, with the drawer closed it clicks the rail button, which opens the drawer on that section;
 * with the drawer open it uses the drawer's own section button. A button that is already pressed is left alone,
 * because clicking the active desktop rail button collapses the panel.
 */
export async function showSideSection(page: Page, name: 'Watchlist' | 'Data and library' | 'Indicators', drawer: boolean): Promise<void> {
  const drawerOpen = drawer && (await page.getByRole('dialog', { name: 'Sidebar' }).count()) > 0;
  const scope = drawerOpen ? page.getByRole('dialog', { name: 'Sidebar' }) : page.getByRole('toolbar', { name: 'Side panel' });
  const button = scope.getByRole('button', { name, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await page.locator('#sidebar').waitFor();
}
