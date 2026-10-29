import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import { DEFAULT_RECORD, describeRecord, readRecordConfig, recordedFilter } from './recordConfig.ts';

const read = (env: Record<string, string | undefined>) => {
  const warnings: string[] = [];
  const config = readRecordConfig(env, (l) => warnings.push(l));
  return { config, warnings };
};
const keys = (c: ReturnType<typeof read>['config']) => c.series.map((s) => `${s.provider} ${s.symbol} ${s.timeframe}`);

describe('readRecordConfig', () => {
  it('records the default list on every timeframe the live feed supports when unset or empty', () => {
    for (const env of [{}, { VOST_RECORD: '' }, { VOST_RECORD: '  ' }]) {
      const { config, warnings } = read(env);
      expect(warnings).toEqual([]);
      expect(config.on).toBe(true);
      expect(config.depthBars).toBe(20000);
      const binance = PROVIDER_CATALOG.find((p) => p.id === 'binance')!.timeframes;
      const coinbase = PROVIDER_CATALOG.find((p) => p.id === 'coinbase')!.timeframes;
      const perps = PROVIDER_CATALOG.find((p) => p.id === 'hyperliquid-perps')!.timeframes;
      expect(keys(config)).toEqual([
        ...['BTCUSDT', 'ETHUSDT'].flatMap((sym) => binance.map((tf) => `binance ${sym} ${tf}`)),
        ...['BTC-USD', 'ETH-USD'].flatMap((sym) => coinbase.map((tf) => `coinbase ${sym} ${tf}`)),
        ...['BTC', 'ETH'].flatMap((sym) => perps.map((tf) => `hyperliquid-perps ${sym} ${tf}`)),
      ]);
    }
  });

  it('names the Hyperliquid markets in the default list', () => {
    expect(DEFAULT_RECORD).toContain('hyperliquid-perps:BTC');
    expect(DEFAULT_RECORD).toContain('hyperliquid-perps:ETH');
  });

  it('records nothing for off, in any case', () => {
    for (const v of ['off', 'OFF', ' Off ']) {
      const { config, warnings } = read({ VOST_RECORD: v });
      expect(config.on).toBe(false);
      expect(config.series).toEqual([]);
      expect(warnings).toEqual([]);
    }
  });

  it('upper-cases symbols and takes a timeframe list; commas and spaces both separate', () => {
    const { config } = read({ VOST_RECORD: 'binance:btcusdt:1h/1d, coinbase:eth-usd:1m' });
    expect(keys(config)).toEqual(['binance BTCUSDT 1h', 'binance BTCUSDT 1d', 'coinbase ETH-USD 1m']);
  });

  it('skips each bad entry with one warning that names it', () => {
    const { config, warnings } = read({
      VOST_RECORD: 'nope:BTC yahoo:AAPL binance:BTCUSDT:3h binance:BTCUSDT:1h/2m coinbase:BTC-USD:1M justone a:b:c:d binance::1h binance:ETHUSDT:1h',
    });
    expect(keys(config)).toEqual(['binance ETHUSDT 1h']);
    expect(warnings).toHaveLength(8);
    expect(warnings[0]).toContain('nope:BTC');
    expect(warnings[0]).toContain('unknown provider');
    expect(warnings[1]).toContain('yahoo:AAPL');
    expect(warnings[1]).toContain('no live feed');
    expect(warnings[2]).toContain('binance:BTCUSDT:3h');
    expect(warnings[4]).toContain('coinbase does not offer 1M'.replace('coinbase', 'Coinbase'));
    expect(warnings.every((w) => w.startsWith('[recorder] skipped "'))).toBe(true);
  });

  it('collapses duplicates to one series', () => {
    const { config } = read({ VOST_RECORD: 'binance:BTCUSDT:1h binance:btcusdt:1h/1d' });
    expect(keys(config)).toEqual(['binance BTCUSDT 1h', 'binance BTCUSDT 1d']);
  });

  it('reads VOST_RECORD_BARS, warning and defaulting on a bad value', () => {
    expect(read({ VOST_RECORD_BARS: '500' })).toMatchObject({ config: { depthBars: 500 }, warnings: [] });
    expect(read({ VOST_RECORD_BARS: '100' }).config.depthBars).toBe(100);
    for (const bad of ['99', 'abc', '1.5', '-5', '1e3']) {
      const { config, warnings } = read({ VOST_RECORD_BARS: bad });
      expect(config.depthBars).toBe(20000);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('VOST_RECORD_BARS');
    }
  });
});

describe('recordedFilter', () => {
  it('is true for each listed series and false otherwise', () => {
    const { config } = read({ VOST_RECORD: 'binance:BTCUSDT:1h' });
    const isRecorded = recordedFilter(config);
    expect(isRecorded('binance', 'BTCUSDT', '1h')).toBe(true);
    expect(isRecorded('binance', ' btcusdt ', '1h')).toBe(true);
    expect(isRecorded('binance', 'BTCUSDT', '1d')).toBe(false);
    expect(isRecorded('binance', 'ETHUSDT', '1h')).toBe(false);
    expect(isRecorded('coinbase', 'BTCUSDT', '1h')).toBe(false);
    expect(recordedFilter(read({ VOST_RECORD: 'off' }).config)('binance', 'BTCUSDT', '1h')).toBe(false);
  });
});

describe('describeRecord', () => {
  it('prints the one start line', () => {
    const { config } = read({ VOST_RECORD: 'binance:BTCUSDT:1h/1d', VOST_RECORD_BARS: '500' });
    expect(describeRecord(config, true)).toBe('[recorder] on: 2 series (binance BTCUSDT 1h, binance BTCUSDT 1d), depth 500 bars');
    expect(describeRecord(config, false)).toBe('[recorder] off: candle store off');
    expect(describeRecord(read({ VOST_RECORD: 'off' }).config, true)).toBe('[recorder] off (VOST_RECORD=off)');
  });
});
