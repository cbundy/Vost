import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatusResponse } from '../../shared/status.ts';
import { realTimers } from '../live/socket.ts';
import { handleStatus } from './route.ts';
import { createStatusService } from './scheduler.ts';

let server: http.Server;
let base = '';
let probes = 0;
/** Real timers with the stagger gap squeezed to nothing, so a round takes a few ms. */
const timers = { ...realTimers, setTimeout: (fn: () => void) => setTimeout(fn, 0) };
const service = createStatusService({
  version: '9.9.9',
  intervalSeconds: 0,
  timers,
  log: () => undefined,
  probe: async () => {
    probes++;
    return { ok: true, latencyMs: 7 };
  },
});

beforeAll(async () => {
  server = http.createServer((req, res) => void handleStatus(req, res, new URL(req.url!, 'http://x'), service));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('GET /api/status', () => {
  it('answers the server block and one check per provider and feed, without refreshed', async () => {
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as StatusResponse;
    expect(body.server).toMatchObject({ state: 'ok', version: '9.9.9' });
    expect(typeof body.server.uptimeSeconds).toBe('number');
    expect(body.intervalSeconds).toBe(0);
    expect(body.checks).toHaveLength(17);
    expect(body.checks[0]).toEqual({
      provider: 'binance',
      providerName: 'Binance',
      feed: 'history',
      state: 'unknown',
      latencyMs: null,
      checkedAt: null,
      lastOkAt: null,
      error: null,
      source: 'probe',
    });
    expect('refreshed' in body).toBe(false);
    expect(probes).toBe(0);
  });

  it('?refresh=1 runs a round and says refreshed; a second one right after does not', async () => {
    const first = (await (await fetch(`${base}/api/status?refresh=1`)).json()) as StatusResponse;
    expect(first.refreshed).toBe(true);
    expect(first.checks.every((c: { state: string }) => c.state === 'ok')).toBe(true);
    expect(probes).toBe(17);
    const second = (await (await fetch(`${base}/api/status?refresh=1`)).json()) as StatusResponse;
    expect(second.refreshed).toBe(false);
    expect(probes).toBe(17);
  });

  it('refuses other methods', async () => {
    expect((await fetch(`${base}/api/status`, { method: 'POST' })).status).toBe(405);
  });
});
