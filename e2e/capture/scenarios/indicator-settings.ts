import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const fixture = readFileSync(new URL('../../../client/src/lib/pine/fixtures/pane-legend.pine', import.meta.url), 'utf8');

interface Counts {
  /** Chart panes (the price pane plus every sub pane). */
  panes: number;
  /** Pane legends (one per sub pane). */
  legends: number;
  /** Pixels of the EMA's colour on the chart canvases: 0 when its series is not drawn. */
  emaPixels: number;
  legendTexts: string[];
}

/** What the chart draws, from the DOM and the canvases; `emaColor` is the EMA swatch's colour. */
async function count(page: Page, emaColor: string): Promise<Counts> {
  return page.evaluate((hex) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    let emaPixels = 0;
    for (const c of document.querySelectorAll<HTMLCanvasElement>('.chart-container canvas')) {
      const ctx = c.getContext('2d');
      if (!ctx || c.width === 0 || c.height === 0) continue;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2] && d[i + 3] > 200) emaPixels++;
    }
    const rows = [...document.querySelectorAll('.chart-container table tr')].filter((tr) => tr.querySelector('canvas'));
    const legendTexts = [...document.querySelectorAll('.pane-legend')].map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim());
    return { panes: rows.length, legends: legendTexts.length, emaPixels, legendTexts };
  }, emaColor);
}

export const indicatorSettings: Scenario = {
  name: 'indicator-settings',
  description:
    'Indicator settings: the gear button in the side panel opens a dialog with Inputs and Visibility tabs; a length edit shows on the chart and in the row, an out-of-range value is refused, Minutes off removes the EMA on a minute chart and it returns on an hour chart, an RSI hidden on minutes drops its pane while a Pine sub pane stays in place, Cancel and Escape restore, Save as default styles a new EMA and Reset settings goes back; desktop and 360 px',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const log: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      log.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail} :: ${log.slice(-3).join(' // ')}`);
    };
    const dialog = page.getByRole('dialog', { name: /^(EMA|RSI)$/ });
    const dlg = page.locator('.modal').filter({ has: page.getByRole('tab', { name: 'Visibility' }) });
    const row = (name: string) => page.locator('.indicator-item').filter({ hasText: name });
    const gear = (name: string) => page.getByRole('button', { name: `Settings ${name}` });
    const timeframe = async (tf: string) => {
      await page.locator('select[title="Timeframe"]').selectOption(tf);
      await page.waitForTimeout(1500);
    };
    let emaColor = '';
    let basePanes = 0;
    const counts = async (label: string) => {
      await page.waitForTimeout(400);
      const c = await count(page, emaColor);
      log.push(`${label}: panes=${c.panes} legends=${c.legends} emaPixels=${c.emaPixels} [${c.legendTexts.join(' | ')}]`);
      return c;
    };
    void dialog;

    await ctx.step('open app', async () => {
      await page.addInitScript(() => {
        if (!localStorage.getItem('vost.prefs.v1')) {
          localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'demo', symbol: 'DEMO', timeframe: '1d', dockHeight: 120, indicators: [] }));
        }
      });
      await page.goto('/');
    });
    await ctx.waitForChart();

    if (narrow) {
      await page.setViewportSize({ width: 360, height: 740 });
      await ctx.step('the dialog fits 360 px', async () => {
        await showSideSection(page, 'Indicators', true);
        await page.locator('#add-indicator-select').selectOption('ema');
        await gear('Exponential moving average').click();
        await dlg.waitFor();
        const d = await dlg.boundingBox();
        check('the dialog fits 360 px', !!d && d.x >= 0 && d.x + d.width <= 360, `x=${d?.x} width=${d?.width}`);
        check('nothing overflows sideways', await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        await ctx.screenshot('inputs');
        await dlg.getByRole('tab', { name: 'Visibility' }).click();
        await ctx.screenshot('visibility');
        await dlg.getByRole('button', { name: 'Defaults ▾' }).click();
        await ctx.screenshot('defaults');
        await page.keyboard.press('Escape');
        await dlg.waitFor({ state: 'detached' });
      });
      await ctx.writeText('checks', log.join('\n') + '\n');
      return;
    }

    const closeEditor = async () => {
      await page.locator('.pine-pane .pine-editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(fixture);
      await page.locator('.pine-error').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await page.getByRole('region', { name: 'Pine editor' }).waitFor({ state: 'detached' });
    };
    await ctx.step('add an EMA, an RSI and a Pine script with a sub pane', async () => {
      await showSideSection(page, 'Indicators', false);
      for (const kind of ['ema', 'rsi']) await page.locator('#add-indicator-select').selectOption(kind);
      emaColor = await row('Exponential moving average').locator('.indicator-color').evaluate((el) => {
        const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(getComputedStyle(el).backgroundColor)!;
        return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
      });
      await page.locator('#add-indicator-select').selectOption('pine');
      await closeEditor();
      await page.locator('.pane-legend').nth(1).waitFor();
      await page.waitForTimeout(800);
      const c = await counts('baseline on 1d');
      basePanes = c.panes;
      check('baseline: RSI and Pine legends, the EMA drawn', c.legends === 2 && c.panes >= 3 && c.emaPixels > 0);
    });
    await ctx.screenshot('chart');

    await ctx.step('the gear opens the dialog titled EMA with Inputs and Visibility tabs', async () => {
      const g = gear('Exponential moving average');
      check('gear title is Settings', (await g.getAttribute('title')) === 'Settings');
      await g.click();
      await dlg.waitFor();
      check('titled EMA', (await dlg.getByRole('heading').textContent()) === 'EMA');
      const tabs = await dlg.getByRole('tab').allTextContents();
      check('tabs Inputs, Visibility', tabs.join(',') === 'Inputs,Visibility', tabs.join(','));
    });

    await ctx.step('a length edit shows on the chart and in the row; an out-of-range value is refused', async () => {
      const before = (await counts('before length edit')).emaPixels;
      await dlg.getByLabel('Length', { exact: true }).fill('20');
      await page.waitForTimeout(500);
      const rowLen = await row('Exponential moving average').getByLabel('Length').inputValue();
      check('the row follows the dialog', rowLen === '20', rowLen);
      const after = (await counts('after length 20')).emaPixels;
      check('the chart redrew the EMA', after > 0 && after !== before, `${before} -> ${after}`);
      await dlg.getByLabel('Length', { exact: true }).fill('0');
      const msg = await dlg.getByRole('alert').textContent();
      check('0 is refused in place', /Enter a number from 1 to 2000/.test(msg ?? ''), msg ?? '');
      check('the row keeps 20', (await row('Exponential moving average').getByLabel('Length').inputValue()) === '20');
      await ctx.screenshot('inputs-refused');
      await dlg.getByLabel('Length', { exact: true }).fill('20');
      await ctx.screenshot('inputs');
    });

    await ctx.step('Cancel restores; Escape restores', async () => {
      await dlg.getByLabel('Length', { exact: true }).fill('77');
      await page.waitForTimeout(300);
      check('the row follows', (await row('Exponential moving average').getByLabel('Length').inputValue()) === '77');
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await dlg.waitFor({ state: 'detached' });
      const v = await row('Exponential moving average').getByLabel('Length').inputValue();
      check('Cancel put the opening length back (200)', v === '200', v);
      await gear('Exponential moving average').click();
      await dlg.getByLabel('Length', { exact: true }).fill('55');
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' });
      const w = await row('Exponential moving average').getByLabel('Length').inputValue();
      check('Escape put it back (200)', w === '200', w);
    });

    await ctx.step('Minutes off hides the EMA on a minute chart and it returns on an hour chart', async () => {
      await gear('Exponential moving average').click();
      await dlg.getByLabel('Length', { exact: true }).fill('20');
      await dlg.getByRole('tab', { name: 'Visibility' }).click();
      const boxes = await dlg.getByRole('checkbox').count();
      check('six kinds, all on', boxes === 6 && (await dlg.getByRole('checkbox', { checked: true }).count()) === 6);
      await dlg.getByLabel('Minutes', { exact: true }).uncheck();
      await ctx.screenshot('visibility');
      await dlg.getByRole('button', { name: 'OK' }).click();
      await dlg.waitFor({ state: 'detached' });
      await timeframe('1m');
      const m = await counts('EMA hidden on 1m');
      check('the EMA is gone on minutes', m.emaPixels === 0);
      await ctx.screenshot('hidden-minutes');
      await timeframe('1h');
      const h = await counts('EMA on 1h');
      check('the EMA is back on hours', h.emaPixels > 0);
      await timeframe('1d');
    });

    await ctx.step('an RSI hidden on minutes drops its pane; the Pine sub pane stays in place', async () => {
      await gear('RSI').click();
      await dlg.getByRole('tab', { name: 'Visibility' }).click();
      await dlg.getByLabel('Minutes', { exact: true }).uncheck();
      await dlg.getByRole('button', { name: 'OK' }).click();
      await dlg.waitFor({ state: 'detached' });
      const d = await counts('RSI hidden on minutes, on 1d');
      check('on days: all panes, 2 legends', d.panes === basePanes && d.legends === 2);
      await timeframe('1m');
      const m = await counts('on 1m');
      check('on minutes: one pane fewer, 1 legend, the Pine pane left', m.panes === basePanes - 1 && m.legends === 1 && /Momentum pair/.test(m.legendTexts[0] ?? ''), m.legendTexts.join('|'));
      await ctx.screenshot('rsi-hidden');
      await timeframe('1d');
      const back = await counts('back on 1d');
      check('back on days: all panes', back.panes === basePanes && back.legends === 2);
    });

    await ctx.step('Save as default styles a new EMA; Reset settings goes back', async () => {
      await gear('Exponential moving average').click();
      await dlg.getByRole('button', { name: 'Defaults ▾' }).click();
      await ctx.screenshot('defaults');
      await page.getByRole('menuitem', { name: 'Save as default' }).click();
      await dlg.getByRole('button', { name: 'OK' }).click();
      await dlg.waitFor({ state: 'detached' });
      await page.locator('#add-indicator-select').selectOption('ema');
      const second = page.locator('.indicator-item').filter({ hasText: 'Exponential moving average' }).nth(1);
      const v = await second.getByLabel('Length').inputValue();
      check('a new EMA starts from the saved length (20)', v === '20', v);
      await second.getByRole('button', { name: 'Settings Exponential moving average' }).click();
      await dlg.getByRole('tab', { name: 'Visibility' }).click();
      check('and hides on minutes', !(await dlg.getByLabel('Minutes', { exact: true }).isChecked()));
      await dlg.getByRole('button', { name: 'Defaults ▾' }).click();
      await page.getByRole('menuitem', { name: 'Reset settings' }).click();
      await dlg.getByRole('tab', { name: 'Inputs' }).click();
      check('Reset goes to the saved default (20)', (await dlg.getByLabel('Length', { exact: true }).inputValue()) === '20');
      await dlg.getByRole('button', { name: 'OK' }).click();
      await dlg.waitFor({ state: 'detached' });
      const prefs = await page.evaluate(() => localStorage.getItem('vost.prefs.v1'));
      await page.waitForTimeout(600);
      void prefs;
      const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('vost.prefs.v1'))) as string).indicatorDefaults;
      check('the default is stored in the prefs', saved?.ema?.params?.length === 20 && saved.ema.hideOn.join() === 'minutes', JSON.stringify(saved));
      await ctx.screenshot('new-ema');
    });

    await ctx.step('a Pine script has Inputs and no Save as default', async () => {
      await gear('Momentum pair').click();
      const pd = page.locator('.modal').filter({ has: page.getByRole('tab', { name: 'Visibility' }) });
      await pd.locator('.pine-inputs').waitFor();
      await pd.getByRole('button', { name: 'Defaults ▾' }).click();
      check('no Save as default for Pine', (await page.getByRole('menuitem', { name: 'Save as default' }).count()) === 0);
      await ctx.screenshot('pine');
      await page.keyboard.press('Escape');
    });

    await ctx.writeText('checks', log.join('\n') + '\n');
  },
};
