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

const GROUP = 'Shapes';

export const drawingShapes: Scenario = {
  name: 'drawing-shapes',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'The shape tools (Circle, Arrow, Arrow marker, Arrow mark up, Arrow mark down): draw each (clicks, press-drag-release or taps) with a live preview, check an arrow mark lands on a bar time and stays on one when dragged sideways, select with handles, resize the circle, restyle in settings including a label on the marker and a mark, undo and redo, reload and a timeframe change',
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
        const section = menu.getByRole('group', { name: GROUP, exact: true });
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

    await ctx.step('reload and a timeframe change keep every shape', async () => {
      const before = await stored();
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('five drawings after reload', (await stored()).length === 5);
      await ctx.screenshot('reloaded');
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      check('unchanged by the timeframe change', JSON.stringify(await stored()) === JSON.stringify(before));
      await ctx.screenshot('timeframe');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
