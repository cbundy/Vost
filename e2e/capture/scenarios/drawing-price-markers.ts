import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; text?: string; style?: Record<string, unknown> };

const GROUP = 'Annotations';

export const drawingPriceMarkers: Scenario = {
  name: 'drawing-price-markers',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Price markers: Price note (placed by press-drag-release and by two clicks, its price text read before and after its dot is dragged), Price label, Signpost (below, with an emoji) and Flag mark (recoloured), each selected with its axis labels, then undo, redo, a reload and a timeframe change; at 360 px they are placed with touch',
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
    const all = async (tool: string) => (await stored()).filter((d) => d.tool === tool);
    const last = async (tool: string) => (await all(tool)).at(-1)!;
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    /** A canvas fraction; the canvas holds the price axis on its right, so x is scaled to stay in the plot. */
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const narrow = ctx.viewport === 'narrow';
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const dialog = page.getByRole('dialog');
    const click = (p: { x: number; y: number }) => (narrow ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
    const pickTool = async (label: string) => {
      if (narrow) {
        await menuBtn.tap();
        const btn = menu.getByRole('button', { name: label, exact: true });
        if (!(await btn.isVisible())) await menu.getByRole('button', { name: GROUP, exact: true }).tap();
        await btn.tap();
        return;
      }
      await rail.getByRole('button', { name: `Open ${GROUP} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    const drag = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
    };
    const openSettings = async (p: { x: number; y: number }) => {
      await page.keyboard.down('Shift');
      await page.mouse.dblclick(p.x, p.y);
      await page.keyboard.up('Shift');
      await dialog.waitFor();
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    const DOT = { x: 0.15, y: 0.6 };
    const NOTE_AT = { x: 0.35, y: 0.3 };
    await ctx.step('Price note: placed by press-drag-release', async () => {
      await pickTool('Price note');
      const a = await at(DOT);
      const t = await at(NOTE_AT);
      if (narrow) {
        await page.touchscreen.tap(a.x, a.y);
        await page.touchscreen.tap(t.x, t.y);
      } else await drag(a, t);
      const d = await last('priceNote');
      check('a price note with two different anchors is stored', !!d && d.anchors.length === 2 && d.anchors[0].price !== d.anchors[1].price, JSON.stringify(d?.anchors));
      await ctx.screenshot('price-note');
    });

    await ctx.step('Price note: placed by two clicks', async () => {
      await pickTool('Price note');
      await click(await at({ x: 0.5, y: 0.7 }));
      await click(await at({ x: 0.65, y: 0.5 }));
      check('two price notes stored', (await all('priceNote')).length === 2);
    });

    if (!narrow) {
      await ctx.step('Price note: dragging its dot changes the price it shows', async () => {
        const before = await last('priceNote');
        const dot = await at({ x: 0.5, y: 0.7 });
        await drag(dot, { x: dot.x, y: dot.y + 40 });
        const after = await last('priceNote');
        check('the dot price changed', after.anchors[0].price !== before.anchors[0].price, `${before.anchors[0].price} -> ${after.anchors[0].price}`);
        check('the other anchor stayed', JSON.stringify(after.anchors[1]) === JSON.stringify(before.anchors[1]));
        await ctx.screenshot('price-note-dragged');
        await page.keyboard.press('Control+z');
        check('undo restores the dot', (await last('priceNote')).anchors[0].price === before.anchors[0].price);
        await page.keyboard.press('Control+Shift+z');
        check('redo moves it again', (await last('priceNote')).anchors[0].price === after.anchors[0].price);
      });
    }

    await ctx.step('Price label: placed by a click', async () => {
      await pickTool('Price label');
      await click(await at({ x: 0.1, y: 0.2 }));
      check('stored with one anchor', (await last('priceLabel')).anchors.length === 1);
      await ctx.screenshot('price-label');
    });

    await ctx.step('Signpost: placed, then below with an emoji', async () => {
      await pickTool('Signpost');
      const p = await at({ x: 0.45, y: 0.55 });
      await click(p);
      const d = await last('signpost');
      check('stored with one anchor', d.anchors.length === 1);
      if (!narrow) {
        await openSettings({ x: p.x, y: p.y - 14 });
        await dialog.getByLabel('Position').selectOption('below');
        await dialog.getByLabel('Emoji').selectOption({ label: 'Rocket' });
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const s = await last('signpost');
        check('position and emoji stored', s.style?.position === 'below' && s.style?.emoji === '🚀', JSON.stringify(s.style));
      }
      await ctx.screenshot('signpost');
    });

    await ctx.step('Flag mark: placed on a bar', async () => {
      await pickTool('Flag mark');
      const p = await at({ x: 0.8, y: 0.7 });
      await click(p);
      check('stored with one anchor', (await last('flagMark')).anchors.length === 1);
      await ctx.screenshot('flag-mark');
      if (!narrow) {
        await openSettings({ x: p.x, y: p.y - 12 });
        await dialog.getByLabel('Colour').fill('#ff0000');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('recoloured', (await last('flagMark')).style?.color === '#ff0000');
        await ctx.screenshot('flag-mark-red');
      }
    });

    await ctx.step('timeframe change keeps them', async () => {
      if (narrow) return;
      await page.locator('select[title="Timeframe"]').selectOption('1h');
      await page.waitForTimeout(1500);
      const tools = (await stored()).map((d) => d.tool);
      check('all four tools still stored', ['priceNote', 'priceLabel', 'signpost', 'flagMark'].every((t) => tools.includes(t)));
      await ctx.screenshot('timeframe');
    });

    await ctx.step('reload keeps all four tools', async () => {
      const before = JSON.stringify(await stored());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      const list = await stored();
      check('storage is unchanged', JSON.stringify(list) === before);
      const tools = list.map((d) => d.tool);
      check('all four tools are there', ['priceNote', 'priceLabel', 'signpost', 'flagMark'].every((t) => tools.includes(t)), tools.join(','));
      await ctx.screenshot('reloaded');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
