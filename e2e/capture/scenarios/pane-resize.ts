import type { Page } from 'playwright';
import type { Scenario, ScenarioContext } from '../scenario.ts';

interface Probe {
  sidebar: string | null;
  dock: string | null;
  chart: { width: number; height: number };
  overflowX: boolean;
  overflowY: boolean;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const el = document.documentElement;
    const out = [...document.querySelectorAll('.topbar, .app-body, .sidebar, .chart-area, .dock')].some((e) => {
      const r = e.getBoundingClientRect();
      return r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
    });
    const c = document.querySelector('.chart-container')!.getBoundingClientRect();
    return {
      sidebar: document.querySelector('[aria-label="Resize sidebar"]')?.getAttribute('aria-valuenow') ?? null,
      dock: document.querySelector('[aria-label="Resize bottom panel"]')?.getAttribute('aria-valuenow') ?? null,
      chart: { width: Math.round(c.width), height: Math.round(c.height) },
      overflowX: out,
      overflowY: el.scrollHeight > el.clientHeight,
    };
  });
}

export const paneResize: Scenario = {
  name: 'pane-resize',
  description: 'Drag and keyboard resizing of the sidebar and the bottom dock, reset, saved sizes, chart re-fit and no overflow',
  video: true,
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const log: string[] = [];
    const check = (label: string) =>
      ctx.step(`check ${label}`, async () => {
        await page.waitForTimeout(300);
        const p = await probe(page);
        log.push(`${label}: sidebar=${p.sidebar} dock=${p.dock} chart=${p.chart.width}x${p.chart.height} overflowX=${p.overflowX} overflowY=${p.overflowY}`);
        if (p.overflowX || p.overflowY) throw new Error(`page overflows (${label})`);
        if (p.chart.width < 200 || p.chart.height < 200) throw new Error(`chart too small: ${p.chart.width}x${p.chart.height}`);
      });
    const shot = async (name: string) => {
      await check(name);
      await ctx.screenshot(name);
    };
    await ctx.step('seed sizes and open app', async () => {
      await page.addInitScript(() => {
        localStorage.setItem(
          'vost.prefs.v1',
          JSON.stringify({ providerId: 'demo', symbol: 'DEMO', timeframe: '1d', sidebarWidth: 340, dockHeight: 420 }),
        );
      });
      await page.goto('/');
    });
    await ctx.waitForChart();
    await shot('seeded');

    const sidebar = page.getByRole('separator', { name: 'Resize sidebar' });
    const dock = page.getByRole('separator', { name: 'Resize bottom panel' });
    const drag = async (loc: ReturnType<Page['getByRole']>, dx: number, dy: number) => {
      const b = await loc.boundingBox();
      if (!b) throw new Error('splitter has no box');
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 15 });
      await page.mouse.up();
    };
    await ctx.step('drag the sidebar splitter', () => drag(sidebar, -80, 0));
    await ctx.step('drag the dock splitter', () => drag(dock, 0, 90));
    await shot('dragged');

    await ctx.step('keyboard on the sidebar', async () => {
      await sidebar.focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Shift+ArrowRight');
    });
    await shot('sidebar-focus');
    await ctx.step('End on the sidebar', () => page.keyboard.press('End'));
    await shot('sidebar-max');
    await ctx.step('keyboard on the dock', async () => {
      await dock.focus();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('End');
    });
    await shot('dock-max');
    await ctx.step('Home collapses the dock', () => page.keyboard.press('Home'));
    await shot('dock-collapsed');
    await ctx.step('ArrowUp expands it again', () => page.keyboard.press('ArrowUp'));
    await check('dock-expanded');

    await ctx.step('double-click resets', async () => {
      await sidebar.dblclick();
      await dock.dblclick();
    });
    await shot('reset');
    await ctx.step('reset values', async () => {
      const p = await probe(page);
      if (p.sidebar !== '264' || p.dock !== '320') throw new Error(`reset gave ${p.sidebar} / ${p.dock}`);
    });

    await ctx.step('resize the window', () => page.setViewportSize({ width: 1280, height: 720 }));
    await shot('small-window');
    await ctx.step('large sizes clamp on a small window', async () => {
      await sidebar.focus();
      await page.keyboard.press('End');
      await dock.focus();
      await page.keyboard.press('End');
    });
    await shot('small-window-max');
    await writeLog(ctx, log);
  },
};

async function writeLog(ctx: ScenarioContext, log: string[]): Promise<void> {
  await ctx.writeText('checks', `${log.join('\n')}\n`);
}
