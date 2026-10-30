import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; style?: Record<string, unknown>; text?: string };
type Pt = { x: number; y: number };

/** The shape tools: label, stored id, where (canvas fractions) each is placed, clear of the others, and how it is drawn with a mouse. */
const TOOLS = [
  { label: 'Circle', id: 'circle', how: 'drag', at: [{ x: 0.2, y: 0.3 }, { x: 0.28, y: 0.3 }] },
  { label: 'Arrow', id: 'arrow', how: 'clicks', at: [{ x: 0.4, y: 0.75 }, { x: 0.6, y: 0.55 }] },
  { label: 'Arrow marker', id: 'arrowMarker', how: 'drag', at: [{ x: 0.65, y: 0.35 }, { x: 0.9, y: 0.2 }] },
  { label: 'Arrow mark up', id: 'arrowMarkUp', how: 'click', at: [{ x: 0.1, y: 0.7 }] },
  { label: 'Arrow mark down', id: 'arrowMarkDown', how: 'click', at: [{ x: 0.5, y: 0.2 }] },
] as const;
type ToolSpec = (typeof TOOLS)[number];

/** The point-by-point tools: where (canvas fractions) each is placed, clear of the shapes above. */
const PATH_AT = [{ x: 0.12, y: 0.85 }, { x: 0.25, y: 0.78 }, { x: 0.38, y: 0.87 }, { x: 0.52, y: 0.8 }, { x: 0.66, y: 0.88 }];
const POLY_AT = [{ x: 0.72, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.95, y: 0.68 }, { x: 0.8, y: 0.74 }];
const ENTER_AT = [{ x: 0.05, y: 0.5 }, { x: 0.15, y: 0.44 }, { x: 0.27, y: 0.56 }];

const GROUP = 'Shapes';

export const drawingShapes: Scenario = {
  name: 'drawing-shapes',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'The shape tools (Circle, Arrow, Arrow marker, Arrow mark up, Arrow mark down, Path, Polyline, Brush, Highlighter): draw each (clicks, press-drag-release or taps) with a live preview, check an arrow mark lands on a bar time and stays on one when dragged sideways, select with handles, resize the circle, restyle in settings including a label on the marker and a mark, place a Path and a Polyline point by point (ended by double-click or double tap, a click on the first point or Enter; Backspace removes a point, Escape cancels), drag one point or the body, undo and redo, reload and a timeframe change',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as Stored[];
    };
    const one = async (id: string) => (await stored()).find((d) => d.tool === id)!;
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (f: { x: number; y: number }): Promise<Pt> => {
      const b = await box();
      /** The canvas holds the price axis on its right, so x is scaled to stay in the plot on a narrow screen. */
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const narrow = ctx.viewport === 'narrow';
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const dialog = page.getByRole('dialog');

    /** Whether a time is a bar slot: the demo's bars are floored to the timeframe, so a slot is a multiple of it. */
    const onBar = async (time: number): Promise<boolean> => {
      const tf = await page.locator('select[title="Timeframe"]').inputValue();
      const unit: Record<string, number> = { m: 60, h: 3600, d: 86400 };
      const step = Number(tf.slice(0, -1)) * (unit[tf.slice(-1)] ?? 0);
      return step > 0 && time % step === 0;
    };

    const pickTool = async (label: string) => {
      if (narrow) {
        await menuBtn.tap();
        const section = menu.getByRole('group', { name: label === 'Brush' || label === 'Highlighter' ? 'Brushes' : GROUP, exact: true });
        if ((await section.count()) === 0) await menu.getByRole('button', { name: GROUP, exact: true }).tap();
        await section.getByRole('button', { name: label, exact: true }).tap();
        return;
      }
      await rail.getByRole('button', { name: `Open ${GROUP} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    const draw = async (t: ToolSpec) => {
      await pickTool(t.label);
      const pts = await Promise.all(t.at.map(at));
      if (narrow) {
        for (const p of pts) {
          await page.touchscreen.tap(p.x, p.y);
          // Taps close together on the new drawing would read as a double-tap (its settings), so let that window pass.
          await page.waitForTimeout(700);
        }
      } else if (t.how === 'drag') {
        await page.mouse.move(pts[0].x, pts[0].y);
        await page.mouse.down();
        await page.mouse.move(pts[1].x, pts[1].y, { steps: 12 });
        await ctx.screenshot(`preview-${t.id}`);
        await page.mouse.up();
      } else {
        for (const p of pts) {
          await page.mouse.move(p.x, p.y, { steps: 6 });
          if (pts.length > 1 && p === pts[1]) await ctx.screenshot(`preview-${t.id}`);
          await page.mouse.click(p.x, p.y);
        }
      }
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    for (const [i, t] of TOOLS.entries()) {
      await ctx.step(`draw ${t.label}${narrow ? ' by taps' : ` (${t.how})`}`, async () => {
        await draw(t);
        const list = await stored();
        check(`${t.label} stored`, list.length === i + 1 && list[i].tool === t.id && list[i].anchors.length === t.at.length, list.map((d) => `${d.tool}:${d.anchors.length}`).join(','));
        await ctx.screenshot(`drawn-${t.id}`);
      });
    }

    await ctx.step('arrow marks sit on a bar time', async () => {
      for (const id of ['arrowMarkUp', 'arrowMarkDown']) {
        const d = await one(id);
        check(`${id} is on a bar time`, await onBar(d.anchors[0].time), String(d.anchors[0].time));
      }
      await ctx.screenshot('all');
    });

    if (!narrow) {
      const drag = async (from: Pt, to: Pt) => {
        await page.mouse.move(from.x, from.y);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 12 });
        await page.mouse.up();
      };

      await ctx.step('Circle: select, resize by its edge handle, move by the centre handle', async () => {
        await page.keyboard.press('Escape');
        const [c, e] = await Promise.all(TOOLS[0].at.map(at));
        await page.mouse.click(e.x, e.y - 0.0);
        await page.waitForTimeout(300);
        await ctx.screenshot('selected-circle');
        const before = await one('circle');
        await drag(e, { x: e.x + 30, y: e.y });
        const grown = await one('circle');
        check('edge handle resizes, centre stays', grown.anchors[0].time === before.anchors[0].time && grown.anchors[0].price === before.anchors[0].price && grown.anchors[1].time !== before.anchors[1].time);
        await drag(c, { x: c.x, y: c.y + 50 });
        const moved = await one('circle');
        check('centre handle moves the circle, the edge follows', moved.anchors[0].price !== grown.anchors[0].price && moved.anchors[1].price !== grown.anchors[1].price && moved.anchors[1].time === grown.anchors[1].time);
        await page.keyboard.press('Control+z');
        check('undo puts the circle back', JSON.stringify((await one('circle')).anchors) === JSON.stringify(grown.anchors));
        await page.keyboard.press('Control+Shift+z');
      });

      for (const id of ['arrowMarkUp', 'arrowMarkDown'] as const) {
        const t = TOOLS.find((x) => x.id === id)!;
        await ctx.step(`${t.label}: dragged sideways it stays on a bar time, label set in settings`, async () => {
          await page.keyboard.press('Escape');
          const p = await at(t.at[0]);
          const grab = { x: p.x, y: p.y + (id === 'arrowMarkUp' ? 14 : -14) };
          await drag(grab, { x: grab.x + 37, y: grab.y });
          const d = await one(id);
          check(`${t.label} still on a bar time after a drag`, await onBar(d.anchors[0].time), String(d.anchors[0].time));
          const now = { x: p.x + 37, y: grab.y };
          await page.mouse.dblclick(now.x, now.y);
          await dialog.waitFor({ state: 'visible' });
          check('titled for the tool', (await dialog.getByRole('heading').textContent()) === `${t.label} settings`);
          await dialog.getByRole('tab', { name: 'Text', exact: true }).click();
          check('OK is enabled with no label', await dialog.getByRole('button', { name: 'OK' }).isEnabled());
          await dialog.locator('textarea').fill(id === 'arrowMarkUp' ? 'buy' : 'sell');
          await ctx.screenshot(`settings-${id}`);
          await dialog.getByRole('button', { name: 'OK' }).click();
          await dialog.waitFor({ state: 'hidden' });
          check(`${t.label} keeps its label`, (await one(id)).text === (id === 'arrowMarkUp' ? 'buy' : 'sell'));
          await page.keyboard.press('Control+z');
          check('undo removes the label', (await one(id)).text === undefined);
          await page.keyboard.press('Control+Shift+z');
          check('redo restores it', (await one(id)).text !== undefined);
        });
      }

      await ctx.step('Arrow marker: label at the tail, restyled in settings', async () => {
        await page.keyboard.press('Escape');
        const [a, b] = await Promise.all(TOOLS[2].at.map(at));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        await page.mouse.click(mid.x, mid.y);
        await page.waitForTimeout(300);
        await ctx.screenshot('selected-arrowMarker');
        await page.mouse.dblclick(mid.x, mid.y);
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByRole('tab', { name: 'Text', exact: true }).click();
        await dialog.locator('textarea').fill('target');
        await dialog.getByLabel('Bold').check();
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const d = await one('arrowMarker');
        check('marker label and bold stored', d.text === 'target' && d.style?.bold === true, JSON.stringify(d));
        await ctx.screenshot('styled-arrowMarker');
      });

      await ctx.step('Arrow: drawn with its arrow head on by default', async () => {
        check('no style stored for a default arrow', (await one('arrow')).style === undefined);
      });
    }

    /* Path and Polyline: any number of points, ended in the ways TradingView ends them. */
    const count = async (id: string) => (await stored()).filter((d) => d.tool === id).length;
    const tapOnce = async (p: Pt) => {
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(700);
    };
    const place = async (pts: readonly { x: number; y: number }[], shot?: string) => {
      const ps = await Promise.all(pts.map(at));
      for (const [i, p] of ps.entries()) {
        if (narrow) await tapOnce(p);
        else {
          await page.mouse.move(p.x, p.y, { steps: 6 });
          if (shot && i === ps.length - 1) await ctx.screenshot(shot);
          await page.mouse.click(p.x, p.y);
        }
      }
      return ps;
    };

    await ctx.step(`Path: five points ended by a ${narrow ? 'double tap' : 'double-click'}`, async () => {
      await pickTool('Path');
      const ps = await place(PATH_AT.slice(0, 4), 'placing-path');
      await ctx.screenshot('placing-path');
      const last = await at(PATH_AT[4]);
      if (narrow) {
        await page.touchscreen.tap(last.x, last.y);
        await page.touchscreen.tap(last.x, last.y);
      } else {
        await page.mouse.move(last.x, last.y, { steps: 6 });
        await page.mouse.dblclick(last.x, last.y);
      }
      await page.waitForTimeout(500);
      const d = (await stored()).find((x) => x.tool === 'path');
      check('path stored with five points, no duplicate', d?.anchors.length === 5 && ps.length === 4, String(d?.anchors.length));
      check('the double-click did not open the settings', (await dialog.count()) === 0);
      await ctx.screenshot('drawn-path');
    });

    await ctx.step('Polyline: closed by a click on its first point', async () => {
      await pickTool('Polyline');
      await place(POLY_AT);
      const first = await at(POLY_AT[0]);
      if (narrow) await tapOnce(first);
      else {
        await page.mouse.move(first.x + 2, first.y + 1, { steps: 6 });
        await page.mouse.click(first.x + 2, first.y + 1);
      }
      await page.waitForTimeout(500);
      const d = (await stored()).find((x) => x.tool === 'polyline');
      check('polyline stored with four points, none added by the closing click', d?.anchors.length === 4, String(d?.anchors.length));
      await ctx.screenshot('drawn-polyline');
    });

    await ctx.step('Path: ended by Enter; Escape cancels a draft; Backspace removes a point', async () => {
      await pickTool('Path');
      const ps = await place(ENTER_AT);
      check('no drawing yet while placing', (await count('path')) === 1);
      await page.keyboard.press('Backspace');
      await page.mouse.move(ps[1].x + 1, ps[1].y + 1);
      await ctx.screenshot('backspace-path');
      await place([ENTER_AT[2]]);
      await page.keyboard.press('Enter');
      const d = (await stored()).filter((x) => x.tool === 'path')[1];
      check('Enter ends it with the three points left after Backspace and a new click', d?.anchors.length === 3, String(d?.anchors.length));
      await pickTool('Path');
      await place([{ x: 0.35, y: 0.5 }, { x: 0.45, y: 0.45 }]);
      await page.keyboard.press('Escape');
      check('Escape cancels the draft, no drawing saved', (await count('path')) === 2);
      await page.keyboard.press('Control+z');
      check('undo removes the Enter-ended path', (await count('path')) === 1);
      await page.keyboard.press('Control+Shift+z');
      check('redo restores it', (await count('path')) === 2);
    });

    if (!narrow) {
      await ctx.step('Path and Polyline: select, drag one point, drag the body, restyle', async () => {
        await page.keyboard.press('Escape');
        const dragTo = async (from: Pt, to: Pt) => {
          await page.mouse.move(from.x, from.y);
          await page.waitForTimeout(150);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 12 });
          await page.mouse.up();
        };
        const ps = await Promise.all(PATH_AT.map(at));
        await page.mouse.click((ps[1].x + ps[2].x) / 2, (ps[1].y + ps[2].y) / 2);
        await page.waitForTimeout(300);
        await ctx.screenshot('selected-both');
        const before = (await stored()).find((x) => x.tool === 'path')!;
        await dragTo(ps[2], { x: ps[2].x, y: ps[2].y - 40 });
        const one = (await stored()).find((x) => x.tool === 'path')!;
        const moved = one.anchors.map((a, i) => a.price !== before.anchors[i].price);
        check('a handle drag moves only that point', moved.join() === 'false,false,true,false,false', moved.join());
        await dragTo({ x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 }, { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 - 20 });
        const body = (await stored()).find((x) => x.tool === 'path')!;
        check('a body drag moves every point', body.anchors.every((a, i) => a.price !== one.anchors[i].price));
        await page.keyboard.press('Control+z');
        check('undo is one step for the whole drag', JSON.stringify((await stored()).find((x) => x.tool === 'path')!.anchors) === JSON.stringify(one.anchors));
        await page.mouse.dblclick((ps[3].x + ps[4].x) / 2, (ps[3].y + ps[4].y) / 2);
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByLabel('Arrow at end', { exact: true }).check();
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('Path end arrow stored', (await stored()).find((x) => x.tool === 'path')?.style?.arrowEnd === true);
        const poly = await Promise.all(POLY_AT.map(at));
        const inside = { x: (poly[0].x + poly[2].x) / 2, y: (poly[0].y + poly[2].y) / 2 };
        await page.mouse.dblclick(inside.x, inside.y);
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByLabel('Fill opacity', { exact: true }).fill('0.5');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('Polyline fill stored', (await stored()).find((x) => x.tool === 'polyline')?.style?.fillOpacity === 0.5);
        await ctx.screenshot('styled-both');
      });
    }

    const wave = (x0: number, x1: number, y: number, amp: number, n: number): { x: number; y: number }[] =>
      Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y + Math.sin((i / (n - 1)) * Math.PI * 4) * amp }));
    /** A freehand stroke: press, a sequence of moves, release; with a mouse, or with one finger on the narrow screen. */
    const stroke = async (fs: { x: number; y: number }[], mid?: string) => {
      const ps = await Promise.all(fs.map(at));
      if (narrow) {
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: string, p?: Pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
        await touch('touchStart', ps[0]);
        for (const [i, p] of ps.slice(1).entries()) {
          await touch('touchMove', p);
          await page.waitForTimeout(20);
          if (mid && i === Math.floor(ps.length / 2)) await ctx.screenshot(mid);
        }
        await touch('touchEnd');
        await cdp.detach();
        return;
      }
      await page.mouse.move(ps[0].x, ps[0].y);
      await page.mouse.down();
      for (const [i, p] of ps.slice(1).entries()) {
        await page.mouse.move(p.x, p.y, { steps: 2 });
        if (mid && i === Math.floor(ps.length / 2)) await ctx.screenshot(mid);
      }
      await page.mouse.up();
    };

    await ctx.step('Brush and Highlighter: draw freehand, thinned and stored', async () => {
      await page.keyboard.press('Escape');
      await pickTool('Brush');
      await stroke(wave(0.05, 0.3, 0.64, 0.05, 60), 'preview-brush');
      const b = (await stored()).find((x) => x.tool === 'brush');
      check('Brush stored with 2 to 200 anchors', !!b && b.anchors.length >= 2 && b.anchors.length <= 200, String(b?.anchors.length));
      await pickTool('Highlighter');
      await stroke(wave(0.12, 0.45, 0.12, 0.03, 50), 'preview-highlighter');
      const h = (await stored()).find((x) => x.tool === 'highlighter');
      check('Highlighter stored with 2 to 200 anchors', !!h && h.anchors.length >= 2 && h.anchors.length <= 200, String(h?.anchors.length));
      await ctx.screenshot('drawn-brushes');
    });

    if (!narrow) {
      await ctx.step('Brush and Highlighter: select, move by the body, undo and redo, restyle', async () => {
        const dragTo = async (from: Pt, to: Pt) => {
          await page.mouse.move(from.x, from.y);
          await page.waitForTimeout(150);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 12 });
          await page.mouse.up();
        };
        const onStroke = async (f: { x: number; y: number }[], i: number) => at(f[i]);
        const bw = wave(0.05, 0.3, 0.64, 0.05, 60);
        const bp = await onStroke(bw, 0);
        const before = (await stored()).find((x) => x.tool === 'brush')!;
        await dragTo(bp, { x: bp.x + 30, y: bp.y - 20 });
        const moved = (await stored()).find((x) => x.tool === 'brush')!;
        check('a body drag moves every brush point', moved.anchors.every((a, i) => a.time !== before.anchors[i].time || a.price !== before.anchors[i].price));
        await ctx.screenshot('selected-brush');
        await page.keyboard.press('Control+z');
        check('undo puts the brush back', JSON.stringify((await stored()).find((x) => x.tool === 'brush')!.anchors) === JSON.stringify(before.anchors));
        await page.keyboard.press('Control+Shift+z');
        check('redo moves it again', JSON.stringify((await stored()).find((x) => x.tool === 'brush')!.anchors) === JSON.stringify(moved.anchors));
        const mp = await at({ x: bw[0].x + 30 / ((await box()).width * 0.7), y: bw[0].y - 20 / (await box()).height });
        await page.mouse.dblclick(mp.x, mp.y);
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByLabel('Smoothing', { exact: true }).fill('20');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('Brush smoothing stored', (await stored()).find((x) => x.tool === 'brush')?.style?.smoothing === 20);
        check('smoothing restyles without changing the stored points', (await stored()).find((x) => x.tool === 'brush')!.anchors.length === before.anchors.length);
        const hw = wave(0.12, 0.45, 0.12, 0.03, 50);
        const hp = await at(hw[0]);
        await page.mouse.dblclick(hp.x, hp.y);
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByLabel('Width', { exact: true }).fill('30');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('Highlighter width stored', (await stored()).find((x) => x.tool === 'highlighter')?.style?.width === 30);
        await page.keyboard.press('Escape');
        await ctx.screenshot('styled-brushes');
      });
    }

    await ctx.step('reload and a timeframe change keep every shape', async () => {
      const before = await stored();
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('ten drawings after reload', (await stored()).length === 10);
      const strokes = (await stored()).filter((x) => x.tool === 'brush' || x.tool === 'highlighter');
      check('both strokes keep 2 to 200 points', strokes.length === 2 && strokes.every((x) => x.anchors.length >= 2 && x.anchors.length <= 200), strokes.map((x) => x.anchors.length).join());
      await ctx.screenshot('reloaded');
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('unchanged by the timeframe change', JSON.stringify(await stored()) === JSON.stringify(before));
      await ctx.screenshot('timeframe');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
