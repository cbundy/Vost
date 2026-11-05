import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const SMA_COLOR = '#f59e0b';

/** Pixels of `hex` on the chart canvases: 0 when its series is not drawn. */
async function pixels(page: Page, hex: string): Promise<number> {
  return page.evaluate((h) => {
    const rgb = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    let n = 0;
    for (const c of document.querySelectorAll<HTMLCanvasElement>('.chart-container canvas')) {
      const ctx = c.getContext('2d');
      if (!ctx || c.width === 0 || c.height === 0) continue;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2] && d[i + 3] > 200) n++;
    }
    return n;
  }, hex);
}

export const indicatorLegend: Scenario = {
  name: 'indicator-legend',
  description:
    'Indicator legend rows on the chart: the default chart lists Volume and SMA 20 under the OHLC legend, a hovered row shows its eye, gear, Pine source and trash buttons and a "..." menu (closed by Escape), the eye hides the SMA (dimmed row, series gone) and shows it again, the gear opens the settings dialog, a hidden RSI keeps a dimmed row on the price pane, the {} button of a Pine row opens the editor, trash drops the row, and a drag started just below the rows still pans; desktop and narrow',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const log: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      log.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail} :: ${log.slice(-3).join(' // ')}`);
    };
    const rows = page.locator('.legend-row');
    const rowOf = (name: string) => rows.filter({ hasText: name });
    const btn = (label: string) => page.getByRole('button', { name: label, exact: true });
    const rowTexts = async () => (await rows.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    const settleRows = async (n: number) => {
      await page.waitForFunction((k) => document.querySelectorAll('.legend-row').length === k, n);
      await page.waitForTimeout(400);
    };
    const closeDrawer = async () => {
      if (!narrow) return;
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' }).catch(() => {});
    };
    const editor = page.getByRole(narrow ? 'dialog' : 'region', { name: 'Pine editor' });
    /** The bar time under the chart's centre: stands for the visible range. */
    const centreBar = async () => {
      const box = (await page.locator('.chart-container').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30);
      await page.waitForTimeout(250);
      await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 30);
      await page.waitForTimeout(400);
      return (await page.locator('.chart-legend .legend-sub span').last().innerText()).trim();
    };

    await ctx.step('open app', async () => {
      await page.goto('/');
    });
    await ctx.waitForChart();

    await ctx.step('the default chart lists Volume and SMA 20 under the OHLC legend', async () => {
      await settleRows(2);
      const texts = await rowTexts();
      check('two rows in list order', texts.length === 2 && texts[0].startsWith('Volume') && texts[1].startsWith('SMA 20'), texts.join(' | '));
      check('values shown (not na)', texts.every((t) => /\d/.test(t.replace(/SMA 20|Volume/, ''))), texts.join(' | '));
      const labels = await page.locator('.legend-row button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      log.push(`buttons: ${labels.join(', ')}`);
      check('every button has an aria-label naming the action and the indicator', labels.length === 8 && labels.every((l) => /^(Volume|SMA 20) - (Hide|Settings|Remove|More)$/.test(l ?? '')), labels.join(', '));
      const titles = await page.locator('.legend-row button').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
      check('every button has a title', titles.every(Boolean));
      const pe = await page.evaluate(() => {
        const g = (s: string) => {
          const el = document.querySelector(s);
          return el ? getComputedStyle(el).pointerEvents : 'missing';
        };
        return { legend: g('.chart-legend'), rows: g('.legend-rows'), paneLegends: g('.pane-legends'), row: g('.legend-row'), head: g('.legend-head') };
      });
      log.push(`pointer-events: ${JSON.stringify(pe)}`);
      check('containers click through, rows take events', pe.legend === 'none' && pe.rows === 'none' && pe.paneLegends === 'none' && pe.row === 'auto', JSON.stringify(pe));
      const box = await page.locator('.chart-container').boundingBox();
      const r = await rows.last().boundingBox();
      check('rows stay inside the chart', !!box && !!r && r.x >= box.x && r.x + r.width <= box.x + box.width - 40, `${JSON.stringify(r)} in ${JSON.stringify(box)}`);
    });
    await ctx.screenshot('rows');

    await ctx.step('a hovered row shows its buttons', async () => {
      const row = rowOf('SMA 20');
      const before = await row.locator('.legend-actions').evaluate((el) => getComputedStyle(el).opacity);
      await row.locator('.legend-row-name').hover();
      await page.waitForTimeout(200);
      const after = await row.locator('.legend-actions').evaluate((el) => getComputedStyle(el).opacity);
      log.push(`actions opacity ${before} -> ${after}`);
      check('buttons appear on hover', Number(after) === 1);
    });
    await ctx.screenshot('hover');

    await ctx.step('the ... menu lists the choices and Escape closes it', async () => {
      await btn('SMA 20 - More').click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      const items = await menu.getByRole('menuitem').allTextContents();
      check('menu items', items.join('|') === 'Settings...|Hide|Remove', items.join('|'));
      await ctx.screenshot('menu');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      await btn('SMA 20 - More').click();
      await menu.waitFor();
      await page.mouse.click(5, 300);
      await menu.waitFor({ state: 'detached' });
      check('an outside click closes it too', true);
    });

    await ctx.step('the eye hides the SMA (dimmed row, series gone) and shows it again', async () => {
      const on = await pixels(page, SMA_COLOR);
      check('the SMA is drawn', on > 0, String(on));
      await rowOf('SMA 20').locator('.legend-row-name').hover();
      await btn('SMA 20 - Hide').click();
      await page.waitForTimeout(600);
      const off = await pixels(page, SMA_COLOR);
      const hiddenRow = page.locator('.legend-row.is-hidden');
      const text = (await hiddenRow.textContent())?.trim() ?? '';
      log.push(`SMA pixels ${on} -> ${off}; hidden row "${text}"`);
      check('the SMA series is gone', off === 0, String(off));
      check('its row is dimmed with na values', (await hiddenRow.count()) === 1 && /^SMA 20\s*-$/.test(text), text);
      check('the row keeps its place (2 rows)', (await rows.count()) === 2);
      await ctx.screenshot('hidden');
      await hiddenRow.locator('.legend-row-name').hover();
      await btn('SMA 20 - Show').click();
      await page.waitForTimeout(600);
      const back = await pixels(page, SMA_COLOR);
      check('Show draws the SMA again', back > 0 && (await page.locator('.legend-row.is-hidden').count()) === 0, String(back));
    });

    await ctx.step('the gear opens the settings dialog of that indicator', async () => {
      await rowOf('SMA 20').locator('.legend-row-name').hover();
      await btn('SMA 20 - Settings').click();
      const dlg = page.getByRole('dialog');
      await dlg.waitFor();
      check('titled SMA', /SMA/.test((await dlg.getByRole('heading').first().textContent()) ?? ''));
      await ctx.screenshot('settings');
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' });
      await rowOf('SMA 20').locator('.legend-row-name').dblclick();
      await dlg.waitFor();
      check('a double click on the name opens it too', true);
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' });
    });

    await ctx.step('a drag started just below the rows still pans', async () => {
      const box = (await page.locator('.chart-container').boundingBox())!;
      const last = (await rows.last().boundingBox())!;
      const y = last.y + last.height + 14;
      const before = await centreBar();
      await page.mouse.move(box.x + 80, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 8, y, { steps: 1 });
      await page.mouse.move(box.x + 8 + box.width * 0.4, y, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      const after = await centreBar();
      log.push(`bar under the centre: ${before} -> ${after}`);
      check('the visible range moved', before !== after, `${before} -> ${after}`);
    });

    await ctx.step('a hidden RSI keeps a dimmed row on the price pane', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('rsi');
      await closeDrawer();
      await page.locator('.pane-legend').waitFor();
      await page.waitForTimeout(500);
      const sub = (await page.locator('.pane-legend').textContent())?.replace(/\s+/g, ' ').trim() ?? '';
      check('the RSI has its pane legend', /^RSI 14\s*[\d-]/.test(sub), sub);
      check('and no price-pane row', (await rows.count()) === 2);
      await page.locator('.pane-legend .pane-legend-title').hover();
      await btn('RSI 14 - Hide').click();
      await settleRows(3);
      check('the pane is gone', (await page.locator('.pane-legend').count()) === 0);
      const texts = await rowTexts();
      check('a dimmed RSI row is listed last', texts[2]?.startsWith('RSI 14') && (await page.locator('.legend-row.is-hidden').count()) === 1, texts.join(' | '));
      await ctx.screenshot('rsi-hidden');
      await page.locator('.legend-row.is-hidden .legend-row-name').hover();
      await btn('RSI 14 - Show').click();
      await settleRows(2);
      await page.locator('.pane-legend').waitFor();
      check('Show brings the pane back', true);
    });

    await ctx.step('{} on a Pine row opens the editor', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await editor.waitFor();
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await editor.waitFor({ state: 'detached' });
      await closeDrawer();
      await settleRows(3);
      const texts = await rowTexts();
      check('the Pine row shows its title and inputs', /^EMA cross 9 21/.test(texts[2] ?? ''), texts.join(' | '));
      await rowOf('EMA cross').locator('.legend-row-name').hover();
      await btn('EMA cross 9 21 - Source code').click();
      await editor.waitFor();
      check('the editor opened', true);
      await ctx.screenshot('pine-source');
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await editor.waitFor({ state: 'detached' });
    });

    await ctx.step('trash drops the row', async () => {
      await rowOf('SMA 20').locator('.legend-row-name').hover();
      await btn('SMA 20 - Remove').click();
      await settleRows(2);
      const texts = await rowTexts();
      check('the SMA row is gone', !texts.some((t) => t.startsWith('SMA 20')), texts.join(' | '));
      check('and its series', (await pixels(page, SMA_COLOR)) === 0);
      await ctx.screenshot('removed');
    });

    await ctx.writeText('checks', log.join('\n') + '\n');
  },
};
