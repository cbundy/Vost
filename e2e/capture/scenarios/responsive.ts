import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

interface Layout {
  scrollWidth: number;
  innerWidth: number;
  topbarHeight: number;
  clipped: string[];
  chartHeight: number;
  clockInside: boolean;
  collapseInside: boolean;
  dock: { height: number; bottom: number };
  innerHeight: number;
  scrollHeight: number;
  clientHeight: number;
  hasMore: boolean;
  hasSidebarSplitter: boolean;
  sidebarVisible: boolean;
  /** The icon rail's box, or null when it is not in the page. */
  rail: { left: number; right: number; width: number; top: number; bottom: number } | null;
  panelLeft: number | null;
  chartRight: number;
  /** The drawer's right edge, or null when it is not open. */
  drawerRight: number | null;
}

async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const W = innerWidth;
    const clipped: string[] = [];
    for (const sel of ['.topbar', '.dock-tabs', '.chart-range-bar', '.app-body', '.dock', '.modal', '.sidebar.drawer', '.topbar-more-pop']) {
      for (const root of document.querySelectorAll(sel)) {
        for (const e of [root, ...root.querySelectorAll('*')]) {
          // a scroller's content may extend past its own box; only boxes that are not inside one count
          const r = e.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          let inScroller = false;
          for (let p = e.parentElement; p && p !== root.parentElement; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === 'auto' || o === 'scroll' || o === 'hidden') {
              inScroller = true;
              break;
            }
          }
          if (inScroller && e !== root) continue;
          if (r.right > W + 1 || r.left < -1) clipped.push(`${sel} ${e.tagName.toLowerCase()}.${(e as HTMLElement).className} right=${Math.round(r.right)}`);
        }
      }
    }
    const inside = (q: string) => {
      const e = document.querySelector(q);
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.left >= 0 && r.right <= W + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5;
    };
    const dock = document.querySelector('.dock')!.getBoundingClientRect();
    const sb = document.querySelector('.sidebar');
    const railEl = document.querySelector('.side-rail')?.getBoundingClientRect();
    const drawerEl = document.querySelector('.sidebar.drawer')?.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: W,
      topbarHeight: Math.round(document.querySelector('.topbar')!.getBoundingClientRect().height),
      clipped,
      chartHeight: Math.round(document.querySelector('.chart-container')!.getBoundingClientRect().height),
      clockInside: inside('.zone-clock-btn'),
      collapseInside: inside('.dock-tabs > button[title="Collapse"], .dock-tabs > button[title="Expand"]'),
      dock: { height: Math.round(dock.height), bottom: Math.round(dock.bottom) },
      innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      hasMore: document.querySelector('.topbar-more') != null,
      hasSidebarSplitter: document.querySelector('[aria-label="Resize sidebar"]') != null,
      sidebarVisible: sb != null && sb.getBoundingClientRect().width > 0,
      rail: railEl ? { left: railEl.left, right: railEl.right, width: railEl.width, top: railEl.top, bottom: railEl.bottom } : null,
      panelLeft: sb && !drawerEl ? sb.getBoundingClientRect().left : null,
      chartRight: document.querySelector('.chart-area')!.getBoundingClientRect().right,
      drawerRight: drawerEl ? drawerEl.right : null,
    };
  });
}

const CSV = ['time,open,high,low,close,volume', ...Array.from({ length: 12 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')},10,12,9,11,1000`)].join('\n');

export const responsive: Scenario = {
  name: 'responsive',
  description: 'Layout at phone, tablet and desktop sizes: no overflow, the sidebar drawer, the top bar More menu, the dock tab strip and both dialogs',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const log: string[] = [];
    const sizes: Array<[number, number]> = [[360, 740], [768, 1024], [1024, 768], [1920, 1080], [740, 360], [1281, 800], [1280, 800], [1440, 900]];

    const check = (label: string, opts: { chart?: boolean } = {}) =>
      ctx.step(`check ${label}`, async () => {
        await page.waitForTimeout(250);
        const l = await layout(page);
        log.push(`${label}: scrollWidth=${l.scrollWidth}/${l.innerWidth} topbar=${l.topbarHeight} chartH=${l.chartHeight} dock=${l.dock.height} more=${l.hasMore} clipped=${l.clipped.length}`);
        if (l.scrollWidth > l.innerWidth) throw new Error(`${label}: horizontal overflow ${l.scrollWidth} > ${l.innerWidth}`);
        if (l.clipped.length) throw new Error(`${label}: past the viewport: ${l.clipped.slice(0, 3).join('; ')}`);
        if (l.topbarHeight !== 40) throw new Error(`${label}: top bar is ${l.topbarHeight}px tall`);
        if (l.scrollHeight > l.clientHeight) throw new Error(`${label}: vertical overflow ${l.scrollHeight} > ${l.clientHeight}`);
        if (opts.chart !== false) {
          if (l.chartHeight < 200) throw new Error(`${label}: chart is ${l.chartHeight}px tall`);
          if (!l.clockInside) throw new Error(`${label}: zone clock not fully visible`);
          if (!l.collapseInside) throw new Error(`${label}: dock collapse button not fully visible`);
        }
        return l;
      });
    const expect = (cond: boolean, msg: string) => {
      if (!cond) throw new Error(msg);
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    for (const [w, h] of sizes) {
      await ctx.step(`resize ${w}x${h}`, () => page.setViewportSize({ width: w, height: h }));
      const l = await check(`${w}x${h}`);
      if (w <= 900) {
        expect(!l.sidebarVisible && !l.hasSidebarSplitter, `${w}x${h}: sidebar or splitter shown in drawer mode`);
        expect(l.rail != null && Math.abs(l.rail.right - l.innerWidth) <= 1 && l.rail.width >= 36 && l.rail.width <= 44, `${w}x${h}: icon rail is not about 40px wide at the right edge in drawer mode`);
        expect(l.rail != null && l.rail.top >= l.topbarHeight - 1 && Math.abs(l.chartRight - l.rail.left) <= 4, `${w}x${h}: the chart does not end where the rail begins`);
      } else {
        expect(l.sidebarVisible && l.hasSidebarSplitter, `${w}x${h}: desktop sidebar or splitter missing`);
        expect(l.rail != null && Math.abs(l.rail.right - l.innerWidth) <= 1 && l.rail.width >= 36 && l.rail.width <= 44, `${w}x${h}: icon rail is not about 40px wide at the right edge`);
        expect(l.rail != null && l.panelLeft != null && l.panelLeft >= l.chartRight - 4 && l.panelLeft < l.rail.left, `${w}x${h}: the panel is not right of the chart and left of the rail`);
      }
      expect((await page.getByRole('button', { name: 'Toggle sidebar' }).count()) === 0, `${w}x${h}: a Toggle sidebar button is present`);
      if (w > 1280) expect(!l.hasMore, `${w}x${h}: More button present on a wide screen`);
      else expect(l.hasMore, `${w}x${h}: More button missing`);
      if (w === 360 || w === 768 || w === 1024 || w === 1920 || w === 740) await ctx.screenshot(`${w}x${h}`);
    }

    const toggle = page.getByRole('toolbar', { name: 'Side panel' }).getByRole('button', { name: 'Watchlist', exact: true });
    const drawer = page.getByRole('dialog', { name: 'Sidebar' });
    const focusInfo = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        const d = document.querySelector('.sidebar.drawer');
        return { label: a?.getAttribute('aria-label') ?? null, inDrawer: !!(d && a && d.contains(a)), isToggle: a?.getAttribute('aria-label') === 'Watchlist' && !!a.closest('.side-rail') };
      });

    for (const [w, h] of [[360, 740], [768, 1024]] as const) {
      await ctx.step(`drawer at ${w}x${h}`, async () => {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(250);
        expect((await drawer.count()) === 0, 'drawer present at load');
        expect((await toggle.getAttribute('aria-expanded')) === 'false', 'rail button not collapsed at load');
        expect((await toggle.getAttribute('aria-controls')) === 'sidebar', 'rail button has no aria-controls');
        expect((await toggle.getAttribute('aria-haspopup')) === 'dialog', 'rail button has no aria-haspopup');
        expect((await toggle.getAttribute('aria-pressed')) === 'false', 'rail button pressed while the drawer is closed');
        await toggle.click();
        await drawer.waitFor({ state: 'visible' });
        expect((await drawer.getAttribute('aria-modal')) === 'true', 'drawer is not aria-modal');
        expect((await toggle.getAttribute('aria-expanded')) === 'true', 'rail button not expanded');
        expect((await focusInfo()).label === 'Close sidebar', 'focus did not move to the close button');
      });
      await ctx.screenshot(`drawer-${w}`);
      await check(`drawer-${w}`);
      await ctx.step(`Tab stays in the drawer at ${w}`, async () => {
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
          expect((await focusInfo()).inDrawer, `focus left the drawer on Tab ${i + 1}`);
        }
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press('Tab');
          expect((await focusInfo()).inDrawer, `focus left the drawer on forward Tab ${i + 1}`);
        }
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press('Shift+Tab');
          expect((await focusInfo()).inDrawer, `focus left the drawer on Shift+Tab ${i + 1}`);
        }
      });
      await ctx.step(`Escape closes it at ${w}`, async () => {
        await page.keyboard.press('Escape');
        await drawer.waitFor({ state: 'detached' });
        expect((await focusInfo()).isToggle, 'focus is not back on the rail button');
        await page.keyboard.press('Escape');
        expect((await drawer.count()) === 0, 'Escape on a closed drawer did something');
      });
      await ctx.step(`backdrop closes it at ${w}`, async () => {
        await toggle.click();
        await drawer.waitFor({ state: 'visible' });
        await page.mouse.click(4, h - 4);
        await drawer.waitFor({ state: 'detached' });
        expect((await focusInfo()).isToggle, 'focus is not back on the rail button after the backdrop');
      });
      await ctx.step(`close button closes it at ${w}`, async () => {
        await toggle.click();
        await drawer.waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Close sidebar' }).click();
        await drawer.waitFor({ state: 'detached' });
        expect((await focusInfo()).isToggle, 'focus is not back on the rail button after the close button');
      });
    }

    await ctx.step('the drawer is fixed to the right edge and carries the three section buttons', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await toggle.click();
      await drawer.waitFor({ state: 'visible' });
      await page.waitForTimeout(250);
      const l = await layout(page);
      expect(l.drawerRight != null && Math.abs(l.drawerRight - l.innerWidth) <= 1, `drawer right edge ${l.drawerRight} is not the viewport's ${l.innerWidth}`);
      for (const name of ['Watchlist', 'Data and library', 'Indicators']) {
        await drawer.getByRole('button', { name, exact: true }).waitFor();
      }
      expect((await drawer.getByRole('button', { name: 'Watchlist', exact: true }).getAttribute('aria-pressed')) === 'true', 'the drawer does not open on the stored Watchlist section');
      await drawer.getByRole('button', { name: 'Indicators', exact: true }).click();
      await drawer.locator('#add-indicator-select').waitFor();
      await ctx.screenshot('drawer-indicators');
      await drawer.getByRole('button', { name: 'Watchlist', exact: true }).click();
      await ctx.screenshot('drawer');
      await page.keyboard.press('Escape');
      await drawer.waitFor({ state: 'detached' });
    });

    await ctx.step('the Indicators rail button opens the drawer on Indicators', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.getByRole('toolbar', { name: 'Side panel' }).getByRole('button', { name: 'Indicators', exact: true }).click();
      await drawer.waitFor({ state: 'visible' });
      expect((await drawer.getByRole('button', { name: 'Indicators', exact: true }).getAttribute('aria-pressed')) === 'true', 'Indicators not pressed in the drawer');
      await drawer.locator('#add-indicator-select').waitFor({ state: 'visible' });
      await drawer.getByRole('button', { name: 'Watchlist', exact: true }).click();
      await page.keyboard.press('Escape');
      await drawer.waitFor({ state: 'detached' });
    });

    await ctx.step('Import CSV from the drawer closes it first', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await toggle.click();
      await drawer.waitFor({ state: 'visible' });
      await drawer.getByRole('button', { name: 'Data and library', exact: true }).click();
      await drawer.getByRole('button', { name: 'Import CSV' }).click();
      await page.getByRole('heading', { name: /Import/ }).first().waitFor();
      expect((await drawer.count()) === 0, 'drawer still open behind the modal');
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    });

    // 360x740: the More menu
    const more = page.getByRole('button', { name: 'More', exact: true });
    await ctx.step('More menu at 360', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(250);
      expect((await more.getAttribute('aria-haspopup')) === 'dialog', 'More has no aria-haspopup');
      await more.click();
      const pop = page.getByRole('dialog', { name: 'More' });
      await pop.waitFor({ state: 'visible' });
      const b = (await pop.boundingBox())!;
      expect(b.x >= 0 && b.x + b.width <= 360 && b.y + b.height <= 740, `menu outside the viewport: ${JSON.stringify(b)}`);
      expect((await more.getAttribute('aria-expanded')) === 'true', 'More not expanded');
      // each moved control exists once
      for (const name of ['Provider', 'Number of bars']) expect((await page.getByLabel(name, { exact: true }).count()) === 1, `${name} select is not unique`);
      expect((await page.getByRole('button', { name: 'Range', exact: true }).count()) === 1, 'Range is not unique');
      await check('more-360');
    });
    await ctx.screenshot('more-360');
    await ctx.step('Range panel from the menu stays inside', async () => {
      await page.getByRole('button', { name: 'Range', exact: true }).click();
      const panel = page.getByRole('dialog', { name: 'Chart range' });
      await panel.waitFor({ state: 'visible' });
      const b = (await panel.boundingBox())!;
      expect(b.x >= 0 && b.x + b.width <= 360 && b.y + b.height <= 740, `range panel outside the viewport: ${JSON.stringify(b)}`);
      await check('range-from-more-360');
    });
    await ctx.screenshot('range-360');
    await ctx.step('Escape closes the menu and refocuses More', async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'detached' });
      expect(await more.evaluate((e) => e === document.activeElement), 'focus is not on More');
    });
    await ctx.step('outside click closes the menu', async () => {
      await more.click();
      await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'visible' });
      await page.mouse.click(180, 400);
      await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'detached' });
    });

    // dialogs at 360
    await ctx.step('CSV import dialog at 360', async () => {
      await more.click();
      await page.getByRole('button', { name: /Import CSV/ }).first().click();
      await page.locator('input[type=file]').setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
      await page.getByLabel('Dataset name').or(page.getByPlaceholder('My dataset')).first().waitFor();
      await page.waitForTimeout(250);
      const modal = (await page.locator('.modal').boundingBox())!;
      expect(modal.x >= 0 && modal.x + modal.width <= 360 && modal.y >= 0 && modal.y + modal.height <= 740, `CSV modal outside: ${JSON.stringify(modal)}`);
      const m = await page.evaluate(() => {
        const b = document.querySelector('.modal-body')!;
        const f = document.querySelector('.modal-foot');
        return { scrollable: b.scrollHeight >= b.clientHeight, foot: f ? f.getBoundingClientRect().bottom <= innerHeight : true, sw: document.documentElement.scrollWidth };
      });
      expect(m.foot && m.sw <= 360, `CSV modal overflows: ${JSON.stringify(m)}`);
      log.push(`csv-360: modal=${Math.round(modal.width)}x${Math.round(modal.height)} at ${Math.round(modal.x)},${Math.round(modal.y)}`);
      await check('csv-360', { chart: false });
    });
    await ctx.screenshot('csv-360');
    await ctx.step('close the CSV dialog', async () => {
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    });
    await ctx.step('Inbox dialog at 360', async () => {
      await page.getByRole('button', { name: 'Inbox' }).click();
      await page.locator('.modal').waitFor({ state: 'visible' });
      await page.waitForTimeout(250);
      const modal = (await page.locator('.modal').boundingBox())!;
      expect(modal.x >= 0 && modal.x + modal.width <= 360 && modal.y + modal.height <= 740, `Inbox modal outside: ${JSON.stringify(modal)}`);
      log.push(`inbox-360: modal=${Math.round(modal.width)}x${Math.round(modal.height)}`);
      await check('inbox-360', { chart: false });
    });
    await ctx.screenshot('inbox-360');
    await ctx.step('close the Inbox', async () => {
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    });

    // dock tabs scroll instead of spilling
    await ctx.step('dock tabs at 360 are icon-only and inside', async () => {
      const info = await page.evaluate(() => {
        const t = document.querySelector('.dock-tablist') as HTMLElement;
        const label = document.querySelector('.dock-tab-label')!.getBoundingClientRect();
        return { sw: t.scrollWidth, cw: t.clientWidth, labelW: label.width, name: document.querySelector('#dock-tab-backtest')!.textContent };
      });
      log.push(`dock-tablist: scrollWidth=${info.sw} clientWidth=${info.cw} labelWidth=${info.labelW}`);
      expect(info.labelW <= 1, 'tab label is visible at 360');
      expect(!!info.name && info.name.includes('Backtest'), 'tab label lost from the accessible name');
    });

    // resize with the drawer open
    await ctx.step('widening past 900 closes the drawer', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(250);
      await page.getByRole('toolbar', { name: 'Side panel' }).getByRole('button', { name: 'Data and library', exact: true }).click();
      await drawer.waitFor({ state: 'visible' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
      expect((await drawer.count()) === 0, 'drawer still open at 1440');
      const l = await layout(page);
      expect(l.sidebarVisible && l.hasSidebarSplitter, 'desktop sidebar missing after widening');
      await check('widened-1440');
    });
    await ctx.screenshot('widened-1440');
    await ctx.step('rail buttons switch sections and the active one collapses the panel', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(250);
      const rail = page.getByRole('toolbar', { name: 'Side panel' });
      const pressed = async (name: string) => (await rail.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true';
      // the drawer opened from the Data and library rail button left the stored section on it: the rail shows the same stored section
      expect(await pressed('Data and library'), 'the rail does not follow the section chosen in the drawer');
      await rail.getByRole('button', { name: 'Watchlist', exact: true }).click();
      expect(await pressed('Watchlist'), 'Watchlist did not become pressed');
      await rail.getByRole('button', { name: 'Indicators', exact: true }).click();
      await page.locator('#add-indicator-select').waitFor();
      expect((await pressed('Indicators')) && !(await pressed('Watchlist')), 'only Indicators should be pressed');
      await rail.getByRole('button', { name: 'Data and library', exact: true }).click();
      await page.locator('#sidebar').getByRole('button', { name: 'Import CSV' }).waitFor();
      await rail.getByRole('button', { name: 'Data and library', exact: true }).click();
      await page.locator('#sidebar').waitFor({ state: 'detached' });
      expect((await page.locator('[aria-label="Resize sidebar"]').count()) === 0, 'splitter shown while collapsed');
      for (const name of ['Watchlist', 'Data and library', 'Indicators']) expect(!(await pressed(name)), `${name} still pressed while collapsed`);
      const l = await layout(page);
      expect(l.rail != null && Math.abs(l.rail.right - l.innerWidth) <= 1, 'rail not at the right edge while collapsed');
      expect(Math.abs(l.chartRight - (l.rail?.left ?? 0)) <= 1, 'chart does not fill the width up to the rail while collapsed');
      await check('collapsed-1440');
      await ctx.screenshot('collapsed-1440');
      await rail.getByRole('button', { name: 'Watchlist', exact: true }).click();
      await page.locator('#sidebar').waitFor();
      expect(await pressed('Watchlist'), 'Watchlist not pressed after reopening');
    });
    await ctx.step('narrowing again starts closed', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(250);
      expect((await drawer.count()) === 0, 'drawer open after narrowing');
    });

    await ctx.writeText('checks', `${log.join('\n')}\n`);
  },
};
