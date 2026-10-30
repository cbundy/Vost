import { readFileSync } from 'node:fs';
import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../client/src/lib/pine/fixtures/${name}.pine`, import.meta.url), 'utf8');

export const pineDrawings: Scenario = {
  name: 'pine-drawings',
  description: 'Pine drawing objects: line, box, polyline and linefill objects are painted read-only on the candles (dashed extended line reaching into the future space, arrows, boxes with text, filled and curved polylines, a fill between two lines); an overlay=false script draws its objects in its own pane with one force_overlay box on the candles; clicking a Pine line selects nothing',
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
    /** The first page point (CSS px) with a canvas pixel near the colour, or null. */
    const findColour = (rgb: [number, number, number]) =>
      page.evaluate(([r, g, b]) => {
        for (const cv of Array.from(document.querySelectorAll('canvas'))) {
          if (cv.width === 0) continue;
          const copy = document.createElement('canvas');
          copy.width = cv.width;
          copy.height = cv.height;
          const ctx2 = copy.getContext('2d');
          if (!ctx2) continue;
          ctx2.drawImage(cv, 0, 0);
          const d = ctx2.getImageData(0, 0, cv.width, cv.height).data;
          const box = cv.getBoundingClientRect();
          const kx = box.width / cv.width;
          const ky = box.height / cv.height;
          for (let y = 0; y < cv.height; y += 1) {
            for (let x = 0; x < cv.width; x += 1) {
              const i = (y * cv.width + x) * 4;
              if (Math.abs(d[i] - r) < 6 && Math.abs(d[i + 1] - g) < 6 && Math.abs(d[i + 2] - b) < 6 && d[i + 3] > 240) {
                return { x: box.left + x * kx, y: box.top + y * ky };
              }
            }
          }
        }
        return null;
      }, rgb);

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('add a Pine indicator', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.locator('#add-indicator-select').selectOption('pine');
      await pane.waitFor();
      await page.locator('.pine-pane .pine-editor .cm-content').waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    });
    await ctx.step('an overlay script draws every kind of object on the candles', async () => {
      await setSource(fixture('drawings'));
      await closeEditor();
      // zoom in so the objects, a few months wide, are big enough to see
      await page.getByRole('button', { name: '6M', exact: true }).click();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('overlay');
    await ctx.step('clicking a Pine line selects nothing', async () => {
      // The fixture's bar_time line is purple (#9C27B0) and 3 px wide.
      const at = await findColour([0x9c, 0x27, 0xb0]);
      if (!at) throw new Error('the purple Pine line is not on the chart');
      await page.mouse.move(at.x, at.y);
      const cursor = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? getComputedStyle(el).cursor : '';
      }, [at.x, at.y]);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(300);
      if ((await page.locator('.drawing-toolbar').count()) !== 0) throw new Error('a drawing toolbar appeared');
      if (cursor === 'pointer' || cursor === 'move' || cursor === 'grab') throw new Error(`the pointer changed to ${cursor} over a Pine line`);
    });
    await ctx.screenshot('clicked');
    await ctx.step('an overlay=false script draws its objects in its own pane', async () => {
      await showSideSection(page, 'Indicators', narrow);
      await page.getByRole('button', { name: /^Edit .* source$/ }).click();
      await pane.waitFor();
      if (narrow) await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
      await setSource(fixture('drawings-pane'));
      await closeEditor();
      await page.waitForTimeout(800);
    });
    await ctx.screenshot('pane');
  },
};
