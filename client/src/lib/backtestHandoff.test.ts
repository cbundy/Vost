import { afterEach, describe, expect, it, vi } from 'vitest';
import { strategies } from './backtest/strategies';
import { encodeHandoff, HANDOFF_PREFIX, parseHandoff, takeBacktestHandoff, type Handoff } from './backtestHandoff';

const base: Handoff = {
  v: 1,
  strategyId: 'sma_cross',
  params: { fast: 8, slow: 34, direction: 3 },
  feeBps: 10,
  slippageBps: 5,
  stopLossPct: 2,
  takeProfitPct: 4,
  allowShort: true,
  initialCapital: 10000,
  positionSizePct: 100,
  source: 'BTCUSDT 1h - 1,500 candles',
};
const hashOf = (o: unknown): string => HANDOFF_PREFIX + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('encodeHandoff and parseHandoff', () => {
  for (const id of ['sma_cross', 'ema_cross', 'macd_cross', 'rsi_reversion', 'bollinger', 'donchian']) {
    it(`round trip: ${id}`, () => {
      const params = Object.fromEntries(strategies.find((s) => s.id === id)!.params.map((p) => [p.key, p.default]));
      const h = { ...base, strategyId: id, params };
      const hash = encodeHandoff(h);
      expect(hash.startsWith('#backtest=')).toBe(true);
      expect(parseHandoff(hash)).toEqual(h);
    });
  }
  it('keeps a source with non-latin text and null stop and target', () => {
    const h = { ...base, source: 'Zürich - 日本', stopLossPct: null, takeProfitPct: null };
    expect(parseHandoff(encodeHandoff(h))).toEqual(h);
  });
  it('rejects a wrong version, and pine, custom and unknown strategies', () => {
    expect(parseHandoff(hashOf({ ...base, v: 2 }))).toBeNull();
    expect(parseHandoff(hashOf({ ...base, v: undefined }))).toBeNull();
    for (const strategyId of ['pine', 'custom', 'nope', 7, null]) expect(parseHandoff(hashOf({ ...base, strategyId }))).toBeNull();
  });
  it('rejects non-finite or out-of-range numbers', () => {
    for (const patch of [
      { feeBps: -1 },
      { feeBps: 'x' },
      { slippageBps: -0.1 },
      { stopLossPct: 0 },
      { takeProfitPct: -3 },
      { stopLossPct: 'a' },
      { initialCapital: 0 },
      { positionSizePct: 0 },
      { positionSizePct: 101 },
      { allowShort: 1 },
      { params: { fast: 'a' } },
      { params: [1] },
    ]) {
      expect(parseHandoff(hashOf({ ...base, ...patch }))).toBeNull();
    }
    // JSON cannot hold NaN or Infinity; they arrive as null
    expect(parseHandoff(hashOf({ ...base, feeBps: null }))).toBeNull();
    expect(parseHandoff(HANDOFF_PREFIX + btoa('{"v":1,"feeBps":1e999}'))).toBeNull();
  });
  it('rejects bad base64, bad JSON and a wrong prefix', () => {
    expect(parseHandoff('#backtest=!!!')).toBeNull();
    expect(parseHandoff(HANDOFF_PREFIX + btoa('{nope'))).toBeNull();
    expect(parseHandoff(HANDOFF_PREFIX + btoa('[1]'))).toBeNull();
    expect(parseHandoff(HANDOFF_PREFIX)).toBeNull();
    expect(parseHandoff(encodeHandoff(base).replace('#backtest=', '#other='))).toBeNull();
    expect(parseHandoff('')).toBeNull();
  });
  it('drops unknown parameter keys and clamps to the limits', () => {
    const h = parseHandoff(hashOf({ ...base, params: { fast: 9999, slow: -5, direction: 3, evil: 1 } }));
    expect(h?.params).toEqual({ fast: 500, slow: 2, direction: 3 });
  });
});

describe('takeBacktestHandoff', () => {
  const stub = (hash: string) => {
    const replaceState = vi.fn();
    vi.stubGlobal('location', { hash, pathname: '/', search: '?a=1' });
    vi.stubGlobal('history', { state: null, replaceState });
    return replaceState;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('returns the hand-off and clears the fragment', () => {
    const replaceState = stub(encodeHandoff(base));
    expect(takeBacktestHandoff()).toEqual({ handoff: base });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?a=1');
  });
  it('clears the fragment and reports an unreadable one', () => {
    const replaceState = stub('#backtest=garbage!');
    expect(takeBacktestHandoff()).toEqual({ handoff: null });
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
  it('does nothing without a hand-off or with an unrelated fragment', () => {
    for (const hash of ['', '#foo']) {
      const replaceState = stub(hash);
      expect(takeBacktestHandoff()).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();
    }
  });
});

describe('riskPct in the hand-off', () => {
  it('round trips with it, and an old link without it parses as before', () => {
    const withRisk = { ...base, riskPct: 2 };
    expect(parseHandoff(encodeHandoff(withRisk))).toEqual(withRisk);
    expect(parseHandoff(encodeHandoff(base))).toEqual(base);
    expect('riskPct' in parseHandoff(encodeHandoff(base))!).toBe(false);
    expect(parseHandoff(encodeHandoff({ ...base, riskPct: 100 }))?.riskPct).toBe(100);
  });
  it('refuses 0, negative, over 100, NaN (null in JSON) and text', () => {
    for (const riskPct of [0, -1, 101, null, 'x', '2', true]) expect(parseHandoff(hashOf({ ...base, riskPct }))).toBeNull();
  });
});

describe('market in the hand-off', () => {
  const market = { providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1d' as const };
  it('round trips with it, and an old link without it parses as before', () => {
    const withMarket = { ...base, ...market };
    expect(parseHandoff(encodeHandoff(withMarket))).toEqual(withMarket);
    const old = parseHandoff(encodeHandoff(base))!;
    expect(old).toEqual(base);
    for (const k of ['providerId', 'symbol', 'timeframe']) expect(k in old).toBe(false);
  });
  it('refuses an unknown provider, an empty or too long symbol, an unknown timeframe, and a partial market', () => {
    for (const patch of [
      { providerId: 'nope' },
      { providerId: 7 },
      { symbol: '' },
      { symbol: '   ' },
      { symbol: 'X'.repeat(41) },
      { symbol: 5 },
      { timeframe: '1y' },
      { timeframe: 'x' },
      { timeframe: '1D' },
    ]) {
      expect(parseHandoff(hashOf({ ...base, ...market, ...patch })), JSON.stringify(patch)).toBeNull();
    }
    expect(parseHandoff(hashOf({ ...base, providerId: 'binance' }))).toBeNull();
    expect(parseHandoff(hashOf({ ...base, symbol: 'BTCUSDT', timeframe: '1d' }))).toBeNull();
  });
});
