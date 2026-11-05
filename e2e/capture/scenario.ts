import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { FakeUpstream } from '../fake-upstream/index.ts';

export type ViewportName = 'desktop' | 'narrow';

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  narrow: { width: 390, height: 844 },
};

/** Fast failure: a missing selector must fail in about 10 s, not the 30 s default. */
const ACTION_TIMEOUT_MS = 10_000;

export interface ScenarioContext {
  page: Page;
  viewport: ViewportName;
  /** Runs fn; a failure is rethrown as `scenario "<name>" step "<label>" failed: <first line>`. */
  step<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Writes `<scenario>-<name>-<viewport>.png` (or `<scenario>-<viewport>.png`) of the scenario's page, or of `of`, and returns its path. */
  screenshot(name?: string, of?: Page): Promise<string>;
  /** Waits for the chart canvas, the demo legend title and the web fonts. */
  waitForChart(): Promise<void>;
  /** The fake market-data service the server is pointed at; `stop()` and `start()` take it down and bring it back. */
  upstream: Pick<FakeUpstream, 'stop' | 'start' | 'requests'>;
  /** Every URL the browser requested so far (http, https, ws and wss; not data: or blob:), in order, repeats included. */
  requests: readonly string[];
  /** Writes `<scenario>-<name>-<viewport>.txt` and returns its path. */
  writeText(name: string, text: string): Promise<string>;
  /** The server's saved settings (what the app keeps): seed with `put`, then `goto` or reload; read what the page saved with `get` (null when none). */
  settings: {
    get(name: string): Promise<unknown>;
    put(name: string, value: unknown): Promise<void>;
  };
  /** The server's strategy maker data (marked trades, find form, trained model). */
  strategyMaker: {
    /** Stores a set of marked trades. */
    putSet(set: { id: string }): Promise<void>;
    /** The ids of the stored sets. */
    setIds(): Promise<string[]>;
    /** Deletes every set, the find form and the model. */
    reset(): Promise<void>;
  };
}

export interface Scenario {
  name: string;
  description: string;
  /** Record a WebM (desktop size only). */
  video?: boolean;
  viewports?: ViewportName[];
  /** Viewports that emulate a touch device (a touchscreen, mobile mode); the others use a mouse. */
  touch?: ViewportName[];
  /** Kept for the scenarios that set it: the prefs are now seeded once per run (not on every page load), so a reload always keeps what the page saved. */
  keepPrefs?: boolean;
  run(ctx: ScenarioContext): Promise<void>;
}

export class StepError extends Error {}

export interface RunOptions {
  browser: Browser;
  baseUrl: string;
  outDir: string;
  scenario: Scenario;
  viewport: ViewportName;
  upstream: FakeUpstream;
}

/** Runs one scenario at one viewport in a fresh context; returns the files written. */
export async function runScenario(opts: RunOptions): Promise<string[]> {
  const { browser, baseUrl, outDir, scenario, viewport, upstream } = opts;
  await mkdir(outDir, { recursive: true });
  const size = VIEWPORTS[viewport];
  const recording = scenario.video === true;
  const videoDir = path.join(outDir, '.video-tmp');
  const context: BrowserContext = await browser.newContext({
    viewport: size,
    baseURL: baseUrl,
    ...(scenario.touch?.includes(viewport) ? { hasTouch: true, isMobile: true } : {}),
    ...(recording ? { recordVideo: { dir: videoDir, size } } : {}),
  });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  const origin = new URL(baseUrl).host;
  const aborted: string[] = [];
  const requests: string[] = [];
  const isLocal = (url: URL): boolean => url.host === origin;
  // A capture must never depend on the network: only the local server is reachable, and anything else fails the run.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    requests.push(url.href);
    if (isLocal(url)) return route.continue();
    aborted.push(url.href);
    return route.abort();
  });
  // Routes above see HTTP only: a browser websocket to another host is caught here.
  await context.routeWebSocket(/.*/, (ws) => {
    const url = new URL(ws.url());
    requests.push(url.href);
    if (isLocal(url)) {
      ws.connectToServer();
      return;
    }
    aborted.push(url.href);
    void ws.close();
  });
  const settings = settingsClient(baseUrl);
  // Every run starts from the same server state: no document is left from an earlier run, and the prefs are seeded.
  await settings.reset();
  await settings.put('prefs.v1', { providerId: 'demo', symbol: 'DEMO', timeframe: '1d' });
  const strategyMaker = strategyMakerClient(baseUrl);
  await strategyMaker.reset();
  const page = await context.newPage();
  const written: string[] = [];

  const step: ScenarioContext['step'] = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
      throw new StepError(`scenario "${scenario.name}" step "${label}" failed: ${first}`);
    }
  };
  const ctx: ScenarioContext = {
    page,
    viewport,
    step,
    async screenshot(name, of) {
      const file = path.join(outDir, `${[scenario.name, name, viewport].filter(Boolean).join('-')}.png`);
      await (of ?? page).screenshot({ path: file });
      written.push(file);
      return file;
    },
    upstream,
    requests,
    settings,
    strategyMaker,
    async writeText(name, text) {
      const file = path.join(outDir, `${[scenario.name, name, viewport].join('-')}.txt`);
      await writeFile(file, text);
      written.push(file);
      return file;
    },
    async waitForChart() {
      await step('wait for chart', async () => {
        await page.locator('.chart-container canvas').first().waitFor({ state: 'visible' });
        await page.locator('.chart-legend .legend-title', { hasText: 'DEMO' }).waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
      });
    },
  };

  const video = recording ? page.video() : null;
  try {
    await scenario.run(ctx);
  } catch (err) {
    if (aborted.length) console.error(`e2e:capture: aborted non-local requests: ${[...new Set(aborted)].join(', ')}`);
    throw err;
  } finally {
    await context.close();
  }
  if (aborted.length) {
    const urls = [...new Set(aborted)];
    throw new StepError(`scenario "${scenario.name}" failed: the browser requested ${urls.length} URL(s) outside the Vost server: ${urls.join(', ')}`);
  }
  if (video) {
    const dest = path.join(outDir, `${scenario.name}.webm`);
    await rename(await video.path(), dest);
    written.push(dest);
  }
  return written;
}

/** Talks to `/api/settings` of the server under test (Node has no Origin header, which the server accepts). */
export function settingsClient(baseUrl: string) {
  const url = (name?: string) => `${baseUrl}/api/settings${name ? `/${encodeURIComponent(name)}` : ''}`;
  const write = async (method: string, name: string, body?: unknown) => {
    const res = await fetch(url(name), { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`${method} /api/settings/${name} answered ${res.status}`);
  };
  return {
    async get(name: string): Promise<unknown> {
      const res = await fetch(url(name));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET /api/settings/${name} answered ${res.status}`);
      return res.json();
    },
    put: (name: string, value: unknown) => write('PUT', name, value),
    /** Deletes every document (there is no delete-all endpoint). */
    async reset(): Promise<void> {
      const res = await fetch(url());
      if (!res.ok) throw new Error(`GET /api/settings answered ${res.status}`);
      const { values } = (await res.json()) as { values: Record<string, unknown> };
      for (const name of Object.keys(values)) await write('DELETE', name);
    },
  };
}

/** Talks to `/api/strategy-maker` of the server under test. */
export function strategyMakerClient(baseUrl: string) {
  const url = (rest: string) => `${baseUrl}/api/strategy-maker/${rest}`;
  const write = async (method: string, rest: string, body?: unknown) => {
    const res = await fetch(url(rest), { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`${method} /api/strategy-maker/${rest} answered ${res.status}`);
  };
  const setIds = async (): Promise<string[]> => {
    const res = await fetch(url('sets'));
    if (!res.ok) throw new Error(`GET /api/strategy-maker/sets answered ${res.status}`);
    return ((await res.json()) as { sets: Array<{ id: string }> }).sets.map((x) => x.id);
  };
  return {
    putSet: (set: { id: string }) => write('PUT', `sets/${encodeURIComponent(set.id)}`, set),
    setIds,
    async reset(): Promise<void> {
      for (const id of await setIds()) await write('DELETE', `sets/${encodeURIComponent(id)}`);
      await write('DELETE', 'inputs');
      await write('DELETE', 'model');
    },
  };
}
