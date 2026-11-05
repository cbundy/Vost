import type { Locator, Page } from 'playwright';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'error';

/** The Live dot button, on the bar (wide screens) or in the More menu (narrow). Found by its data attribute, never by text. */
export function liveButton(page: Page): Locator {
  return page.locator('.topbar [data-live-status], .topbar-more-pop [data-live-status]').first();
}

/** Waits until the Live dot reports the given status. */
export async function waitLive(page: Page, status: LiveStatus, timeout = 20_000): Promise<void> {
  await page.locator(`.topbar [data-live-status="${status}"], .topbar-more-pop [data-live-status="${status}"]`).first().waitFor({ state: 'attached', timeout });
}

/** The Chart data pop-up (Range, Bars, Build, Load). */
export const chartDataDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Chart data' });

/** Opens the Chart data pop-up (a no-op when open) and returns it. */
export async function openChartData(page: Page): Promise<Locator> {
  const dialog = chartDataDialog(page);
  if ((await dialog.count()) === 0) await page.getByRole('button', { name: 'Chart data', exact: true }).click();
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/** Closes the Chart data pop-up with Escape (a no-op when closed). */
export async function closeChartData(page: Page): Promise<void> {
  const dialog = chartDataDialog(page);
  if ((await dialog.count()) === 0) return;
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
}
