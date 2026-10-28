import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

/**
 * The UI audit (docs/spikes/ui-audit/README.md). It drives every pane, records what it sees and writes the
 * records as .txt files. It reports findings and never fails because of one: it fails only when a step cannot run.
 */

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples');

interface Probe {
  ws: { opened: number; open: number };
  es: { opened: number; open: number };
  intervals: number;
  timeouts: number;
  winListeners: number;
  docListeners: number;
  canvases: number;
  domNodes: number;
  winTypes: string;
}

interface Req {
  action: string;
  method: string;
  url: string;
  status: number | null;
  ms: number | null;
  failure: string | null;
}

/** Installed before the app's own scripts: counts sockets, event streams, timers and window/document listeners. */
function installCounters(): void {
  const w = window as unknown as Record<string, unknown>;
  const sockets = new Set<WebSocket>();
  const streams = new Set<EventSource>();
  let wsOpened = 0;
  let esOpened = 0;
  const intervals = new Set<number>();
  const timeouts = new Set<number>();
  const listeners = new Map<string, number>();
  const winTypes = new Map<string, number>();
  const OrigWS = window.WebSocket;
  const OrigES = window.EventSource;
  window.WebSocket = new Proxy(OrigWS, {
    construct(target, args) {
      const s = new target(...(args as [string]));
      sockets.add(s);
      wsOpened++;
      return s;
    },
  });
  window.EventSource = new Proxy(OrigES, {
    construct(target, args) {
      const s = new target(...(args as [string]));
      streams.add(s);
      esOpened++;
      return s;
    },
  });
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  const st = window.setTimeout.bind(window);
  const ct = window.clearTimeout.bind(window);
  window.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    const id = si(fn, ms, ...rest);
    intervals.add(id);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) intervals.delete(id);
    ci(id);
  }) as typeof window.clearInterval;
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    const id: number = st(
      typeof fn === 'function'
        ? (...a: unknown[]) => {
            timeouts.delete(id);
            return (fn as (...x: unknown[]) => unknown)(...a);
          }
        : fn,
      ms,
      ...rest,
    );
    timeouts.add(id);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    if (id !== undefined) timeouts.delete(id);
    ct(id);
  }) as typeof window.clearTimeout;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const seen = new WeakMap<object, Set<string>>();
  const keyOf = (t: EventTarget, type: string, l: unknown, cap: unknown): string | null => {
    const where = t === window ? 'window' : t === document ? 'document' : null;
    if (!where || !l) return null;
    return `${where}:${type}:${typeof cap === 'object' && cap ? Boolean((cap as { capture?: boolean }).capture) : Boolean(cap)}`;
  };
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, l: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
    const k = keyOf(this, type, l, opts);
    if (k && l) {
      let set = seen.get(l as object);
      if (!set) seen.set(l as object, (set = new Set()));
      if (!set.has(k)) {
        set.add(k);
        listeners.set(k.split(':')[0], (listeners.get(k.split(':')[0]) ?? 0) + 1);
        if (k.startsWith('window')) winTypes.set(k.split(':')[1], (winTypes.get(k.split(':')[1]) ?? 0) + 1);
      }
    }
    return add.call(this, type, l, opts);
  } as typeof add;
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, l: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
    const k = keyOf(this, type, l, opts);
    if (k && l) {
      const set = seen.get(l as object);
      if (set?.delete(k)) {
        listeners.set(k.split(':')[0], (listeners.get(k.split(':')[0]) ?? 1) - 1);
        if (k.startsWith('window')) winTypes.set(k.split(':')[1], (winTypes.get(k.split(':')[1]) ?? 1) - 1);
      }
    }
    return remove.call(this, type, l, opts);
  } as typeof remove;
  w.__auditProbe = () => ({
    ws: { opened: wsOpened, open: [...sockets].filter((s) => s.readyState <= 1).length },
    es: { opened: esOpened, open: [...streams].filter((s) => s.readyState <= 1).length },
    intervals: intervals.size,
    timeouts: timeouts.size,
    winListeners: listeners.get('window') ?? 0,
    docListeners: listeners.get('document') ?? 0,
    canvases: document.querySelectorAll('canvas').length,
    domNodes: document.getElementsByTagName('*').length,
    winTypes: [...winTypes].filter(([, n]) => n > 0).map(([t, n]) => `${t}x${n}`).join(','),
  });
}

const fmtProbe = (p: Probe): string =>
  `ws open=${p.ws.open}/${p.ws.opened} eventsource open=${p.es.open}/${p.es.opened} intervals=${p.intervals} timeouts=${p.timeouts} window-listeners=${p.winListeners} document-listeners=${p.docListeners} canvases=${p.canvases} dom-nodes=${p.domNodes} window-listener-types=[${p.winTypes}]`;

/** Elements whose content is wider than their box, not counting the ones that scroll on purpose. */
async function overflowScan(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth) out.push(`DOCUMENT scrollWidth=${doc.scrollWidth} > innerWidth=${innerWidth}`);
    if (doc.scrollHeight > innerHeight) out.push(`DOCUMENT scrollHeight=${doc.scrollHeight} > innerHeight=${innerHeight}`);
    const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).join('.')}` : ''}`;
    for (const e of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'inline') continue;
      if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 1) {
        const o = cs.overflowX;
        if (o === 'auto' || o === 'scroll') continue; // scrolls on purpose
        if (cs.textOverflow === 'ellipsis') continue; // truncated on purpose, with a title
        const text = (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        out.push(`${name(e)} scrollWidth=${e.scrollWidth} clientWidth=${e.clientWidth} overflow-x=${o}${cs.textOverflow === 'ellipsis' ? ' (ellipsis)' : ''} "${text}"`);
      }
      if (r.right > innerWidth + 1 || r.left < -1) {
        let scroller = false;
        for (let p = e.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden') {
            scroller = true;
            break;
          }
        }
        if (!scroller) out.push(`${name(e)} outside the viewport: left=${Math.round(r.left)} right=${Math.round(r.right)} (innerWidth ${innerWidth})`);
      }
    }
    return [...new Set(out)].slice(0, 40);
  });
}

/** What is on top at a point, as a short selector. */
async function topAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => {
      const e = document.elementFromPoint(px, py);
      if (!e) return 'nothing';
      const cls = typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${e.tagName.toLowerCase()}${cls}`;
    },
    [x, y],
  );
}

async function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'body';
    const cs = getComputedStyle(a);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const border = cs.borderTopColor;
    const shadow = cs.boxShadow !== 'none';
    const label = a.getAttribute('aria-label') ?? a.getAttribute('title') ?? (a.textContent ?? '').trim().slice(0, 28);
    const r = a.getBoundingClientRect();
    return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''} "${label}" focus-ring=${outline || shadow ? 'yes' : 'NO'} border=${border} box=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  });
}

export const uiAudit: Scenario = {
  name: 'ui-audit',
  description: 'Research audit: drives every pane (providers, symbols, timeframes, live, CSV, backtest, optimizer, Pine, modals, drawer, Tab walk) and writes console, request, leak, layout and a11y records',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const consoleLog: string[] = [];
    const reqs: Req[] = [];
    const pending = new Map<unknown, Req>();
    const notes: Record<string, string[]> = { layout: [], leaks: [], a11y: [], stack: [], races: [], dups: [], states: [] };
    let action = 'startup';

    page.on('console', (m) => {
      const loc = m.location();
      consoleLog.push(`[${action}] ${m.type()}: ${m.text().replace(/\s+/g, ' ').slice(0, 300)}${loc.url ? ` (${loc.url.replace(/^https?:\/\/[^/]+/, '')}:${loc.lineNumber})` : ''}`);
    });
    page.on('pageerror', (e) => consoleLog.push(`[${action}] PAGEERROR: ${String(e.message).slice(0, 300)}`));
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return;
      const rec: Req = { action, method: r.method(), url: `${u.pathname}${u.search}`, status: null, ms: null, failure: null };
      pending.set(r, rec);
      reqs.push(rec);
    });
    page.on('requestfinished', (r) => {
      const rec = pending.get(r);
      if (!rec) return;
      const t = r.timing();
      rec.ms = t.responseEnd >= 0 ? Math.round(t.responseEnd) : null;
      void r.response().then((res) => {
        rec.status = res ? res.status() : null;
      });
    });
    page.on('requestfailed', (r) => {
      const rec = pending.get(r);
      if (rec) rec.failure = r.failure()?.errorText ?? 'failed';
    });
    page.on('dialog', (d) => {
      consoleLog.push(`[${action}] DIALOG ${d.type()}: ${d.message().slice(0, 100)}`);
      void d.dismiss();
    });
    await page.addInitScript(installCounters);

    const text = (l: Locator): Promise<string> => l.innerText({ timeout: 1500 }).catch(() => '(none)');
    const probe = (): Promise<Probe> => page.evaluate(() => (window as unknown as { __auditProbe: () => Probe }).__auditProbe());
    const settle = (ms = 400) => page.waitForTimeout(ms);
    const title = (name: string, symbol: string, tf: string) => page.locator('.chart-legend .legend-title', { hasText: `${name} · ${symbol} · ${tf}` });
    const liveButton = page.locator('.topbar button.badge, .topbar-more-pop button.badge').filter({ hasText: /Live|LIVE|…|RETRY|ERR/ });

    /** Runs fn as one user action and notes identical /api requests inside it. */
    const act = async (label: string, fn: () => Promise<void>): Promise<void> => {
      action = label;
      const from = reqs.length;
      await fn();
      await settle(500);
      const counts = new Map<string, number>();
      for (const r of reqs.slice(from)) {
        if (!r.url.startsWith('/api/') || r.url.startsWith('/api/live')) continue;
        const k = `${r.method} ${r.url}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      for (const [k, n] of counts) if (n > 1) notes.dups.push(`${label}: ${n}x ${k}`);
    };
    const openMore = async (): Promise<void> => {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('dialog', { name: 'More' }).waitFor();
    };
    const selectProvider = async (id: string): Promise<void> => {
      if (narrow) {
        await openMore();
        await page.getByLabel('Provider', { exact: true }).selectOption(id);
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'detached' });
      } else {
        await page.getByLabel('Provider', { exact: true }).selectOption(id);
      }
    };
    const tf = page.locator('select[title="Timeframe"]');
    const snap = async (label: string): Promise<void> => {
      notes.leaks.push(`${label}: ${fmtProbe(await probe())}`);
    };
    const scan = async (label: string): Promise<void> => {
      const o = await overflowScan(page);
      notes.layout.push(`${label}: ${o.length ? '' : 'no overflow'}`);
      for (const line of o) notes.layout.push(`  - ${line}`);
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await settle();
    await ctx.screenshot('start');
    await snap('start (demo, idle)');
    await scan('start');

    // ---- every provider ------------------------------------------------------------------------------------------
    const providers = await ctx.step('read the provider list', () => page.evaluate(() => fetch('/api/providers').then((r) => r.json() as Promise<Array<{ id: string; name: string; defaultSymbol: string; defaultTimeframe: string; supportsLive: boolean }>>)));
    for (const p of providers) {
      await ctx.step(`switch to ${p.id}`, () =>
        act(`provider ${p.id}`, async () => {
          await selectProvider(p.id);
          await title(p.name, p.defaultSymbol, p.defaultTimeframe).waitFor();
          await page.locator('.chart-legend .legend-ohlc').waitFor();
        }),
      );
      await scan(`provider ${p.id}`);
    }
    await ctx.screenshot('provider-last');

    // ---- symbol search -------------------------------------------------------------------------------------------
    await ctx.step('binance for the symbol steps', () =>
      act('provider binance', async () => {
        await selectProvider('binance');
        await title('Binance', 'BTCUSDT', '1h').waitFor();
      }),
    );
    const search = page.locator('.symbol-search input');
    for (const [q, sym] of [['ETH', 'ETHUSDT'], ['SOL', 'SOLUSDT']] as const) {
      await ctx.step(`symbol ${sym} through SymbolSearch`, () =>
        act(`symbol ${sym}`, async () => {
          await search.click();
          await search.fill(q);
          await page.locator('.symbol-suggestion', { hasText: sym }).first().click();
          await page.locator('.chart-legend .legend-title', { hasText: sym }).waitFor();
        }),
      );
    }
    await ctx.step('symbol search: no match, then a typed unknown symbol', async () => {
      await act('symbol search no-match', async () => {
        await search.click();
        await search.fill('ZZZZNOPE');
        await settle(700);
      });
      notes.states.push(`symbol search "ZZZZNOPE": suggestions=${await page.locator('.symbol-suggestion').count()}, dropdown visible=${await page.locator('.symbol-suggestions').count()} (empty result shows nothing, no "no results" text)`);
      await ctx.screenshot('search-nomatch');
      await act('unknown symbol enter', async () => {
        await search.press('Enter');
        await settle(800);
      });
      notes.states.push(`unknown symbol ZZZZNOPE on binance: legend="${(await text(page.locator('.chart-legend .legend-title'))).trim()}", toasts=${await page.locator('.toast').count()}, load button text="${(await text(page.getByTitle('Reload data'))).trim()}"`);
      await ctx.screenshot('unknown-symbol');
    });
    await ctx.step('restore a good symbol', () =>
      act('symbol restore', async () => {
        await search.click();
        await search.fill('BTCUSDT');
        await search.press('Enter');
        await title('Binance', 'BTCUSDT', '1h').waitFor();
      }),
    );

    // ---- rapid timeframe switches --------------------------------------------------------------------------------
    await ctx.step('rapid timeframe switches', async () => {
      const failedBefore = reqs.filter((r) => r.failure).length;
      const seqs: string[][] = [['1d', '1h', '15m', '5m', '1m', '1h', '4h', '15m'], ['5m', '15m', '5m', '15m', '5m', '1h']];
      for (const seq of seqs) {
        await act(`rapid timeframes ${seq.join('>')}`, async () => {
          for (const t of seq) await tf.selectOption(t); // no wait in between: back to back
          await settle(1500);
        });
        const last = seq[seq.length - 1];
        const legend = (await text(page.locator('.chart-legend .legend-title'))).trim();
        const selected = await tf.inputValue();
        const ok = legend.endsWith(last) && selected === last;
        notes.races.push(`timeframes ${seq.join('>')}: select=${selected} legend="${legend}" -> ${ok ? 'consistent' : 'STALE: the chart shows another timeframe than the select'}`);
        // the candle spacing on the chart must match the final timeframe: compare with a fresh fetch
        const check = await page.evaluate(async (t) => {
          const r = await fetch(`/api/history?provider=binance&symbol=BTCUSDT&timeframe=${t}&bars=3`).then((x) => x.json() as Promise<Array<{ time: number }>>);
          return r.length > 1 ? r[1].time - r[0].time : 0;
        }, last);
        notes.races.push(`  expected bar spacing of ${last}: ${check}s`);
      }
      const aborted = reqs.filter((r) => r.failure).length - failedBefore;
      notes.races.push(`requests cancelled by the browser during the rapid switches (net::ERR_ABORTED): ${aborted} (0 means every superseded /api/history call ran to the end)`);
      const rapid = reqs.filter((r) => r.action.startsWith('rapid') && r.url.startsWith('/api/history'));
      notes.races.push(`history requests fired by the rapid switches: ${rapid.length} for ${seqs.reduce((n, s) => n + s.length, 0)} selections`);
    });
    await ctx.screenshot('after-rapid-timeframes');

    await ctx.step('rapid provider switches', async () => {
      await act('rapid providers', async () => {
        for (const id of ['coinbase', 'kraken', 'okx', 'bybit', 'binance']) await selectProvider(id);
        await settle(1500);
      });
      const legend = (await text(page.locator('.chart-legend .legend-title'))).trim();
      const sel = await page.getByLabel('Provider', { exact: true }).inputValue().catch(() => 'n/a');
      notes.races.push(`providers coinbase>kraken>okx>bybit>binance (narrow goes through the More menu): select=${sel} legend="${legend}"`);
    });

    // ---- live on / off / on --------------------------------------------------------------------------------------
    await ctx.step('live on, off, on again', async () => {
      await snap('before live');
      for (let i = 0; i < 3; i++) {
        await act(`live on #${i + 1}`, async () => {
          if (narrow) await openMore();
          await liveButton.first().click();
          if (narrow) await page.keyboard.press('Escape');
          await settle(900);
        });
        await snap(`live on #${i + 1}`);
        await act(`live off #${i + 1}`, async () => {
          if (narrow) await openMore();
          await liveButton.first().click();
          if (narrow) await page.keyboard.press('Escape');
          await settle(400);
        });
        await snap(`live off #${i + 1}`);
      }
      await act('live on (final)', async () => {
        if (narrow) await openMore();
        await liveButton.first().click();
        if (narrow) await page.keyboard.press('Escape');
        await settle(900);
      });
      await ctx.screenshot('live-on');
      const during = await probe();
      // timeframe change while live: the stream must follow
      await act('timeframe while live', async () => {
        await tf.selectOption('15m');
        await settle(1200);
      });
      await snap('timeframe change while live');
      if (narrow) await openMore();
      notes.races.push(`live button after a timeframe change while live: "${(await text(liveButton.first())).trim()}" (live was on before the change)`);
      if (narrow) await page.keyboard.press('Escape');
      notes.races.push(`live open streams after a timeframe change while live: ${(await probe()).es.open} (was ${during.es.open}); a leak shows as 2+`);
      await act('live off (final)', async () => {
        if (narrow) await openMore();
        if (/LIVE|…|RETRY|ERR/.test(await text(liveButton.first()))) await liveButton.first().click();
        if (narrow) await page.keyboard.press('Escape');
        await settle(400);
      });
      await snap('live off (final)');
    });

    // ---- CSV import ----------------------------------------------------------------------------------------------
    const csvText = await readFile(path.join(EXAMPLES, 'sample-daily.csv'), 'utf8');
    const openCsv = async (): Promise<void> => {
      if (narrow) {
        await openMore();
        await page.getByRole('button', { name: /Import CSV/ }).first().click();
      } else {
        await page.locator('.topbar').getByRole('button', { name: /Import CSV/ }).click();
      }
      await page.locator('.modal').waitFor();
    };
    await ctx.step('CSV import from examples/', async () => {
      await act('csv import', async () => {
        await openCsv();
        await page.locator('.modal input[type=file]').setInputFiles({ name: 'sample-daily.csv', mimeType: 'text/csv', buffer: Buffer.from(csvText) });
        await page.getByRole('button', { name: /^Import \d/ }).waitFor();
      });
      await ctx.screenshot('csv-preview');
      await scan('csv modal');
      await act('csv confirm', async () => {
        await page.getByRole('button', { name: /^Import \d/ }).click();
        await page.locator('.modal').waitFor({ state: 'detached' });
        await page.locator('.chart-legend .legend-title').waitFor();
      });
      notes.states.push(`after CSV import: legend="${(await text(page.locator('.chart-legend .legend-title'))).trim()}", toasts=${await page.locator('.toast').allInnerTexts().then((t) => JSON.stringify(t))}`);
      await ctx.screenshot('csv-imported');
      await snap('after CSV import');
    });
    await ctx.step('CSV import of the MT5 example and a broken file', async () => {
      await act('csv mt5', async () => {
        await openCsv();
        await page.locator('.modal input[type=file]').setInputFiles(path.join(EXAMPLES, 'sample-mt5-format.csv'));
        await settle(600);
      });
      await ctx.screenshot('csv-mt5');
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
      await act('csv broken', async () => {
        await openCsv();
        await page.locator('.modal input[type=file]').setInputFiles({ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('this,is,not\nan,ohlc,file\n') });
        await settle(600);
      });
      notes.states.push(`broken CSV: modal text="${((await text(page.locator('.modal-body'))) || '').replace(/\s+/g, ' ').slice(0, 160)}"`);
      await ctx.screenshot('csv-broken');
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
      await snap('after 2 more CSV modal open/close cycles');
    });

    // ---- backtest, optimizer, results ----------------------------------------------------------------------------
    const dockTab = (name: string) => page.getByRole('tab', { name: new RegExp(name) });
    await ctx.step('backtest run', async () => {
      await act('backtest', async () => {
        await dockTab('Backtest').click();
        await page.getByRole('button', { name: /Run backtest/ }).click();
        await dockTab('Results').locator('.badge').waitFor({ timeout: 20_000 });
      });
      await ctx.screenshot('backtest-done');
      await snap('after backtest');
      await scan('backtest tab');
    });
    await ctx.step('results tab with the equity chart and trades', async () => {
      await dockTab('Results').click();
      await page.locator('.dock-body').waitFor();
      await settle(500);
      await ctx.screenshot('results');
      await snap('Results tab open');
      await scan('results tab');
      notes.states.push(`results tab: equity canvases=${await page.locator('.dock-body canvas').count()}, trade rows=${await page.locator('.dock-body tbody tr').count()}`);
    });
    await ctx.step('optimizer run', async () => {
      await act('optimizer', async () => {
        await dockTab('Optimizer').click();
        await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
        await page.locator('.data-table').first().waitFor({ timeout: 60_000 });
      });
      await ctx.screenshot('optimizer-done');
      await snap('after optimizer');
      await scan('optimizer tab');
    });
    await ctx.step('empty results before any run (fresh page)', async () => {
      // an empty-state sample: collapse and reopen keeps state, so read the text the Results tab shows without data
      notes.states.push('empty Results / Optimizer states are covered by code-read (see README)');
    });

    // ---- Pine tab ------------------------------------------------------------------------------------------------
    await ctx.step('Pine tab: add, type an error, remove', async () => {
      await snap('before Pine');
      await act('pine add', async () => {
        if (narrow) {
          await page.getByRole('button', { name: 'Toggle sidebar' }).click();
          await page.getByRole('dialog', { name: 'Sidebar' }).waitFor();
        }
        await page.locator('#add-indicator-select').selectOption('pine');
        if (narrow) {
          // the add closes nothing: the editor opens in the dock behind the drawer
          await page.keyboard.press('Escape');
          await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
        }
        await page.locator('.pine-editor .cm-content').waitFor();
      });
      await ctx.screenshot('pine');
      await act('pine error', async () => {
        await page.locator('.pine-editor .cm-content').click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type('\nplot(1 +');
        await page.locator('.pine-error').waitFor();
      });
      await scan('pine tab');
      await act('pine remove', async () => {
        if (narrow) {
          await page.getByRole('button', { name: 'Toggle sidebar' }).click();
          await page.getByRole('dialog', { name: 'Sidebar' }).waitFor();
        }
        await page.getByTitle('Remove').last().click();
        if (narrow) {
          await page.keyboard.press('Escape');
          await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
        }
        await page.locator('.pine-empty').waitFor();
      });
      await ctx.screenshot('pine-empty');
      await snap('after Pine');
    });

    // ---- modals and drawers: open/close, Esc, stacking, leaks ---------------------------------------------------
    await ctx.step('Inbox: open, stack check, Esc, backdrop', async () => {
      await snap('before modal cycles');
      for (let i = 0; i < 6; i++) {
        await page.getByRole('button', { name: 'Inbox' }).click();
        await page.locator('.modal').waitFor();
        if (i % 2) await page.mouse.click(2, 2);
        else await page.keyboard.press('Escape');
        await page.locator('.modal').waitFor({ state: 'detached' });
      }
      await snap('after 6 Inbox open/close cycles');
      await page.getByRole('button', { name: 'Inbox' }).click();
      await page.locator('.modal').waitFor();
      const modal = (await page.locator('.modal').boundingBox())!;
      const cx = modal.x + modal.width / 2;
      const cy = modal.y + modal.height / 2;
      notes.stack.push(`Inbox open: centre -> ${await topAt(page, cx, cy)}; top bar button area (20,24) -> ${await topAt(page, 20, 24)}; dock tab area -> ${await topAt(page, 40, innerHeight() - 20)}; chart area (${Math.round(cx)},120) -> ${await topAt(page, cx, 120)}`);
      const focus = await page.evaluate(() => {
        const m = document.querySelector('.modal');
        const a = document.activeElement;
        return { inModal: !!(m && a && m.contains(a)), tag: a?.tagName.toLowerCase() ?? '', labelled: m?.hasAttribute('aria-label') || m?.hasAttribute('aria-labelledby') || false, modalAttr: m?.getAttribute('aria-modal') };
      });
      notes.a11y.push(`Inbox modal: focus moved into the dialog on open=${focus.inModal} (active=${focus.tag}), dialog has an accessible name=${focus.labelled}, aria-modal="${focus.modalAttr}"`);
      let escaped = 0;
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        if (!(await page.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement)))) {
          escaped = i + 1;
          break;
        }
      }
      notes.a11y.push(`Inbox modal: Tab leaves the dialog after ${escaped || 'never (12 presses)'} presses; focus now on ${await describeFocus(page)}`);
      await ctx.screenshot('inbox');
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
      const after = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
      notes.a11y.push(`Inbox closed with Esc: focus returns to the opener=${after !== 'body' ? 'yes' : 'NO (focus is on body)'}`);
    });
    await ctx.step('CSV modal on top of a toast and Esc', async () => {
      await openCsv();
      await page.getByRole('button', { name: 'Load demo dataset' }).click(); // raises a success toast and closes
      await page.locator('.toast').first().waitFor();
      await openCsv();
      const t = await page.locator('.toast').first().boundingBox();
      if (t) notes.stack.push(`CSV modal open with a toast showing: toast centre -> ${await topAt(page, t.x + t.width / 2, t.y + t.height / 2)} (toast above the modal overlay if it says .toast)`);
      await ctx.screenshot('csv-over-toast');
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    });
    await ctx.step('popovers: status, zone clock, range, symbol list', async () => {
      await page.locator('.conn-btn').click();
      await page.locator('.conn-pop').waitFor();
      const pop = (await page.locator('.conn-pop').boundingBox())!;
      notes.stack.push(`status popover: centre -> ${await topAt(page, pop.x + pop.width / 2, pop.y + 20)}; box ${Math.round(pop.x)},${Math.round(pop.y)} ${Math.round(pop.width)}x${Math.round(pop.height)} in ${innerWidth()}`);
      await ctx.screenshot('status-popover');
      await scan('status popover');
      await page.keyboard.press('Escape');
      const stillOpen = await page.locator('.conn-pop').count();
      notes.a11y.push(`status popover: closes with Esc=${stillOpen === 0 ? 'yes' : 'NO'}`);
      if (stillOpen) await page.mouse.click(5, 5);
      await page.locator('.zone-clock-btn').click();
      const zc = page.locator('.zone-clock-pop, .zone-pop, [role=dialog][aria-label*=zone i], .zone-clock [role=listbox]').first();
      await zc.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
      await ctx.screenshot('zone-clock');
      await scan('zone clock popover');
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 5);
      await search.click();
      await settle(500);
      const list = page.locator('.symbol-suggestions');
      if (await list.count()) {
        const b = (await list.boundingBox())!;
        notes.stack.push(`symbol list open: bottom=${Math.round(b.y + b.height)} right=${Math.round(b.x + b.width)} of ${innerWidth()}x${innerHeight()}; point inside it -> ${await topAt(page, b.x + 20, b.y + 20)}`);
        await scan('symbol list');
      }
      await ctx.screenshot('symbol-list');
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 5);
    });
    await ctx.step('drawer and More menu cycles with Esc', async () => {
      if (!narrow) return;
      await snap('before drawer cycles');
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: 'Toggle sidebar' }).click();
        await page.getByRole('dialog', { name: 'Sidebar' }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Sidebar' }).waitFor({ state: 'detached' });
        await openMore();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'detached' });
      }
      await snap('after 5 drawer + More cycles');
      await page.getByRole('button', { name: 'Toggle sidebar' }).click();
      await page.getByRole('dialog', { name: 'Sidebar' }).waitFor();
      await ctx.screenshot('drawer');
      await scan('drawer');
      const d = (await page.getByRole('dialog', { name: 'Sidebar' }).boundingBox())!;
      notes.stack.push(`drawer open: drawer centre -> ${await topAt(page, d.x + d.width / 2, d.y + 200)}; the top bar toggle (20,24) -> ${await topAt(page, 20, 24)}`);
      await page.keyboard.press('Escape');
    });
    await ctx.step('dock collapse, tab and zone clock', async () => {
      await page.getByTitle('Collapse').click();
      await settle(300);
      await scan('dock collapsed');
      await page.getByTitle('Expand').click();
      await settle(300);
    });

    // ---- chart disposal and switching leaks ----------------------------------------------------------------------
    await ctx.step('chart disposal: repeated provider and timeframe switches', async () => {
      await selectProvider('demo');
      await title('Demo', 'DEMO', '1d').waitFor().catch(() => undefined);
      await settle(400);
      await snap('before 6 switches');
      for (let i = 0; i < 3; i++) {
        await selectProvider('binance');
        await page.locator('.chart-legend .legend-title', { hasText: 'Binance' }).waitFor();
        await selectProvider('demo');
        await page.locator('.chart-legend .legend-title', { hasText: 'Demo' }).waitFor();
      }
      await settle(500);
      await snap('after 6 provider switches');
      for (const t of ['1d', '1w', '1d', '1w', '1d', '1w']) {
        await tf.selectOption(t).catch(() => undefined);
        await settle(150);
      }
      await settle(500);
      await snap('after 6 timeframe switches');
      // the equity chart is mounted and unmounted with the Results tab
      for (let i = 0; i < 4; i++) {
        await dockTab('Results').click();
        await snap(`Results tab open (cycle ${i + 1})`);
        await dockTab('Backtest').click();
      }
      await settle(300);
      await snap('after 4 Results/Backtest tab cycles');
    });

    // ---- keyboard-only Tab walk ---------------------------------------------------------------------------------
    await ctx.step('Tab walk through the top bar and the dock', async () => {
      await page.goto('/');
      await ctx.waitForChart();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const lines: string[] = [];
      for (let i = 0; i < 140; i++) {
        await page.keyboard.press('Tab');
        if (i === 2) await ctx.screenshot('focus-symbol-input');
        if (i === 6) await ctx.screenshot('focus-timeframe');
        lines.push(`${String(i + 1).padStart(2)}  ${await describeFocus(page)}`);
      }
      await ctx.screenshot('tab-walk');
      notes.a11y.push(`Tab walk (${lines.length} stops from the page start):`);
      const firstDock = lines.findIndex((l) => /Dock|Backtest|Pine|Optimizer|Results|Collapse|Resize bottom/.test(l));
      notes.a11y.push(`first stop inside the bottom dock or its splitter: ${firstDock < 0 ? 'NOT reached in 140 presses' : firstDock + 1}`);
      for (const l of lines) notes.a11y.push(`  ${l}`);
      const noRing = lines.filter((l) => l.includes('focus-ring=NO')).length;
      notes.a11y.push(`stops without a visible focus ring: ${noRing} of ${lines.length}`);
      // roles and names
      const names = await page.evaluate(() => {
        const out: string[] = [];
        const accName = (e: Element) => (e.getAttribute('aria-label') ?? e.getAttribute('aria-labelledby') ?? e.getAttribute('title') ?? (e as HTMLElement).innerText ?? '').trim();
        for (const e of Array.from(document.querySelectorAll('button, select, input, textarea, [role=button]'))) {
          const r = e.getBoundingClientRect();
          if (r.width === 0) continue;
          const label = (e as HTMLInputElement).labels?.length ? 'labelled' : accName(e);
          if (!label) out.push(`${e.tagName.toLowerCase()}${(e as HTMLElement).className ? `.${String((e as HTMLElement).className).split(' ')[0]}` : ''} has no accessible name`);
          else if (e.tagName === 'SELECT' && !e.getAttribute('aria-label') && !(e as HTMLSelectElement).labels?.length) out.push(`select "${e.getAttribute('title')}" is named only by its title attribute`);
        }
        return [...new Set(out)];
      });
      notes.a11y.push('controls without a proper accessible name:');
      for (const n of names) notes.a11y.push(`  - ${n}`);
      // dock tabs: arrow keys
      await dockTab('Backtest').focus();
      await page.keyboard.press('ArrowRight');
      const afterArrow = await page.evaluate(() => document.activeElement?.id ?? '');
      notes.a11y.push(`dock tablist: ArrowRight from the Backtest tab moves focus to "${afterArrow || '(nothing)'}" (a tablist should move to dock-tab-pine)`);
      const live = await page.locator('[aria-live], [role=status], [role=alert]').count();
      notes.a11y.push(`aria-live / role=status / role=alert regions on the page: ${live} (toasts and loading states are announced only if > 0)`);
      const splitter = await page.locator('[role=separator]').count();
      notes.a11y.push(`splitters with role=separator: ${splitter}`);
      const landmarks = await page.evaluate(() => ({ main: document.querySelectorAll('main, [role=main]').length, header: document.querySelectorAll('header').length, h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang }));
      notes.a11y.push(`landmarks: ${JSON.stringify(landmarks)}`);
    });

    // ---- loading / empty / error states -------------------------------------------------------------------------
    await ctx.step('loading, error and empty states', async () => {
      await page.goto('/');
      await ctx.waitForChart();
      await selectProvider('binance');
      await title('Binance', 'BTCUSDT', '1h').waitFor();
      // a provider failure: the fake upstream is stopped, then Load is pressed
      await ctx.upstream.stop();
      await act('load with the upstream down', async () => {
        await page.getByTitle('Reload data').click();
        await settle(1500);
      });
      notes.states.push(`Load with the market-data service down: toasts=${JSON.stringify(await page.locator('.toast').allInnerTexts())}, load button="${(await text(page.getByTitle('Reload data'))).trim()}", chart legend="${(await text(page.locator('.chart-legend .legend-title'))).trim()}", sidebar says: ${((await text(page.locator('.sidebar-section').first())) || '').replace(/\s+/g, ' ').slice(0, 100)}`);
      await ctx.screenshot('upstream-down');
      await act('switch provider with the upstream down', async () => {
        await selectProvider('kraken');
        await settle(1500);
      });
      notes.states.push(`provider switched to Kraken with the upstream down: chart legend="${(await text(page.locator('.chart-legend .legend-title'))).trim()}", symbol box="${await search.inputValue()}", timeframe select="${await tf.inputValue()}", toasts=${JSON.stringify(await page.locator('.toast').allInnerTexts())} (a legend that still names the old provider means old candles sit under the new selection)`);
      await ctx.screenshot('provider-switch-failed');
      await act('search with the upstream down', async () => {
        await search.click();
        await search.fill('ETH');
        await settle(900);
      });
      notes.states.push(`symbol search with the upstream down: suggestions=${await page.locator('.symbol-suggestion').count()}, toasts=${await page.locator('.toast').count()}`);
      await page.keyboard.press('Escape');
      await ctx.upstream.start();
    });
    await ctx.step('first-load state of a slow history call', async () => {
      // network latency through the browser's own throttle: a route handler here would clash with the runner's offline guard
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
      action = 'slow history';
      await page.getByTitle('Reload data').click();
      await settle(400);
      notes.states.push(`while every request takes 1.5 s extra: load button="${(await text(page.getByTitle('Reload data'))).trim() || '(spinner only)'}", spinner shown=${(await page.locator('.topbar .spinner').count()) > 0}, "Loading data" overlay on the chart=${(await page.getByText('Loading data').count()) > 0}`);
      await ctx.screenshot('loading');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await settle(2500);
    });

    // ---- narrow / desktop layout at both sizes ------------------------------------------------------------------
    await ctx.step('layout scan of the settled app', async () => {
      await page.goto('/');
      await ctx.waitForChart();
      await settle(400);
      await scan('settled app');
      for (const t of ['Backtest', 'Pine', 'Optimizer', 'Results']) {
        await dockTab(t).click();
        await settle(250);
        await scan(`dock tab ${t}`);
      }
      await ctx.screenshot('layout');
    });

    // ---- write the records ---------------------------------------------------------------------------------------
    const slow = reqs.filter((r) => (r.ms ?? 0) > 1000);
    const failed = reqs.filter((r) => r.failure || (r.status !== null && r.status >= 400));
    const counts = new Map<string, number>();
    for (const r of reqs) counts.set(`${r.method} ${r.url.replace(/(\?|&)(to|from)=\d+/g, '$1$2=N')}`, (counts.get(`${r.method} ${r.url.replace(/(\?|&)(to|from)=\d+/g, '$1$2=N')}`) ?? 0) + 1);
    const total = (list: Req[]) => list.length;
    await ctx.writeText('console', `${consoleLog.length} console messages and page errors\n${consoleLog.join('\n') || '(none)'}\n`);
    await ctx.writeText(
      'requests',
      [
        `${total(reqs)} requests; slow (> 1000 ms): ${total(slow)}; failed or status >= 400: ${total(failed)}`,
        '',
        'failed or status >= 400 (action, status, failure, url):',
        ...failed.map((r) => `  [${r.action}] ${r.status ?? '-'} ${r.failure ?? ''} ${r.method} ${r.url}`),
        failed.length ? '' : '  (none)',
        'slowest 12 (ms, action, url):',
        ...[...reqs].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 12).map((r) => `  ${String(r.ms).padStart(5)} ms  [${r.action}] ${r.url}`),
        '',
        'identical /api requests (excluding /api/live) inside one user action:',
        ...(notes.dups.length ? notes.dups.map((d) => `  ${d}`) : ['  (none)']),
        '',
        'count per distinct request (time bounds masked):',
        ...[...counts].map(([k, n]) => `${String(n).padStart(5)}  ${k}`),
      ].join('\n') + '\n',
    );
    await ctx.writeText('leaks', `${notes.leaks.join('\n')}\n`);
    await ctx.writeText('layout', `${notes.layout.join('\n')}\n`);
    await ctx.writeText('a11y', `${notes.a11y.join('\n')}\n`);
    await ctx.writeText('stack', `${notes.stack.join('\n')}\n`);
    await ctx.writeText('races', `${notes.races.join('\n')}\n`);
    await ctx.writeText('states', `${notes.states.join('\n')}\n`);

    function innerWidth(): number {
      return page.viewportSize()!.width;
    }
    function innerHeight(): number {
      return page.viewportSize()!.height;
    }
  },
};
