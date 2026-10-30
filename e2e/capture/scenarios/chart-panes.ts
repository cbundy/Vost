import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const fixture = readFileSync(new URL('../../../client/src/lib/pine/fixtures/pane-legend.pine', import.meta.url), 'utf8');

interface PaneProbe {
  legends: Array<{ id: string; text: string; left: number; top: number; right: number; bottom: number; pointerEvents: string }>;
  /** The pane boxes, top to bottom (the price pane first). */
  panes: Array<{ top: number; bottom: number; left: number; right: number }>;
}

/** The sub-pane legends and the pane boxes, from the DOM: each pane is a table row of the chart holding a canvas. */
async function probe(page: Page): Promise<PaneProbe> {
  return page.evaluate(() => {
    const legends = [...document.querySelectorAll<HTMLElement>('.pane-legend')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.paneId ?? '',
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        pointerEvents: getComputedStyle(el).pointerEvents,
      };
    });
    const rows = [...document.querySelectorAll<HTMLElement>('.chart-container table tr')]
      .filter((tr) => tr.querySelector('canvas'))
      .map((tr) => tr.getBoundingClientRect())
      .map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }));
    return { legends, panes: rows };
  });
}

export const chartPanes: Scenario = {
  name: 'chart-panes',
  description: 'Indicator sub panes: each pane (RSI, MACD, a Pine script) has a legend with its name and live values, value labels on its scale, a modest default height, and a dragged height that survives adding another indicator',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const log: string[] = [];
    const pineEditor = page.getByRole('region', { name: 'Pine editor' });
    const pineDialog = page.getByRole('dialog', { name: 'Pine editor' });
    const pane = narrow ? pineDialog : pineEditor;

    /** The narrow layout's sidebar is a drawer that stays open over the chart after an indicator is added. */
    const closeDrawer = async () => {
      if (!narrow) return;
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    };
    await ctx.step('open app with a short bottom dock, so the chart has room for the panes', async () => {
      await page.addInitScript(() => {
        localStorage.setItem(
          'vost.prefs.v1',
          JSON.stringify({ providerId: 'demo', symbol: 'DEMO', timeframe: '1d', dockHeight: 120 }),
        );
      });
      await page.goto('/');
    });
    await ctx.waitForChart();
    await ctx.step('add RSI and MACD', async () => {
      for (const kind of ['rsi', 'macd']) {
        await showSideSection(page, 'Indicators', narrow);
        await page.locator('#add-indicator-select').selectOption(kind);
      }
      await closeDrawer();
    });
    await ctx.step('add a Pine script with two titled plots and an hline', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await pane.waitFor();
      await page.locator('.pine-pane .pine-editor .cm-content').waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
      await page.locator('.pine-pane .pine-editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(fixture);
      await page.locator('.pine-error').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await pane.waitFor({ state: 'detached' });
      await page.locator('.pane-legend').nth(2).waitFor();
      await page.waitForTimeout(800);
    });

    const checkLegends = async (label: string): Promise<PaneProbe> => {
      const p = await probe(page);
      if (p.legends.length !== 3) throw new Error(`${label}: expected 3 pane legends, got ${p.legends.length}`);
      const subs = p.panes.slice(1);
      p.legends.forEach((l, i) => {
        const box = subs[i];
        if (!box) throw new Error(`${label}: no pane box for legend ${i}`);
        const inside = l.top >= box.top - 1 && l.bottom <= box.bottom + 1 && l.left >= box.left - 1;
        const clearOfScale = l.right <= box.right - 40;
        log.push(`${label}: legend ${i} "${l.text}" top=${Math.round(l.top - box.top)} fromRight=${Math.round(box.right - l.right)} inside=${inside} clearOfScale=${clearOfScale} pointer-events=${l.pointerEvents}`);
        if (!inside) throw new Error(`${label}: legend ${i} lies outside its pane`);
        if (!clearOfScale) throw new Error(`${label}: legend ${i} covers the price scale`);
        if (l.pointerEvents !== 'none') throw new Error(`${label}: legend ${i} catches pointer events`);
      });
      const heights = subs.map((b) => Math.round(b.bottom - b.top));
      log.push(`${label}: pane heights price=${Math.round(p.panes[0].bottom - p.panes[0].top)} subs=${heights.join(',')}`);
      return p;
    };

    let atLast!: PaneProbe;
    await ctx.step('legends at the last bar, inside their panes', async () => {
      atLast = await checkLegends('last bar');
      const [rsi, macd, pine] = atLast.legends.map((l) => l.text);
      if (!/^RSI 14 \d/.test(rsi)) throw new Error(`RSI legend: ${rsi}`);
      if (!/^MACD 12 26 9 /.test(macd)) throw new Error(`MACD legend: ${macd}`);
      if (!/^Momentum pair 10 Fast .* Slow /.test(pine)) throw new Error(`Pine legend: ${pine}`);
      const [price, rsiPane] = atLast.panes;
      const share = (price.bottom - price.top) / (atLast.panes[atLast.panes.length - 1].bottom - price.top);
      log.push(`price pane share of the chart: ${share.toFixed(2)} (RSI pane ${Math.round(rsiPane.bottom - rsiPane.top)}px)`);
    });
    await ctx.screenshot('default');

    await ctx.step('the crosshair over a mid bar changes the legend values', async () => {
      const box = (await page.locator('.chart-container').boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.waitForTimeout(500);
      const mid = await probe(page);
      mid.legends.forEach((l, i) => {
        log.push(`crosshair: legend ${i} "${l.text}"`);
        if (l.text === atLast.legends[i].text) throw new Error(`legend ${i} did not change with the crosshair`);
      });
    });
    await ctx.screenshot('crosshair');
    await ctx.step('the crosshair leaves: back to the last bar', async () => {
      await page.mouse.move(5, 5);
      await page.waitForTimeout(500);
      const p = await probe(page);
      p.legends.forEach((l, i) => {
        if (l.text !== atLast.legends[i].text) throw new Error(`legend ${i} did not return to the last bar: ${l.text}`);
      });
    });

    let before: PaneProbe;
    await ctx.step('drag the separator above the Pine pane to grow it', async () => {
      before = await probe(page);
      const pinePane = before.panes[3];
      const x = (pinePane.left + pinePane.right) / 2;
      const y = pinePane.top - 1;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - 60, { steps: 15 });
      await page.mouse.up();
      await page.mouse.move(5, 5);
      await page.waitForTimeout(500);
      const after = await checkLegends('after drag');
      const grew = after.panes[3].bottom - after.panes[3].top - (before.panes[3].bottom - before.panes[3].top);
      log.push(`Pine pane grew by ${Math.round(grew)}px`);
      if (grew < 40) throw new Error(`the Pine pane grew by only ${grew}px`);
    });
    await ctx.screenshot('dragged');

    const dragged = await probe(page);
    await ctx.step('adding an SMA keeps the dragged Pine pane height', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('sma');
      await closeDrawer();
      await page.waitForTimeout(900);
      const after = await checkLegends('after SMA');
      const h = (p: PaneProbe, i: number) => p.panes[i].bottom - p.panes[i].top;
      for (const i of [1, 2, 3]) {
        const d = Math.abs(h(after, i) - h(dragged, i));
        log.push(`pane ${i} height ${Math.round(h(dragged, i))} -> ${Math.round(h(after, i))} (changed ${Math.round(d)}px)`);
        if (d > 4) await ctx.writeText('checks', log.join('\n') + '\n');
        if (d > 4) throw new Error(`pane ${i} changed height by ${Math.round(d)}px after adding an SMA`);
      }
    });
    await ctx.screenshot('kept');
    await ctx.writeText('checks', log.join('\n') + '\n');
  },
};
