import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

export const docs: Scenario = {
  name: 'docs',
  description: 'The Help button in the top bar (in More on a narrow screen) opens the built-in manual at /docs in a new page: the index, Getting started and Backtesting with their screenshots, an in-guide anchor link, Back to Vost, and no request leaves the server',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const notes: string[] = [];
    const check = (label: string, ok: boolean, extra = ''): void => {
      notes.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${extra}`);
    };
    const picturesLoaded = async (p: Page): Promise<number> => {
      await p.evaluate(() => document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }));
      await p.waitForFunction(() => [...document.images].every((i) => i.complete));
      const bad = await p.evaluate(() => [...document.images].filter((i) => i.naturalWidth === 0).map((i) => i.src));
      check('every img has naturalWidth > 0', bad.length === 0, bad.join(', '));
      return p.locator('img').count();
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    const help = narrow ? page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Help' }) : page.getByRole('link', { name: 'Help', exact: true });
    await ctx.step('the top bar has the Help button', async () => {
      if (narrow) await page.getByRole('button', { name: 'More', exact: true }).click();
      await help.waitFor();
      check('href is /docs/', (await help.getAttribute('href')) === '/docs/');
      check('opens in a new page', (await help.getAttribute('target')) === '_blank' && /noopener/.test((await help.getAttribute('rel')) ?? ''));
      check('title names the offline manual', /offline/.test((await help.getAttribute('title')) ?? ''));
      if (!narrow) {
        const gear = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
        const link = await help.boundingBox();
        check('immediately left of the Settings gear', !!gear && !!link && link.x + link.width <= gear.x && gear.x - (link.x + link.width) < 16, `${link?.x},${gear?.x}`);
        check('the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    });
    await ctx.screenshot(narrow ? 'more-help' : 'bar');

    const manual = await ctx.step('Help opens the manual in a new page', async () => {
      const [popup] = await Promise.all([page.context().waitForEvent('page'), help.click()]);
      await popup.waitForLoadState();
      check('the url is /docs/', new URL(popup.url()).pathname === '/docs/');
      check('the header shows the version', /v\d+\.\d+\.\d+/.test(await popup.locator('.doc-head').innerText()));
      return popup;
    });
    if (narrow) await page.keyboard.press('Escape');

    await ctx.step('the index lists every page and screenshots load', async () => {
      const links = await manual.locator('nav.doc-nav a').count();
      check('the side navigation lists the guide and the reference', links >= 20, String(links));
      check('the current page is marked', (await manual.locator('nav.doc-nav a[aria-current=page]').innerText()) === 'Guide index');
    });
    await ctx.screenshot('index', manual);

    await ctx.step('Getting started shows its screenshots', async () => {
      await manual.locator('nav.doc-nav').getByRole('link', { name: 'Getting started' }).click();
      await manual.waitForURL('**/docs/getting-started.html');
      const n = await picturesLoaded(manual);
      check('the page has pictures', n > 0, String(n));
      check('the manual section on Help is there', (await manual.getByRole('heading', { name: 'The manual' }).count()) === 1);
    });
    await ctx.screenshot('getting-started', manual);

    await ctx.step('an in-guide anchor link scrolls to its heading', async () => {
      const link = manual.locator('main a[href="#the-settings-popup"]').first();
      check('the top bar list links to #the-settings-popup', (await link.count()) === 1);
      await link.scrollIntoViewIfNeeded();
      await link.click();
      const top = await manual.locator('#the-settings-popup').evaluate((e) => e.getBoundingClientRect().top);
      check('the heading is at the top of the page', top >= 0 && top < 160, String(top));
    });

    await ctx.step('Backtesting shows its screenshots and <metric> as text', async () => {
      await manual.goto('/docs/backtesting.html');
      const n = await picturesLoaded(manual);
      check('the page has pictures', n > 0, String(n));
      check('<metric> is shown as text', (await manual.locator('main').innerText()).includes('<metric>'));
    });
    await ctx.screenshot('backtesting', manual);

    await ctx.step('a link into the reference docs works', async () => {
      await manual.goto('/docs/data.html');
      const ref = manual.locator('main a[href^="/docs/ref/"]').first();
      await ref.click();
      await manual.waitForURL('**/docs/ref/*.html');
      check('the reference page has a heading', (await manual.locator('main h1').count()) >= 1);
    });

    await ctx.step('Back to Vost returns to the chart', async () => {
      await manual.getByRole('link', { name: 'Back to Vost' }).click();
      await manual.waitForURL((u) => u.pathname === '/');
      await manual.locator('.chart-container canvas').first().waitFor({ state: 'visible' });
      check('the chart is back', true);
    });

    await ctx.step('no request left the server', async () => {
      const origin = new URL(page.url()).origin;
      const outside = ctx.requests.filter((u) => new URL(u).origin !== origin && !u.startsWith(origin.replace(/^http/, 'ws')));
      const docsRequests = ctx.requests.filter((u) => new URL(u).pathname.startsWith('/docs/'));
      check('no request to another origin', outside.length === 0, outside.join(', '));
      check('the manual made requests', docsRequests.length > 10, String(docsRequests.length));
      await ctx.writeText('checks', `${notes.join('\n')}\n\nrequests (${ctx.requests.length}):\n${ctx.requests.join('\n')}\n`);
    });
  },
};
