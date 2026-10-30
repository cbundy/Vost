import type { Scenario } from '../scenario.ts';

const PREFS = `(() => JSON.parse(localStorage.getItem('vost.prefs.v1') || '{}'))()`;
const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Prefs = {
  drawingFavorites?: string[];
  drawingLastTool?: Record<string, string>;
  cursorKind?: string;
  favoritesBarPos?: { x: number; y: number };
};

/** The rail families that have tools, with the tool each button shows at first. */
const FAMILIES: { id: string; label: string; first: string; sections: string[] }[] = [
  { id: 'cursors', label: 'Cursors', first: 'Cross', sections: ['Cursors'] },
  { id: 'lines', label: 'Lines', first: 'Trend line', sections: ['Lines', 'Channels'] },
  { id: 'fib-gann', label: 'Fibonacci and Gann', first: 'Fibonacci retracement', sections: ['Fibonacci', 'Gann'] },
  { id: 'patterns', label: 'Patterns', first: 'XABCD pattern', sections: ['Chart patterns', 'Cycles'] },
  { id: 'forecast-measure', label: 'Forecasting and measurers', first: 'Anchored VWAP', sections: ['Volume-based', 'Measurers'] },
  { id: 'shapes', label: 'Shapes', first: 'Brush', sections: ['Brushes', 'Shapes'] },
  { id: 'annotations', label: 'Annotations', first: 'Text', sections: ['Text', 'Notes'] },
];

export const drawingRail: Scenario = {
  name: 'drawing-rail',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Drawing rail families: one button per family, flyouts with section headings, keyboard use, long press, last tool and favourites kept across a reload, the favourites bar (drag, clamp, kept position), Dot and Arrow cursors, the eraser with undo, and the phone menu with collapsible sections and stars',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const prefs = async () => {
      await page.waitForTimeout(700); // past the prefs debounce
      return (await page.evaluate(PREFS)) as Prefs;
    };
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as { id: string; tool: string }[];
    };
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (fx: number, fy: number) => {
      const b = await box();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    };
    const rail = page.getByRole('toolbar', { name: 'Drawing tools', exact: true });
    const favBar = page.getByRole('toolbar', { name: 'Favorite drawing tools' });
    const groupBtn = (name: string) => rail.getByRole('button', { name, exact: true });
    const chevron = (label: string) => rail.getByRole('button', { name: `Open ${label} tools`, exact: true });
    const pressedOf = async (name: string) => (await groupBtn(name).getAttribute('aria-pressed')) === 'true';

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (ctx.viewport === 'narrow') {
      const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
      const menu = page.getByRole('group', { name: 'Drawing tools menu' });
      const head = (label: string) => menu.getByRole('button', { name: label, exact: true });
      await ctx.step('the phone menu: collapsible sections, the current tool open', async () => {
        await menuBtn.tap();
        for (const f of FAMILIES) check(`section ${f.label} is a button with aria-expanded`, (await head(f.label).getAttribute('aria-expanded')) !== null);
        check('the cursors section is open for the cursor mode', (await head('Cursors').getAttribute('aria-expanded')) === 'true');
        check('the lines section is closed', (await head('Lines').getAttribute('aria-expanded')) === 'false');
        check('Cross is listed', await menu.getByRole('button', { name: 'Cross', exact: true }).isVisible());
        check('Ray is not listed while Lines is closed', !(await menu.getByRole('button', { name: 'Ray', exact: true }).isVisible()));
        await ctx.screenshot('menu');
        await head('Lines').tap();
        check('Lines opens', (await head('Lines').getAttribute('aria-expanded')) === 'true');
        check('Ray is listed now', await menu.getByRole('button', { name: 'Ray', exact: true }).isVisible());
        const box = await menu.boundingBox();
        const vp = page.viewportSize()!;
        check('the menu stays inside the screen', !!box && box.x >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, JSON.stringify(box));
        await ctx.screenshot('menu-lines');
      });
      await ctx.step('a star puts a tool in the favourites bar', async () => {
        await menu.getByRole('button', { name: 'Favorite Ray', exact: true }).tap();
        check('menu stays open after a star', (await menuBtn.getAttribute('aria-expanded')) === 'true');
        check('the star is pressed', (await menu.getByRole('button', { name: 'Favorite Ray', exact: true }).getAttribute('aria-pressed')) === 'true');
        await page.keyboard.press('Escape');
        check('Escape closes the menu', (await menuBtn.getAttribute('aria-expanded')) === 'false');
        check('focus is back on the menu button', await menuBtn.evaluate((el) => el === document.activeElement));
        check('the favourites bar shows with Ray', await favBar.getByRole('button', { name: 'Ray', exact: true }).isVisible());
        const fb = await favBar.boundingBox();
        const cb = await page.locator('.chart-main').boundingBox();
        check('the bar is inside the chart area', !!fb && !!cb && fb.x >= cb.x && fb.x + fb.width <= cb.x + cb.width + 0.5 && fb.y >= cb.y && fb.y + fb.height <= cb.y + cb.height + 0.5, JSON.stringify(fb));
        await ctx.screenshot('favorites');
      });
      await ctx.step('picking from the bar presses it, and picking from the menu closes the menu', async () => {
        await favBar.getByRole('button', { name: 'Ray', exact: true }).tap();
        check('Ray pressed in the bar', (await favBar.getByRole('button', { name: 'Ray', exact: true }).getAttribute('aria-pressed')) === 'true');
        await menuBtn.tap();
        check('the lines section is open for the current tool', (await head('Lines').getAttribute('aria-expanded')) === 'true');
        await menu.getByRole('button', { name: 'Trend line', exact: true }).tap();
        check('menu closed after picking', (await menuBtn.getAttribute('aria-expanded')) === 'false');
        check('Trend line pressed in the bar-less menu state', (await prefs()).drawingLastTool?.lines === 'trendLine');
      });
      await ctx.writeText('checks', checks.join('\n') + '\n');
      return;
    }

    /* ---------------- desktop ---------------- */
    await ctx.step('the rail has one button per family with a chevron', async () => {
      const buttons = await rail.getByRole('button', { name: /^Open .* tools$/ }).count();
      check('one chevron per non-empty family', buttons === FAMILIES.length, `${buttons}`);
      for (const f of FAMILIES) {
        const b = groupBtn(f.first);
        check(`${f.label} shows ${f.first}`, (await b.getAttribute('title')) === f.first);
        check(`${f.label} has aria-pressed`, (await b.getAttribute('aria-pressed')) !== null);
      }
      check('Icons is hidden until it has tools', (await chevron('Icons').count()) === 0);
      check('Cross pressed at start', await pressedOf('Cross'));
      for (const name of ['Magnet', 'Stay in drawing mode', 'Lock all drawings', 'Hide all drawings', 'Delete all drawings']) check(`${name} stays below the divider`, await groupBtn(name).isVisible());
    });
    await ctx.screenshot('rail');

    await ctx.step('every family opens a flyout with section headings', async () => {
      for (const f of FAMILIES) {
        await chevron(f.label).click();
        const menu = page.getByRole('menu', { name: `${f.label} tools` });
        await menu.waitFor();
        for (const s of f.sections) check(`${f.label} has the ${s} heading`, (await menu.getByRole('group', { name: s, exact: true }).count()) === 1);
        const items = await menu.getByRole('menuitemradio').count();
        check(`${f.label} lists tools`, items >= 1, `${items}`);
        check(`${f.label} items have a star`, (await menu.getByRole('button', { name: /^Favorite / }).count()) === items);
        const mb = await menu.boundingBox();
        const vp = page.viewportSize()!;
        check(`${f.label} flyout is inside the viewport`, !!mb && mb.x >= 0 && mb.y >= 0 && mb.x + mb.width <= vp.width && mb.y + mb.height <= vp.height);
        await ctx.screenshot(`flyout-${f.id}`);
        await page.keyboard.press('Escape');
      }
      await chevron('Lines').click();
      await chevron('Shapes').click();
      check('only one flyout is open', (await page.getByRole('menu').count()) === 1);
      await page.mouse.click(...(Object.values(await at(0.5, 0.5)) as [number, number]));
      check('an outside press closes it', (await page.getByRole('menu').count()) === 0);
    });

    await ctx.step('keyboard: ArrowRight opens, arrows move and wrap, Escape closes with focus back', async () => {
      await groupBtn('Trend line').focus();
      await page.keyboard.press('ArrowRight');
      const menu = page.getByRole('menu', { name: 'Lines tools' });
      await menu.waitFor();
      const items = menu.getByRole('menuitemradio');
      const focused = async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
      check('focus starts on the current tool', (await focused()).includes('Trend line') || (await items.first().evaluate((el) => el === document.activeElement)));
      await page.keyboard.press('ArrowDown');
      check('ArrowDown moves to Ray', (await focused()).includes('Ray'));
      await page.keyboard.press('End');
      check('End goes to Inside pitchfork', (await focused()).includes('Inside pitchfork'));
      await page.keyboard.press('ArrowDown');
      check('ArrowDown wraps to Trend line', (await focused()).includes('Trend line'));
      await page.keyboard.press('ArrowUp');
      check('ArrowUp wraps to Inside pitchfork', (await focused()).includes('Inside pitchfork'));
      await page.keyboard.press('Home');
      check('Home goes to Trend line', (await focused()).includes('Trend line'));
      await ctx.screenshot('keyboard');
      await page.keyboard.press('Escape');
      check('Escape closes it', (await page.getByRole('menu').count()) === 0);
      check('focus is back on the group button', await groupBtn('Trend line').evaluate((el) => el === document.activeElement));
      await page.keyboard.press('ArrowRight');
      await menu.waitFor();
      await page.keyboard.press('ArrowLeft');
      check('ArrowLeft closes it too', (await page.getByRole('menu').count()) === 0);
      check('focus is back again', await groupBtn('Trend line').evaluate((el) => el === document.activeElement));
      await page.keyboard.press('ArrowRight');
      await menu.waitFor();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      check('Enter picks Info line and closes the menu', (await page.getByRole('menu').count()) === 0 && (await groupBtn('Info line').getAttribute('aria-pressed')) === 'true');
      await page.keyboard.press('Escape');
      check('Escape leaves the tool', await pressedOf('Cross'));
    });

    await ctx.step('a long press opens the flyout', async () => {
      const b = await groupBtn('Brush').boundingBox();
      if (!b) throw new Error('no box');
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      await page.getByRole('menu', { name: 'Shapes tools' }).waitFor();
      check('long press opened Shapes', true);
      check('the long press did not pick the tool', (await groupBtn('Brush').getAttribute('aria-pressed')) === 'false');
      await page.keyboard.press('Escape');
    });

    await ctx.step('the last tool of a family shows on its button, also after a reload', async () => {
      await chevron('Lines').click();
      await page.getByRole('menuitemradio', { name: 'Ray', exact: true }).click();
      check('the menu closed', (await page.getByRole('menu').count()) === 0);
      check('Lines shows Ray, pressed', (await groupBtn('Ray').getAttribute('aria-pressed')) === 'true');
      await page.keyboard.press('Escape');
      check('lastTool saved', (await prefs()).drawingLastTool?.lines === 'ray');
      await page.reload();
      await ctx.waitForChart();
      check('after a reload Lines still shows Ray', (await groupBtn('Ray').getAttribute('title')) === 'Ray');
      await ctx.screenshot('last-tool');
    });

    await ctx.step('a star favourites a tool without closing the menu; the bar shows it', async () => {
      check('no bar without favourites', (await favBar.count()) === 0);
      await chevron('Lines').click();
      const menu = page.getByRole('menu', { name: 'Lines tools' });
      await menu.getByRole('button', { name: 'Favorite Ray', exact: true }).click();
      await menu.getByRole('button', { name: 'Favorite Trend line', exact: true }).click();
      check('the menu is still open', (await page.getByRole('menu').count()) === 1);
      check('the star is pressed', (await menu.getByRole('button', { name: 'Favorite Ray', exact: true }).getAttribute('aria-pressed')) === 'true');
      await menu.getByRole('button', { name: 'Favorite Trend line', exact: true }).click();
      await page.keyboard.press('Escape');
      const order = (await prefs()).drawingFavorites;
      check('favourites saved in order', JSON.stringify(order) === JSON.stringify(['ray']), JSON.stringify(order));
      await chevron('Cursors').click();
      await page.getByRole('menu', { name: 'Cursors tools' }).getByRole('button', { name: 'Favorite Eraser', exact: true }).click();
      await page.keyboard.press('Escape');
      check('the bar lists Ray then Eraser', (await favBar.getByRole('button').count()) === 2 && (await favBar.getByRole('button').first().getAttribute('title')) === 'Ray');
      await favBar.getByRole('button', { name: 'Ray', exact: true }).click();
      check('picking from the bar presses it', (await favBar.getByRole('button', { name: 'Ray', exact: true }).getAttribute('aria-pressed')) === 'true');
      check('and the rail', await pressedOf('Ray'));
      await page.keyboard.press('Escape');
      await ctx.screenshot('favorites');
    });

    await ctx.step('the bar drags by its grip, stays inside the chart and keeps its place after a reload', async () => {
      const grip = favBar.getByRole('separator', { name: 'Move favorites bar' });
      const area = (await page.locator('.chart-main').boundingBox())!;
      const start = (await favBar.boundingBox())!;
      const g = (await grip.boundingBox())!;
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2 + 200, g.y + g.height / 2 + 160, { steps: 10 });
      await page.mouse.up();
      const moved = (await favBar.boundingBox())!;
      check('the bar moved right and down', Math.abs(moved.x - (start.x + 200)) < 3 && Math.abs(moved.y - (start.y + 160)) < 3, `${JSON.stringify(start)} -> ${JSON.stringify(moved)}`);
      await ctx.screenshot('bar-dragged');
      const p = (await prefs()).favoritesBarPos;
      check('the position is saved', !!p && Math.abs(p.x - (moved.x - area.x)) < 2 && Math.abs(p.y - (moved.y - area.y)) < 2, JSON.stringify(p));
      await page.reload();
      await ctx.waitForChart();
      const again = (await favBar.boundingBox())!;
      check('the position is kept after a reload', Math.abs(again.x - moved.x) < 2 && Math.abs(again.y - moved.y) < 2, `${JSON.stringify(moved)} vs ${JSON.stringify(again)}`);
      // far outside: clamped to the chart area
      const g2 = (await favBar.getByRole('separator', { name: 'Move favorites bar' }).boundingBox())!;
      await page.mouse.move(g2.x + 3, g2.y + 3);
      await page.mouse.down();
      await page.mouse.move(area.x + area.width + 400, area.y + area.height + 400, { steps: 10 });
      await page.mouse.up();
      const far = (await favBar.boundingBox())!;
      check('dragged past the corner it stays inside the chart area', far.x + far.width <= area.x + area.width + 0.5 && far.y + far.height <= area.y + area.height + 0.5 && far.x >= area.x && far.y >= area.y, JSON.stringify(far));
      const g3 = (await favBar.getByRole('separator', { name: 'Move favorites bar' }).boundingBox())!;
      await page.mouse.move(g3.x + 3, g3.y + 3);
      await page.mouse.down();
      await page.mouse.move(area.x - 400, area.y - 400, { steps: 10 });
      await page.mouse.up();
      const near = (await favBar.boundingBox())!;
      check('dragged past the top-left it stays inside', near.x >= area.x - 0.5 && near.y >= area.y - 0.5, JSON.stringify(near));
      // park it back where it does not hide the drawing area used below
      const g4 = (await favBar.getByRole('separator', { name: 'Move favorites bar' }).boundingBox())!;
      await page.mouse.move(g4.x + 3, g4.y + 3);
      await page.mouse.down();
      await page.mouse.move(g4.x + 300, g4.y + 10, { steps: 10 });
      await page.mouse.up();
    });

    await ctx.step('the Dot and Arrow cursors hide the crosshair lines and keep the labels', async () => {
      const b = await box();
      const px = b.x + b.width * 0.5;
      const py = b.y + b.height * 0.6;
      /** A thin strip of the plot on the pointer's vertical line, well above the pointer, and the price label beside the pointer. */
      const strip = { x: px - 2, y: py - 140, width: 4, height: 60 };
      const label = { x: b.x + b.width - 62, y: py - 14, width: 60, height: 28 };
      const shoot = async (clip: { x: number; y: number; width: number; height: number }) => page.screenshot({ clip });
      await page.mouse.move(b.x + 5, b.y + 5);
      await page.waitForTimeout(200);
      const bareStrip = await shoot(strip);
      const bareLabel = await shoot(label);
      const kindShots: Record<string, { strip: Buffer; label: Buffer; cursor: string }> = {};
      for (const kind of ['Cross', 'Dot', 'Arrow']) {
        await chevron('Cursors').click();
        await page.getByRole('menuitemradio', { name: kind, exact: true }).click();
        check(`${kind} pressed on the rail`, await pressedOf(kind));
        await page.mouse.move(px, py, { steps: 4 });
        await page.waitForTimeout(250);
        const cursor = await page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
        kindShots[kind] = { strip: await shoot(strip), label: await shoot(label), cursor };
        await ctx.screenshot(`cursor-${kind.toLowerCase()}`);
        await page.mouse.move(b.x + 5, b.y + 5);
      }
      check('Cross draws the crosshair line', !kindShots.Cross.strip.equals(bareStrip));
      check('Dot draws no crosshair line', kindShots.Dot.strip.equals(bareStrip));
      check('Arrow draws no crosshair line', kindShots.Arrow.strip.equals(bareStrip));
      for (const kind of ['Cross', 'Dot', 'Arrow']) check(`${kind} keeps the price label`, !kindShots[kind].label.equals(bareLabel));
      check('Dot shows a dot pointer', kindShots.Dot.cursor.includes('svg'), kindShots.Dot.cursor);
      check('Arrow keeps the default pointer', kindShots.Arrow.cursor === '', kindShots.Arrow.cursor);
      check('Cross keeps the default pointer', kindShots.Cross.cursor === '', kindShots.Cross.cursor);
      await chevron('Cursors').click();
      await page.getByRole('menuitemradio', { name: 'Dot', exact: true }).click();
      check('the cursor kind is saved', (await prefs()).cursorKind === 'dot');
      await page.reload();
      await ctx.waitForChart();
      check('the Dot kind is kept after a reload', (await groupBtn('Dot').getAttribute('title')) === 'Dot' && (await pressedOf('Dot')));
    });

    await ctx.step('the eraser deletes a drawing as one undo step', async () => {
      await chevron('Cursors').click();
      await page.getByRole('menuitemradio', { name: 'Cross', exact: true }).click();
      await groupBtn('Ray').click(); // the Lines button shows the last tool used
      const a = await at(0.35, 0.7);
      const c = await at(0.65, 0.4);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(c.x, c.y, { steps: 15 });
      await page.mouse.up();
      check('one drawing stored', (await stored()).length === 1);
      await page.keyboard.press('Escape');
      await chevron('Cursors').click();
      await page.getByRole('menuitemradio', { name: 'Eraser', exact: true }).click();
      check('Eraser pressed', await pressedOf('Eraser'));
      const empty = await at(0.2, 0.2);
      await page.mouse.click(empty.x, empty.y);
      check('a press on empty chart deletes nothing', (await stored()).length === 1);
      const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      await page.mouse.move(mid.x, mid.y, { steps: 3 });
      const cursor = await page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
      check('the pointer over the drawing shows it will be erased', cursor.includes('svg') && cursor.includes('ef4444'), cursor);
      await ctx.screenshot('eraser-hover');
      await page.mouse.click(mid.x, mid.y);
      check('the press erased the drawing', (await stored()).length === 0);
      await ctx.screenshot('eraser-erased');
      await page.keyboard.press('Control+z');
      check('one undo brings it back', (await stored()).length === 1);
      await page.keyboard.press('Escape');
      await page.mouse.click(mid.x, mid.y);
      check('after Escape a press on the drawing selects it instead of erasing it', (await stored()).length === 1);
      await chevron('Cursors').click();
      check('the cursor mode, not the eraser, is current', (await page.getByRole('menuitemradio', { name: 'Eraser', exact: true }).getAttribute('aria-checked')) === 'false');
      await page.keyboard.press('Escape');
    });

    await ctx.step('the eraser is disabled while drawings are hidden', async () => {
      await groupBtn('Hide all drawings').click();
      await chevron('Cursors').click();
      const item = page.getByRole('menuitemradio', { name: 'Eraser', exact: true });
      check('Eraser disabled while hidden', await item.isDisabled());
      check('the cursor kinds stay enabled', await page.getByRole('menuitemradio', { name: 'Arrow', exact: true }).isEnabled());
      await page.keyboard.press('Escape');
      await groupBtn('Hide all drawings').click();
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
