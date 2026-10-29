import type { Scenario } from '../scenario.ts';

export const alerts: Scenario = {
  name: 'alerts',
  description:
    'Price alerts against the real server and the fake feed: the panel on Demo (needs a server provider), empty on Binance, a created alert, the popup and the inbox line when the fake feed crosses it, the triggered row with Telegram sent, a reload that does not announce it again, the chart right-click menu and the prefilled panel',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const panel = page.locator('.modal', { has: page.getByRole('heading', { name: 'Alerts' }) });
    const bell = page.getByRole('button', { name: 'Alerts', exact: true });
    const legend = page.locator('.chart-legend .legend-title', { hasText: 'Binance · BTCUSDT' });

    const telegramCalls = () => ctx.upstream.requests.filter((r) => r.host === 'api.telegram.org' && r.path.endsWith('/sendMessage'));
    let telegramBefore = 0;

    await ctx.step('Demo provider: the panel needs a server provider', async () => {
      await page.goto('/');
      await ctx.waitForChart();
      // The server keeps its alerts between viewports: start from none.
      await page.evaluate(async () => {
        const list = (await (await fetch('/api/alerts')).json()) as { alerts: Array<{ id: string }> };
        for (const a of list.alerts) await fetch(`/api/alerts/${encodeURIComponent(a.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } });
      });
      telegramBefore = telegramCalls().length;
      await bell.click();
      await panel.getByTestId('alerts-client-only').waitFor();
      if ((await panel.getByRole('button', { name: 'Add alert' }).count()) !== 0) throw new Error('the create form is shown for Demo');
    });
    await ctx.screenshot('demo');

    await ctx.step('open Binance BTCUSDT and the empty panel', async () => {
      await page.addInitScript(() => {
        localStorage.removeItem('vost.layout.v1');
        localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1m' }));
      });
      await page.goto('/');
      await legend.waitFor();
      await page.waitForTimeout(500);
      await bell.click();
      await panel.getByText('No alerts yet.').waitFor();
      await panel.getByText('Telegram is on').waitFor();
    });
    await ctx.screenshot('empty');

    await ctx.step('create a crossing-up alert just above the open of the forming 1m bar', async () => {
      const text = await page.locator('.chart-legend .legend-ohlc').innerText();
      const open = Number(/O\s*([\d,]+\.?\d*)/.exec(text)?.[1]?.replace(/,/g, ''));
      if (!Number.isFinite(open)) throw new Error(`no open price in the legend: ${text}`);
      // The server watches the 1m price; the fake close swings about 0.4% around that bar's open: 0.1% above it is crossed within a few seconds.
      const level = (open * 1.001).toFixed(2);
      checks.push(`bar open ${open}, alert level ${level}`);
      await panel.getByLabel('Level').fill(level);
      await panel.getByLabel('Note').fill('capture run');
      await panel.getByRole('button', { name: 'Add alert' }).click();
      await panel.getByTestId('alert-row').waitFor();
      await page.getByTestId('alerts-badge').waitFor();
    });
    await ctx.screenshot('created');

    await ctx.step('wait for the fake feed to cross it: popup and inbox line', async () => {
      await page.keyboard.press('Escape');
      await page.locator('.alert-popup[role="alert"]').first().waitFor({ timeout: 30_000 });
      checks.push(`popup text: ${await page.locator('.alert-popup-text').first().innerText()}`);
      if ((await page.locator('.alert-popup').count()) !== 1) throw new Error('more than one popup for one firing');
    });
    await ctx.screenshot('popup');

    await ctx.step('the inbox line', async () => {
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      const line = page.locator('.inbox-item.warning', { hasText: 'BTCUSDT crossed up' });
      await line.waitFor();
      if ((await page.locator('.inbox-item').count()) !== 1) throw new Error('more than one inbox line for one firing');
      checks.push(`inbox: ${await line.innerText().then((t) => t.replace(/\s+/g, ' '))}`);
    });
    await ctx.screenshot('inbox');

    await ctx.step('Open alerts from the popup: the triggered row with Telegram sent', async () => {
      await page.keyboard.press('Escape');
      await page.locator('.alert-popup').getByRole('button', { name: 'Open alerts' }).click();
      await panel.getByText('Telegram: sent').waitFor();
      await panel.getByRole('button', { name: 'Send test message' }).click();
      await panel.getByText('Test message sent').waitFor();
      if ((await page.locator('.alert-popup').count()) !== 0) throw new Error('the popup stayed after Open alerts');
    });
    await ctx.screenshot('triggered');

    await ctx.step('record the Telegram messages the fake service received', async () => {
      const sent = telegramCalls().slice(telegramBefore);
      if (sent.length < 2) throw new Error(`expected a firing message and a test message, saw ${sent.length}`);
      await ctx.writeText('telegram', sent.map((r) => `${r.method} ${r.path.replace(/\/bot[^/]+\//, '/bot<token>/')}\n${r.body ?? ''}`).join('\n\n') + '\n');
    });

    await ctx.step('reload with the alert already fired: not announced again', async () => {
      await page.reload();
      await legend.waitFor();
      await bell.click();
      await panel.getByText('Telegram: sent').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      const popups = await page.locator('.alert-popup').count();
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      const lines = await page.locator('.inbox-item').count();
      checks.push(`after reload: popups=${popups} inbox lines=${lines}`);
      if (popups !== 0 || lines !== 0) throw new Error(`announced again after reload (popups ${popups}, inbox lines ${lines})`);
      await page.keyboard.press('Escape');
    });

    await ctx.step('right-click the chart: Add alert at <price>', async () => {
      const box = await page.locator('.chart-container canvas').first().boundingBox();
      if (!box) throw new Error('no chart canvas');
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4, { button: 'right' });
      await page.getByRole('menuitem', { name: /^Add alert at / }).waitFor();
    });
    await ctx.screenshot('menu');

    await ctx.step('choose it: the panel opens with the level prefilled', async () => {
      const label = await page.getByRole('menuitem').innerText();
      const price = label.replace('Add alert at ', '');
      await page.getByRole('menuitem').click();
      await panel.waitFor();
      const level = await panel.getByLabel('Level').inputValue();
      checks.push(`menu: "${label}", prefilled level ${level}`);
      if (Number(level) !== Number(price)) throw new Error(`level ${level} is not the menu price ${price}`);
    });
    await ctx.screenshot('prefilled');
    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
