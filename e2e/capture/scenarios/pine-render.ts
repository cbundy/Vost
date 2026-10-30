import { readFileSync } from 'node:fs';
import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../client/src/lib/pine/fixtures/${name}.pine`, import.meta.url), 'utf8');

export const pineRender: Scenario = {
  name: 'pine-render',
  description: 'Pine shapes and fills: a separate-pane script draws its shapes and characters in its own pane (none on the candles); an overlay script keeps them on the candles; fill() shades the RSI 30/70 band and a colour-changing moving-average cloud; plotcandle draws custom candles with plotarrow arrows in the script pane; barcolor recolours the chart candles, plotbar draws bars and plotarrow arrows sit on the price pane, hiding the script restores the default candles, and plot options draw: line width, offset, step lines, areas, columns, circles, plotshape text and sizes, plotchar characters (emoji included) and dashed, dotted and solid hlines',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const pane = page.getByRole(narrow ? 'dialog' : 'region', { name: 'Pine editor' });
    const setSource = async (text: string) => {
      await page.locator('.pine-pane .pine-editor .cm-content').click();
      await page.keyboard.press('Control+A');
      // insertText avoids closeBrackets mangling typed text
      await page.keyboard.insertText(text);
      await page.locator('.pine-error').waitFor({ state: 'detached' });
    };
    const closeEditor = async () => {
      await page.getByRole('button', { name: 'Close Pine editor' }).click();
      await pane.waitFor({ state: 'detached' });
    };
    const reopenEditor = async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.getByRole('button', { name: /^Edit .* source$/ }).click();
      await pane.waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add a Pine indicator', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await pane.waitFor();
      await page.locator('.pine-pane .pine-editor .cm-content').waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    });
    await ctx.step('a separate-pane script with a shape and a character', async () => {
      await setSource(fixture('pane-shapes'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('pane');
    await ctx.step('an overlay script keeps its shapes on the candles', async () => {
      await reopenEditor();
      await setSource(fixture('overlays'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('overlay');
    await ctx.step('a fill shades the band between two hlines', async () => {
      await reopenEditor();
      await setSource(fixture('rsi-band'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('fill-band');
    await ctx.step('a fill shades the cloud between two moving averages', async () => {
      await reopenEditor();
      await setSource(fixture('cloud'));
      await closeEditor();
      // zoom in so the cloud between the averages is wide enough to see
      await page.getByRole('button', { name: '6M', exact: true }).click();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('fill-cloud');
    /** Pixels near `rgb` over every chart canvas. */
    const colorPixels = (rgb: [number, number, number], tol = 12) =>
      page.evaluate(([want, tolerance]) => {
        let n = 0;
        for (const cv of Array.from(document.querySelectorAll('canvas'))) {
          const copy = document.createElement('canvas');
          copy.width = cv.width;
          copy.height = cv.height;
          const g = copy.getContext('2d');
          if (!g || cv.width === 0) continue;
          g.drawImage(cv, 0, 0);
          const d = g.getImageData(0, 0, cv.width, cv.height).data;
          for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - want[0]) < tolerance && Math.abs(d[i + 1] - want[1]) < tolerance && Math.abs(d[i + 2] - want[2]) < tolerance && d[i + 3] > 200) n++;
        }
        return n;
      }, [rgb, tol] as const);
    /** Pixels of the barcolor blue (#2962FF). */
    const bluePixels = () => colorPixels([0x29, 0x62, 0xff]);
    await ctx.step('plotcandle draws custom candles and plotarrow arrows in the script pane', async () => {
      await reopenEditor();
      await setSource(fixture('custom-candles'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('candles');
    // Collapse the dock so the script pane has room for the plot styles.
    const dockToggle = page.locator('.dock-tabs ~ button[title="Collapse"], button[title="Collapse"]').first();
    await ctx.step('plot options in a script pane: width, offset, step, area, columns, circles, shape text, characters and hline styles', async () => {
      if (await dockToggle.count()) await dockToggle.click();
      await reopenEditor();
      await setSource(fixture('plot-styles'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('plot-styles');
    await ctx.step('the plotchar glyph is drawn in its colour (yellow, unlike any default indicator) in the script pane', async () => {
      const orange = await colorPixels([0xff, 0xeb, 0x3b], 30);
      if (orange < 30) throw new Error(`plotchar glyph not drawn (${orange} yellow pixels)`);
    });
    await ctx.step('plotchar characters sit above and below the candles', async () => {
      await reopenEditor();
      await setSource(fixture('plot-styles-overlay'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('plot-chars');
    await ctx.step('the dock comes back', async () => {
      const expand = page.locator('button[title="Expand"]').first();
      if (await expand.count()) await expand.click();
    });
    await ctx.step('barcolor recolours the candles; plotbar and plotarrow draw on the price pane', async () => {
      await reopenEditor();
      await setSource(fixture('bar-colors'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('bar-colors');
    const withScript = await bluePixels();
    await ctx.step('hiding the script restores the default candles', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('button[title="Hide"]').last().click();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'hidden' }).catch(() => {});
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('bar-colors-off');
    const without = await bluePixels();
    await ctx.step('the candles lose the script colors when it is hidden', async () => {
      if (withScript <= 200) throw new Error(`barcolor blue candles not drawn (${withScript} blue pixels)`);
      if (without >= withScript / 10) throw new Error(`blue candles remain with the script hidden (${without} vs ${withScript})`);
    });
  },
};
