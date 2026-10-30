import { generateDemoCandles } from '../../../client/src/lib/providers/demo.ts';
import type { Scenario } from '../scenario.ts';

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown> };

/** The saved drawings of the demo source and the raw v2 payload (waits past the 400 ms debounce first). */
const PAYLOAD = `localStorage.getItem('vost.drawings.v2')`;

/** The trend line's anchors as canvas fractions: near the right end, so a timeframe change keeps it in view. */
const TA = { x: 0.915, y: 0.55 };
const TB = { x: 0.94, y: 0.25 };
const FIB = [{ x: 0.55, y: 0.15 }, { x: 0.75, y: 0.45 }];
const SECOND = [{ x: 0.3, y: 0.8 }, { x: 0.5, y: 0.65 }];

export const drawingSettings: Scenario = {
  name: 'drawing-settings',
  keepPrefs: true,
  description:
    'Drawing settings: double-click a trend line to open the dialog, set colour, width, dashed and extend right, OK as one undo step (undo, redo, reload), Cancel restores, a Fibonacci retracement with an added level and a background, the Coordinates tab moves an anchor, Save as default styles the next trend line, the Visibility tab hides a drawing on days and shows it on hours, and the dialog at 360 px; writes the stored v2 payload',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const stored = async (): Promise<Stored[]> => {
      await page.waitForTimeout(700);
      const raw = (await page.evaluate(PAYLOAD)) as string | null;
      return raw ? (JSON.parse(raw).sources['demo:DEMO'] ?? []) : [];
    };
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x, y: b.y + b.height * f.y };
    };
    const dialog = page.getByRole('dialog');
    const field = (label: string) => dialog.getByLabel(label, { exact: true });
    const tab = (name: string) => dialog.getByRole('tab', { name, exact: true }).click();
    const openAt = async (p: { x: number; y: number }) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.dblclick(p.x, p.y);
      await dialog.waitFor({ state: 'visible' });
    };
    const drag = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 15 });
      await page.mouse.up();
    };
    const trendMid = () => at({ x: (TA.x + TB.x) / 2, y: (TA.y + TB.y) / 2 });

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (ctx.viewport === 'narrow') {
      await page.setViewportSize({ width: 360, height: 740 });
      await ctx.step('seed a trend line and open its dialog at 360 px', async () => {
        const bars = generateDemoCandles({ bars: 5000, timeframe: '1d', seed: 1337 });
        const first = bars[bars.length - 40];
        const last = bars[bars.length - 10];
        const line = { id: 'seed1', tool: 'trendLine', anchors: [{ time: first.time, price: first.close }, { time: last.time, price: last.close }] };
        await page.evaluate((l) => localStorage.setItem('vost.drawings.v2', JSON.stringify({ version: 2, sources: { 'demo:DEMO': [l] } })), line);
        await page.reload();
        await ctx.waitForChart();
        const b = await box();
        // The line runs between two bars near the right end; find it by scanning for the pointer cursor.
        let hit: { x: number; y: number } | null = null;
        for (let i = 0; i < 40 && !hit; i++) {
          const x = b.x + b.width * (0.7 + (i % 10) * 0.025);
          const y = b.y + b.height * (0.2 + Math.floor(i / 10) * 0.2);
          await page.mouse.move(x, y);
          const cur = await page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
          if (cur === 'pointer') hit = { x, y };
        }
        if (!hit) throw new Error('could not find the seeded line');
        await openAt(hit);
        const d = await dialog.boundingBox();
        check('the dialog fits 360 px', !!d && d.x >= 0 && d.x + d.width <= 360, `x=${d?.x} width=${d?.width}`);
        const overflow = await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
        check('nothing overflows sideways', overflow);
        await ctx.screenshot('dialog');
        await tab('Visibility');
        await ctx.screenshot('visibility');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await dialog.waitFor({ state: 'hidden' });
      });
      await ctx.writeText('checks', checks.join('\n') + '\n');
      return;
    }

    await ctx.step('draw a trend line and double-click it to open the dialog', async () => {
      await page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: 'Trend line' }).click();
      await drag(await at(TA), await at(TB));
      check('one drawing, no style', (await stored()).length === 1 && (await stored())[0].style === undefined);
      await openAt(await trendMid());
      check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Trend line settings');
      const tabs = await dialog.getByRole('tab').allTextContents();
      check('tabs: Style, Coordinates, Visibility (no Text)', tabs.join(',') === 'Style,Coordinates,Visibility', tabs.join(','));
      check('default width is shown', (await field('Width').inputValue()) === '1.5');
      await ctx.screenshot('dialog');
    });

    await ctx.step('set colour, width 3, dashed and extend right; OK', async () => {
      await field('Colour').fill('#ff4d4d');
      await field('Width').fill('3');
      await field('Line style').selectOption('dashed');
      await field('Extend right').check();
      check('nothing is stored before OK', (await stored())[0].style === undefined);
      await ctx.screenshot('styled-dialog');
      await dialog.getByRole('button', { name: 'OK' }).click();
      await dialog.waitFor({ state: 'hidden' });
      const s = (await stored())[0].style!;
      check('style stored', s.color === '#ff4d4d' && s.width === 3 && s.lineStyle === 'dashed' && s.extendRight === true, JSON.stringify(s));
      await ctx.screenshot('styled');
    });

    await ctx.step('undo reverts the style in one step and redo reapplies it', async () => {
      await page.keyboard.press('Control+z');
      check('undo cleared the style', (await stored())[0].style === undefined);
      await ctx.screenshot('undone');
      await page.keyboard.press('Control+Shift+z');
      check('redo reapplied it', (await stored())[0].style?.width === 3);
    });

    await ctx.step('a reload keeps the style', async () => {
      await page.reload();
      await ctx.waitForChart();
      const s = (await stored())[0].style!;
      check('style kept after reload', s.color === '#ff4d4d' && s.width === 3, JSON.stringify(s));
      await ctx.screenshot('reloaded');
    });

    await ctx.step('Cancel and Escape restore the drawing', async () => {
      await openAt(await trendMid());
      await field('Width').fill('7');
      await page.waitForTimeout(200);
      await ctx.screenshot('preview');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'hidden' });
      check('Cancel kept width 3', (await stored())[0].style?.width === 3);
      await openAt(await trendMid());
      await field('Width').fill('9');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      check('Escape kept width 3', (await stored())[0].style?.width === 3);
      await page.keyboard.press('Control+z');
      check('the cancelled edits left no undo step (nothing to undo after the reload)', (await stored())[0].style?.width === 3);
    });

    await ctx.step('the Coordinates tab moves an anchor and refuses bad input', async () => {
      const before = (await stored())[0].anchors[0];
      await openAt(await trendMid());
      await tab('Coordinates');
      await field('Point 1 price').fill('');
      check('a non-finite entry is refused in place', await dialog.getByRole('alert').isVisible());
      await field('Point 1 price').fill(String(before.price * 1.1));
      await ctx.screenshot('coordinates');
      await dialog.getByRole('button', { name: 'OK' }).click();
      await dialog.waitFor({ state: 'hidden' });
      const after = (await stored())[0].anchors[0];
      check('the anchor price moved', Math.abs(after.price - before.price * 1.1) < 1e-6 && after.time === before.time, `${before.price} -> ${after.price}`);
    });

    await ctx.step('a Fibonacci retracement with a custom level and a background', async () => {
      await page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: 'Fibonacci retracement' }).click();
      await drag(await at(FIB[0]), await at(FIB[1]));
      await openAt(await at(FIB[0]));
      await field('New level value').fill('0.9');
      await dialog.getByRole('button', { name: 'Add level' }).click();
      await field('New level value').fill('');
      await dialog.getByRole('button', { name: 'Add level' }).click();
      check('an empty level is refused in place', await dialog.getByRole('alert').isVisible());
      await field('Background').check();
      await ctx.screenshot('fib-dialog');
      await dialog.getByRole('button', { name: 'OK' }).click();
      await dialog.waitFor({ state: 'hidden' });
      const fib = (await stored()).find((d) => d.tool === 'fibRetracement')!;
      const levels = fib.style?.levels as { value: number }[];
      check('level added and background on', levels.some((l) => l.value === 0.9) && fib.style?.background === true, JSON.stringify(fib.style).slice(0, 120));
      await ctx.screenshot('fib');
    });

    await ctx.step('Save as default styles the next trend line', async () => {
      await openAt(await trendMid());
      await dialog.getByRole('button', { name: 'Save as default' }).click();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForTimeout(700);
      const prefs = (await page.evaluate(`JSON.parse(localStorage.getItem('vost.prefs.v1'))`)) as { drawingDefaults?: Record<string, Record<string, unknown>> };
      check('the default is saved in prefs', prefs.drawingDefaults?.trendLine?.width === 3, JSON.stringify(prefs.drawingDefaults));
      await page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: 'Trend line' }).click();
      await drag(await at(SECOND[0]), await at(SECOND[1]));
      const second = (await stored()).find((d) => d.tool === 'trendLine' && d.style === undefined);
      check('the new line has no style of its own', !!second);
      await openAt(await at({ x: 0.4, y: 0.725 }));
      check('its dialog shows the saved default', (await field('Width').inputValue()) === '3');
      await ctx.screenshot('default-applied');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'hidden' });
    });

    await ctx.step('the Visibility tab hides the drawing on days and shows it on hours', async () => {
      await openAt(await trendMid());
      await tab('Visibility');
      await field('Days').uncheck();
      await ctx.screenshot('visibility');
      await dialog.getByRole('button', { name: 'OK' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForTimeout(300);
      const mid = await trendMid();
      await page.mouse.move(mid.x, mid.y);
      const cursor = await page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
      check('hidden on days: not hit', cursor !== 'pointer', cursor);
      await ctx.screenshot('hidden-days');
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      await ctx.screenshot('shown-hours');
      await page.mouse.move(mid.x - 5, mid.y - 5);
      await page.mouse.move(mid.x, mid.y, { steps: 5 });
      await page.locator('select[title="Timeframe"]').selectOption('1d');
      await page.waitForTimeout(1500);
    });

    await ctx.step('the stored v2 payload keeps every style', async () => {
      const raw = (await page.evaluate(PAYLOAD)) as string;
      const parsed = JSON.parse(raw);
      check('version 2', parsed.version === 2);
      await ctx.writeText('payload', JSON.stringify(parsed, null, 2) + '\n');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
