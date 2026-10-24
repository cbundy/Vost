import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBinanceLive, type LiveStatus } from './live';

class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  close() {}
}

beforeEach(() => {
  FakeWS.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startBinanceLive', () => {
  it('logs every failure with url, attempt and close code, falls back, then gives up', () => {
    const logs: { severity: string; text: string }[] = [];
    const statuses: LiveStatus[] = [];
    startBinanceLive({
      symbol: 'BTCUSDT',
      timeframe: '1m',
      onKline: () => undefined,
      onStatus: (s) => statuses.push(s),
      onLog: (severity, text) => logs.push({ severity, text }),
    });
    for (let i = 0; i < 9; i++) {
      const ws = FakeWS.instances[FakeWS.instances.length - 1];
      ws.onclose?.({ code: 1006, reason: '', wasClean: false });
      vi.runOnlyPendingTimers();
    }
    const texts = logs.map((l) => l.text).join('\n');
    expect(texts).toContain('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
    expect(texts).toContain('attempt 1');
    expect(texts).toContain('close code 1006');
    expect(texts).toContain('wasClean false');
    expect(texts).toContain('data-stream.binance.vision');
    expect(texts).toMatch(/region or by a firewall/);
    expect(statuses[statuses.length - 1]).toBe('error');
  });

  it('logs an unsupported timeframe', () => {
    const logs: string[] = [];
    startBinanceLive({
      symbol: 'BTCUSDT',
      timeframe: '7y' as never,
      onKline: () => undefined,
      onStatus: () => undefined,
      onLog: (_s, t) => logs.push(t),
    });
    expect(logs[0]).toContain('7y');
  });

  it('delivers kline frames', () => {
    const got: number[] = [];
    startBinanceLive({
      symbol: 'BTCUSDT',
      timeframe: '1m',
      onKline: (c) => got.push(c.time),
      onStatus: () => undefined,
    });
    FakeWS.instances[0].onmessage?.({ data: JSON.stringify({ k: { t: 60000, o: '1', h: '2', l: '1', c: '2', v: '3', x: false } }) });
    expect(got).toEqual([60]);
  });
});
