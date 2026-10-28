import { generateDemoCandles } from '../../../client/src/lib/providers/demo.ts';
import type { Scenario } from '../scenario.ts';

/** Reads the saved drawings of the demo source (waits past the 400 ms debounce first). */
const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v1');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

/** The trend line's anchors as fractions of the chart canvas: near the right end, so a timeframe change keeps it in view. */
const TA = { x: 0.915, y: 0.55 };
const TB = { x: 0.94, y: 0.25 };
/** Corners (canvas fractions) of the ray, rectangle and Fibonacci drags: clear of the trend line and each other. */
const RAY = [{ x: 0.3, y: 0.35 }, { x: 0.45, y: 0.45 }];
const RECT = [{ x: 0.3, y: 0.55 }, { x: 0.5, y: 0.7 }];
const FIB = [{ x: 0.55, y: 0.15 }, { x: 0.75, y: 0.45 }];

export const drawings: Scenario = {
  name: 'drawings',
  touch: ['narrow'],
  keepPrefs: true,
    description: 'Drawing tools: rail with magnet, hide all and delete all, the phone drawing menu, tap drawing, touch pan and pinch, draw a trend line, a horizontal line, a ray, a rectangle and a Fibonacci retracement, select, drag a handle and the body, delete, undo, reload, timeframe change, pan after drawing',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as { id: string; tool: string; anchors: { time: number; price: number }[] }[];
    };
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    if (ctx.viewport === 'narrow') {
      await ctx.step('the rail is hidden and the chart takes the full width', async () => {
        check('rail hidden', !(await rail.isVisible()));
        const b = await box();
        check('chart starts at the left edge', Math.round(b.x) === 0, `x=${b.x}`);
        await ctx.screenshot('narrow');
      });
      const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
      const menu = page.getByRole('group', { name: 'Drawing tools menu' });
      const pick = (name: string) => menu.getByRole('button', { name, exact: true });
      await ctx.step('the drawing menu opens, lists every entry and closes on Escape', async () => {
        check('menu button has title and aria-haspopup', (await menuBtn.getAttribute('title')) === 'Drawing tools' && (await menuBtn.getAttribute('aria-haspopup')) !== null);
        check('collapsed at start', (await menuBtn.getAttribute('aria-expanded')) === 'false');
        await menuBtn.tap();
        check('expanded', (await menuBtn.getAttribute('aria-expanded')) === 'true');
        for (const name of ['Cursor', 'Trend line', 'Horizontal line', 'Magnet', 'Hide all drawings', 'Delete all drawings']) {
          check(`menu has ${name}`, await pick(name).isVisible());
        }
        check('Delete all disabled with no drawings', await pick('Delete all drawings').isDisabled());
        await ctx.screenshot('menu');
        await page.keyboard.press('Escape');
        check('Escape closes it', (await menuBtn.getAttribute('aria-expanded')) === 'false');
        check('focus is back on the button', await menuBtn.evaluate((el) => el === document.activeElement));
      });
      const at = async (fx: number, fy: number) => {
        const b = await box();
        return { x: b.x + b.width * fx, y: b.y + b.height * fy };
      };
      await ctx.step('pick Trend line and draw it with two taps', async () => {
        await menuBtn.tap();
        await pick('Trend line').tap();
        check('menu closed after picking', (await menuBtn.getAttribute('aria-expanded')) === 'false');
        const a = await at(0.35, 0.6);
        const b = await at(0.7, 0.3);
        await page.touchscreen.tap(a.x, a.y);
        await page.waitForTimeout(200);
        await ctx.screenshot('first-tap');
        await page.touchscreen.tap(b.x, b.y);
        const list = await stored();
        check('one trend line stored', list.length === 1 && list[0].tool === 'trendLine', list.map((d) => d.tool).join(','));
        check('two distinct anchors', list[0].anchors.length === 2 && list[0].anchors[0].time !== list[0].anchors[1].time);
        await ctx.screenshot('touch-drawn');
      });
      await ctx.step('tap empty chart to clear the selection, tap the line to select it again', async () => {
        const shot = () => page.locator('.chart-container').screenshot();
        const drawn = await shot(); // finish() leaves the new line selected: handles showing
        const empty = await at(0.2, 0.15);
        await page.touchscreen.tap(empty.x, empty.y);
        await page.waitForTimeout(300);
        const cleared = await shot();
        check('tap on empty chart cleared the selection (handles gone)', !drawn.equals(cleared));
        await ctx.screenshot('touch-cleared');
        const mid = await at(0.525, 0.45);
        await page.touchscreen.tap(mid.x, mid.y);
        await page.waitForTimeout(300);
        const selected = await shot();
        check('tap on the line selected it (handles back)', !cleared.equals(selected));
        await ctx.screenshot('touch-selected');
        check('still one drawing', (await stored()).length === 1);
      });
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: 'touchStart' | 'touchMove' | "touchEnd", pts: { x: number; y: number; id: number }[]) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })),
        });
      await ctx.step('one-finger swipe pans and two-finger pinch zooms with Cursor', async () => {
        const before = (await stored())[0];
        const shot = () => page.locator('.chart-container').screenshot();
        const first = await shot();
        const y = (await at(0.5, 0.12)).y;
        const b = await box();
        let x = b.x + b.width * 0.8;
        await touch('touchStart', [{ x, y, id: 1 }]);
        for (let i = 0; i < 15; i++) {
          x -= 14;
          await touch('touchMove', [{ x, y, id: 1 }]);
        }
        await touch('touchEnd', []);
        await page.waitForTimeout(400);
        const panned = await shot();
        check('swipe panned the chart', !first.equals(panned));
        const cx = b.x + b.width * 0.5;
        let d = 20;
        await touch('touchStart', [{ x: cx - d, y, id: 1 }, { x: cx + d, y, id: 2 }]);
        for (let i = 0; i < 12; i++) {
          d += 10;
          await touch('touchMove', [{ x: cx - d, y, id: 1 }, { x: cx + d, y, id: 2 }]);
        }
        await touch('touchEnd', []);
        await page.waitForTimeout(400);
        check('pinch zoomed the chart', !panned.equals(await shot()));
        await ctx.screenshot('touch-zoomed');
        const after = await stored();
        check('no drawing added', after.length === 1);
        check('the drawing was not moved', JSON.stringify(after[0].anchors) === JSON.stringify(before.anchors));
      });
      await ctx.writeText('checks', checks.join('\n') + '\n');
      return;
    }

    await ctx.step('the rail sits left of the chart canvas', async () => {
      const r = await rail.boundingBox();
      const b = await box();
      if (!r) throw new Error('no rail box');
      check('rail left of canvas', r.x + r.width <= b.x + 0.5, `rail right=${r.x + r.width} canvas left=${b.x}`);
      check('rail about 40px wide', Math.abs(r.width - 40) <= 2, `${r.width}`);
      for (const name of ['Cursor', 'Trend line', 'Horizontal line', 'Ray', 'Rectangle', 'Fibonacci retracement']) {
        const btn = rail.getByRole('button', { name, exact: true });
        check(`${name} button has title and aria-pressed`, (await btn.getAttribute('title')) === name && (await btn.getAttribute('aria-pressed')) !== null);
      }
      check('Cursor pressed at start', (await rail.getByRole('button', { name: 'Cursor' }).getAttribute('aria-pressed')) === 'true');
    });
    await ctx.screenshot('rail');

    const press = (name: string) => rail.getByRole('button', { name, exact: true });
    const pressed = async (name: string) => await press(name).getAttribute('aria-pressed');

    await ctx.step('the rail extras: magnet, hide all, delete all', async () => {
      for (const name of ['Magnet', 'Hide all drawings', 'Delete all drawings']) {
        check(`${name} button has title`, (await press(name).getAttribute('title')) === name);
      }
      check('Magnet off at start', (await pressed('Magnet')) === 'false');
      check('Hide all off at start', (await pressed('Hide all drawings')) === 'false');
      check('Delete all has no aria-pressed', (await press('Delete all drawings').getAttribute('aria-pressed')) === null);
      check('Delete all disabled with no drawings', await press('Delete all drawings').isDisabled());
    });

    const aAt = async (fx: number, fy: number) => {
      const b = await box();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    };

    await ctx.step('magnet snaps a dragged trend line to a bar', async () => {
      await press('Magnet').click();
      check('Magnet pressed', (await pressed('Magnet')) === 'true');
      await press('Trend line').click();
      const a = await aAt(0.5, 0.4);
      const b = await aAt(0.7, 0.3);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 15 });
      await page.mouse.up();
      const list = await stored();
      check('one drawing saved', list.length === 1);
      const bars = generateDemoCandles({ bars: 5000, timeframe: '1d', seed: 1337 });
      for (const [i, anchor] of list[0].anchors.entries()) {
        const bar = bars.find((c) => c.time === anchor.time);
        check(`anchor ${i + 1} time is a bar time`, !!bar, `${anchor.time}`);
        const prices = [bar!.open, bar!.high, bar!.low, bar!.close];
        check(`anchor ${i + 1} price is that bar's open, high, low or close`, prices.some((v) => Math.abs(v - anchor.price) < 1e-6), `${anchor.price} in ${prices.join(',')}`);
      }
    });
    await ctx.screenshot('magnet');

    await ctx.step('hide all hides, disables the tools and keeps the drawings', async () => {
      const before = await stored();
      await press('Hide all drawings').click();
      check('Hide all pressed', (await pressed('Hide all drawings')) === 'true');
      check('Trend line disabled', await press('Trend line').isDisabled());
      check('Horizontal line disabled', await press('Horizontal line').isDisabled());
      check('title still names the tool', (await press('Trend line').getAttribute('title')) === 'Trend line');
      await page.waitForTimeout(300);
      await ctx.screenshot('hidden');
      check('stored drawings unchanged', JSON.stringify(await stored()) === JSON.stringify(before));
      await press('Hide all drawings').click();
      check('Hide all off again', (await pressed('Hide all drawings')) === 'false');
      check('Trend line enabled again', await press('Trend line').isEnabled());
      await page.waitForTimeout(300);
    });

    await ctx.step('magnet on and hide all off survive a reload', async () => {
      await page.waitForTimeout(700);
      await page.reload();
      await ctx.waitForChart();
      check('Magnet still pressed', (await pressed('Magnet')) === 'true');
      check('Hide all still off', (await pressed('Hide all drawings')) === 'false');
    });

    await ctx.step('delete all asks, removes and is one undo step', async () => {
      page.once('dialog', (d) => void d.dismiss());
      await press('Delete all drawings').click();
      check('a refused confirm keeps the drawing', (await stored()).length === 1);
      page.once('dialog', (d) => void d.accept());
      await press('Delete all drawings').click();
      check('storage is empty', (await stored()).length === 0);
      check('Delete all disabled again', await press('Delete all drawings').isDisabled());
      await page.keyboard.press('Control+z');
      check('Ctrl+Z brings every drawing back', (await stored()).length === 1);
      page.once('dialog', (d) => void d.accept());
      await press('Delete all drawings').click();
      check('left empty for the steps below', (await stored()).length === 0);
      await press('Magnet').click();
      check('Magnet off for the steps below', (await pressed('Magnet')) === 'false');
    });

    let movedMid = { x: 0, y: 0 };
    const at = async (fx: number, fy: number) => {
      const b = await box();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    };

    await ctx.step('draw a trend line', async () => {
      await rail.getByRole('button', { name: 'Trend line' }).click();
      check('Trend line pressed', (await rail.getByRole('button', { name: 'Trend line' }).getAttribute('aria-pressed')) === 'true');
      const a = await at(TA.x, TA.y);
      const b = await at(TB.x, TB.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 15 });
      await page.mouse.up();
      check('one drawing saved', (await stored()).length === 1);
      check('tool back to Cursor', (await rail.getByRole('button', { name: 'Cursor' }).getAttribute('aria-pressed')) === 'true');
    });

    await ctx.step('draw a horizontal line', async () => {
      await rail.getByRole('button', { name: 'Horizontal line' }).click();
      const p = await at(0.5, 0.8);
      await page.mouse.click(p.x, p.y);
      const list = await stored();
      check('two drawings saved', list.length === 2, list.map((d) => d.tool).join(','));
    });

    const drawDrag = async (name: string, from: { x: number; y: number }, to: { x: number; y: number }, total: number) => {
      await rail.getByRole('button', { name, exact: true }).click();
      check(`${name} pressed`, (await rail.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true');
      const a = await at(from.x, from.y);
      const b = await at(to.x, to.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 15 });
      await page.mouse.up();
      const list = await stored();
      check(`${name} saved with 2 anchors`, list.length === total && list[list.length - 1].anchors.length === 2, list.map((d) => d.tool).join(','));
      return list[list.length - 1];
    };
    await ctx.step('draw a ray', async () => {
      const d = await drawDrag('Ray', RAY[0], RAY[1], 3);
      check('stored as ray', d.tool === 'ray');
    });
    await ctx.screenshot('ray');
    await ctx.step('draw a rectangle', async () => {
      const d = await drawDrag('Rectangle', RECT[0], RECT[1], 4);
      check('stored as rectangle', d.tool === 'rectangle');
    });
    await ctx.screenshot('rectangle');
    await ctx.step('draw a Fibonacci retracement', async () => {
      const d = await drawDrag('Fibonacci retracement', FIB[0], FIB[1], 5);
      check('stored as fibRetracement', d.tool === 'fibRetracement');
    });
    await ctx.screenshot('fib');
    await ctx.screenshot('drawn');

    await ctx.step('click the trend line to select it', async () => {
      const empty = await at(0.2, 0.2);
      await page.mouse.click(empty.x, empty.y); // empty chart: nothing selected
      const mid = await at((TA.x + TB.x) / 2, (TA.y + TB.y) / 2);
      await page.mouse.move(mid.x, mid.y);
      const cursor = await page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
      check('pointer cursor over a drawing', cursor === 'pointer', cursor);
      await page.mouse.click(mid.x, mid.y);
      await page.waitForTimeout(200);
    });
    await ctx.screenshot('selected');

    await ctx.step('drag a handle', async () => {
      const before = (await stored()).find((d) => d.tool === 'trendLine')!;
      const h = await at(TB.x, TB.y);
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.move(h.x - 40, h.y - 40, { steps: 10 });
      await page.mouse.up();
      const after = (await stored()).find((d) => d.tool === 'trendLine')!;
      check('second anchor moved', after.anchors[1].time !== before.anchors[1].time && after.anchors[1].price !== before.anchors[1].price);
      check('first anchor kept', JSON.stringify(after.anchors[0]) === JSON.stringify(before.anchors[0]));
    });

    await ctx.step('drag the body', async () => {
      const before = (await stored()).find((d) => d.tool === 'trendLine')!;
      // the midpoint of the (moved) line: between its two anchors
      const bx = await box();
      const ax = bx.x + bx.width * TA.x;
      const ay = bx.y + bx.height * TA.y;
      const ex = bx.x + bx.width * TB.x - 40;
      const ey = bx.y + bx.height * TB.y - 40;
      const mx = (ax + ex) / 2;
      const my = (ay + ey) / 2;
      await page.mouse.move(mx, my);
      await page.mouse.down();
      await page.mouse.move(mx - 30, my + 50, { steps: 10 });
      await page.mouse.up();
      movedMid = { x: mx - 30, y: my + 50 };
      const after = (await stored()).find((d) => d.tool === 'trendLine')!;
      const dt = after.anchors.map((a, i) => a.time - before.anchors[i].time);
      check('both anchors moved by the same time', dt[0] !== 0 && Math.abs(dt[0] - dt[1]) < 1, `${dt.join(',')}`);
    });
    await ctx.screenshot('moved');

    await ctx.step('resize the rectangle by its top-right corner', async () => {
      const mid = await at((RECT[0].x + RECT[1].x) / 2, (RECT[0].y + RECT[1].y) / 2);
      await page.mouse.click(mid.x, mid.y);
      await page.waitForTimeout(200);
      const find = async () => (await stored()).find((d) => d.tool === 'rectangle')!;
      const lows = (d: Awaited<ReturnType<typeof find>>) => ({
        time: Math.min(...d.anchors.map((a) => a.time)),
        price: Math.min(...d.anchors.map((a) => a.price)),
      });
      const before = await find();
      const h = await at(RECT[1].x, RECT[0].y);
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.move(h.x + 40, h.y - 30, { steps: 10 });
      await page.mouse.up();
      const after = await find();
      check('rectangle changed', JSON.stringify(after.anchors) !== JSON.stringify(before.anchors));
      check('bottom-left corner unchanged', JSON.stringify(lows(after)) === JSON.stringify(lows(before)), `${JSON.stringify(lows(before))} -> ${JSON.stringify(lows(after))}`);
      check('top-right corner moved', Math.max(...after.anchors.map((a) => a.time)) > Math.max(...before.anchors.map((a) => a.time)) && Math.max(...after.anchors.map((a) => a.price)) > Math.max(...before.anchors.map((a) => a.price)));
    });
    await ctx.screenshot('rectangle-resized');

    await ctx.step('delete, then undo', async () => {
      await page.keyboard.press('Delete');
      check('four drawings left', (await stored()).length === 4);
      await ctx.screenshot('deleted');
      await page.keyboard.press('Control+z');
      check('undo brings it back', (await stored()).length === 5);
      await page.keyboard.press('Control+Shift+z');
      check('redo removes it again', (await stored()).length === 4);
      await page.keyboard.press('Control+z');
      check('undo again', (await stored()).length === 5);
    });
    await ctx.screenshot('undone');

    await ctx.step('reload keeps all', async () => {
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('five drawings in storage after reload', (await stored()).length === 5);
      const mid = movedMid; // where the trend line sits after the body drag
      await page.mouse.move(mid.x - 20, mid.y - 20);
      await page.mouse.move(mid.x, mid.y, { steps: 5 });
      const cursor = await page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
      check('pointer cursor over the reloaded trend line', cursor === 'pointer', cursor);
    });
    await ctx.screenshot('reloaded');

    await ctx.step('a timeframe change keeps time and price', async () => {
      const before = await stored();
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('drawings unchanged by the change', JSON.stringify(await stored()) === JSON.stringify(before));
    });
    await ctx.screenshot('timeframe');

    await ctx.step('pan still works with drawings present', async () => {
      const shot = () => page.locator('.chart-container').screenshot();
      const first = await shot();
      const y = (await at(0.5, 0.15)).y;
      const b = await box();
      await page.mouse.move(b.x + b.width * 0.8, y);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.4, y, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      check('chart panned', !first.equals(await shot()));
    });
    await ctx.screenshot('panned');

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
