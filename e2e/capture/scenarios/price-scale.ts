import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[] };

export const priceScale: Scenario = {
  name: 'price-scale',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Price scale modes on the main chart: the A and L buttons show only while the pointer is over the price scale (a tap on a touch screen), L turns log on and off, a drag of the scale turns A off and A fits again, the right-click menu picks Linear, Logarithmic, Percent or Indexed to 100 with a trend line staying in place, the mode is kept after a reload, and Reset view keeps the mode and turns auto on',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const narrow = ctx.viewport === 'narrow';
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as Stored[];
    };
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const buttons = page.locator('.price-scale-buttons');
    const btnA = buttons.getByRole('button', { name: 'A', exact: true });
    const btnL = buttons.getByRole('button', { name: 'L', exact: true });
    const pressed = async (b: typeof btnA) => (await b.getAttribute('aria-pressed')) === 'true';
    /** A point on the price scale of the main pane, and one in the plot. */
    const onScale = async () => {
      const b = await box();
      return { x: b.x + b.width - 25, y: b.y + b.height * 0.4 };
    };
    const inPlot = async () => {
      const b = await box();
      return { x: b.x + b.width * 0.7, y: b.y + b.height * 0.12 };
    };
    const savedMode = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(`JSON.parse(localStorage.getItem('vost.prefs.v1') ?? '{}').priceScaleMode ?? 'linear'`)) as string;
    };
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const pickTool = async (group: string, label: string) => {
      if (narrow) {
        await menuBtn.tap();
        const btn = menu.getByRole('button', { name: label, exact: true });
        if (!(await btn.isVisible())) await menu.getByRole('button', { name: group, exact: true }).tap();
        await btn.tap();
        return;
      }
      await rail.getByRole('button', { name: `Open ${group} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    const pickMode = async (label: string) => {
      await page.mouse.click(0, 0);
      const p = await inPlot();
      await page.mouse.click(p.x, p.y, { button: 'right' });
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      await page.waitForTimeout(500);
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    await ctx.step('draw a trend line', async () => {
      await pickTool('Lines', 'Trend line');
      const b = await box();
      const a = { x: b.x + b.width * 0.12, y: b.y + b.height * 0.7 };
      const z = { x: b.x + b.width * 0.5, y: b.y + b.height * 0.4 };
      if (narrow) {
        for (const p of [a, z]) {
          await page.touchscreen.tap(p.x, p.y);
          await page.waitForTimeout(150);
        }
      } else {
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(z.x, z.y, { steps: 12 });
        await page.mouse.up();
      }
      const list = await stored();
      check('trend line stored', list.length === 1 && list[0].tool === 'trendLine' && list[0].anchors.length === 2, list.map((d) => d.tool).join(','));
    });
    const trend = (await stored())[0];

    await ctx.step('no buttons while the pointer is off the price scale', async () => {
      const p = await inPlot();
      if (!narrow) await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(300);
      check('buttons hidden', (await buttons.count()) === 0);
      await ctx.screenshot('off-scale');
    });

    await ctx.step('over the price scale the buttons show: A lit, L dark', async () => {
      const s = await onScale();
      if (narrow) await page.touchscreen.tap(s.x, s.y);
      else await page.mouse.move(s.x, s.y);
      await btnA.waitFor();
      check('A lit', await pressed(btnA));
      check('L dark', !(await pressed(btnL)));
      await ctx.screenshot('buttons');
    });

    if (!narrow) {
      await ctx.step('the buttons stay while the pointer moves onto them, and go when it leaves', async () => {
        const r = await btnL.boundingBox();
        if (!r) throw new Error('no L box');
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 8 });
        check('still shown over the button', (await buttons.count()) === 1);
        const p = await inPlot();
        await page.mouse.move(p.x, p.y, { steps: 4 });
        await page.waitForTimeout(200);
        check('hidden after leaving', (await buttons.count()) === 0);
      });

      await ctx.step('L turns log on and off', async () => {
        const s = await onScale();
        await page.mouse.move(s.x, s.y);
        await btnL.click();
        await page.waitForTimeout(400);
        check('log saved', (await savedMode()) === 'log');
        check('L lit', await pressed(btnL));
        await ctx.screenshot('log');
        await btnL.click();
        await page.waitForTimeout(400);
        check('linear saved', (await savedMode()) === 'linear');
        check('L dark', !(await pressed(btnL)));
      });

      await ctx.step('dragging the price scale turns A off, A fits again', async () => {
        const s = await onScale();
        await page.mouse.move(s.x, s.y);
        await page.mouse.down();
        await page.mouse.move(s.x, s.y - 80, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        await btnA.waitFor();
        check('A dark after the drag', !(await pressed(btnA)));
        await ctx.screenshot('dragged');
        await btnA.click();
        await page.waitForTimeout(400);
        check('A lit again', await pressed(btnA));
        await ctx.screenshot('fitted');
      });

      for (const [label, id] of [['Logarithmic', 'log'], ['Percent', 'percent'], ['Indexed to 100', 'indexed']] as const) {
        await ctx.step(`right-click menu: ${label}`, async () => {
          const p = await inPlot();
          await page.mouse.move(p.x, p.y);
          await page.mouse.click(p.x, p.y, { button: 'right' });
          const group = page.getByRole('menuitemradio');
          check('four modes listed', (await group.count()) === 4);
          check('Linear checked first', (await page.getByRole('menuitemradio', { name: 'Linear', exact: true }).getAttribute('aria-checked')) === 'true');
          check('Auto is a checkbox, on', (await page.getByRole('menuitemcheckbox', { name: /Auto/ }).getAttribute('aria-checked')) === 'true');
          if (id === 'log') await ctx.screenshot('menu');
          await page.getByRole('menuitemradio', { name: label, exact: true }).click();
          await page.waitForTimeout(500);
          check(`${label} saved`, (await savedMode()) === id);
          check('trend line price unchanged in storage', JSON.stringify((await stored())[0].anchors) === JSON.stringify(trend.anchors));
          await ctx.screenshot(id);
          await pickMode('Linear');
        });
      }

      await ctx.step('in each mode a ray placed on a fixed row holds the price the menu offers on that row', async () => {
        for (const [label, id] of [['Logarithmic', 'log'], ['Percent', 'percent'], ['Indexed to 100', 'indexed'], ['Linear', 'linear']] as const) {
          await pickMode(label);
          const b = await box();
          const y = b.y + b.height * 0.25;
          const before = (await stored()).length;
          await pickTool('Lines', 'Horizontal ray');
          await page.mouse.click(b.x + b.width * 0.8, y);
          const list = await stored();
          check(`${id}: ray stored`, list.length === before + 1);
          const stored$ = list[list.length - 1].anchors[0].price;
          await page.keyboard.press('Escape');
          await page.mouse.click(b.x + 8, y, { button: 'right' });
          const item = await page.getByRole('menuitem', { name: /^Add alert at/ }).innerText();
          await page.keyboard.press('Escape');
          const offered = Number(item.replace('Add alert at ', ''));
          check(`${id}: stored ${stored$.toFixed(2)} vs alert price ${offered}`, Math.abs(offered - stored$) < 0.1);
        }
      });

      await ctx.step('Auto in the menu toggles auto scale, Reset view keeps the mode and turns auto on', async () => {
        await pickMode('Percent');
        const p = await inPlot();
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.getByRole('menuitemcheckbox', { name: /Auto/ }).click();
        await page.waitForTimeout(300);
        const s = await onScale();
        await page.mouse.move(s.x, s.y);
        await btnA.waitFor();
        check('A dark after Auto off', !(await pressed(btnA)));
        await page.locator('button[title="Reset view"]').click();
        await page.waitForTimeout(800);
        await page.mouse.move(s.x, s.y - 5);
        check('A lit after Reset view', await pressed(btnA));
        check('mode kept after Reset view', (await savedMode()) === 'percent');
        await ctx.screenshot('reset');
      });

      await ctx.step('the mode is kept after a reload', async () => {
        await page.reload();
        await ctx.waitForChart();
        check('percent after reload', (await savedMode()) === 'percent');
        const p = await inPlot();
        await page.mouse.click(p.x, p.y, { button: 'right' });
        check('Percent checked', (await page.getByRole('menuitemradio', { name: 'Percent', exact: true }).getAttribute('aria-checked')) === 'true');
        await page.keyboard.press('Escape');
        await ctx.screenshot('reloaded');
      });
    } else {
      await ctx.step('a tap elsewhere hides the buttons; L works by tap', async () => {
        await btnL.tap();
        await page.waitForTimeout(400);
        check('log saved', (await savedMode()) === 'log');
        await ctx.screenshot('log');
        const p = await inPlot();
        await page.touchscreen.tap(p.x, p.y);
        await page.waitForTimeout(300);
        check('buttons hidden after a tap elsewhere', (await buttons.count()) === 0);
      });
    }
    await ctx.writeText('checks', [...checks, ''].join('\n'));
  },
};
