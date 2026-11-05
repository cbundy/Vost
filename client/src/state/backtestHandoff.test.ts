import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBacktest } from '../lib/backtest/engine';
import { buildSignals } from '../lib/backtest/strategies';
import { candlesFromCsvText } from '../lib/csv';
import type { Handoff } from '../lib/backtestHandoff';
import { defaultBacktestConfig } from '../lib/backtest/types';
import { afterEachCleanup, chartOf, stubStorage, track } from './stateTestKit';

afterEach(afterEachCleanup);
beforeEach(() => {
  vi.resetModules();
  stubStorage();
});

const candles = candlesFromCsvText(readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8')).candles;
/** What the strategy maker's Open in Backtest sends for sma_cross 8/34, both directions, fee 10, slippage 5, stop 2, target 4 (its own test pins that). */
const handoff = (over: Partial<Handoff> = {}): Handoff => ({
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
  source: 'BTCUSDT 1h',
  ...over,
});

async function setup() {
  const { useStore } = await import('./store');
  track(useStore);
  return useStore;
}

describe('start-up without a hand-off', () => {
  it('leaves the saved Backtest config and the dock tab as they were and shows no strategy maker toast', async () => {
    const useStore = await setup();
    useStore.getState().init();
    const chart = chartOf(useStore).getState();
    const before = { btConfig: chart.btConfig, dockTab: useStore.getState().dockTab };
    const { takeBacktestHandoff } = await import('../lib/backtestHandoff');
    vi.stubGlobal('location', { hash: '#foo', pathname: '/', search: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
    expect(takeBacktestHandoff()).toBeNull();
    expect(chartOf(useStore).getState().btConfig).toEqual(before.btConfig);
    expect(useStore.getState().dockTab).toBe(before.dockTab);
    expect(useStore.getState().toasts.filter((t) => /strategy maker/i.test(t.text))).toEqual([]);
  });
});

describe('applyBacktestHandoff', () => {
  it('opens the collapsed dock', async () => {
    const useStore = await setup();
    useStore.getState().init();
    expect(useStore.getState().dockCollapsed).toBe(true);
    useStore.getState().applyBacktestHandoff(handoff());
    expect(useStore.getState().dockCollapsed).toBe(false);
  });


  it('fills the active chart Backtest config, shows the tab and says so', async () => {
    const useStore = await setup();
    useStore.getState().init();
    useStore.getState().setDockTab('results');
    chartOf(useStore).getState().setBtConfig({ strategyId: 'pine', pineInputs: { a: 'b' } });
    useStore.getState().applyBacktestHandoff(handoff());
    const cfg = chartOf(useStore).getState().btConfig;
    expect(cfg).toMatchObject({ strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 3 }, feeBps: 10, slippageBps: 5, stopLossPct: 2, takeProfitPct: 4, allowShort: true, initialCapital: 10000, positionSizePct: 100 });
    expect(cfg.pineInputs).toBeUndefined();
    expect(useStore.getState().dockTab).toBe('backtest');
    const toast = useStore.getState().toasts.at(-1)!;
    expect(toast.kind).toBe('info');
    expect(toast.text).toBe(
      'Backtest set from the strategy maker: SMA crossover (fast period 8, slow period 34, direction both). It was found on BTCUSDT 1h; run it on the same data to see the same trades.',
    );
  });
  it('overlays the hand-off params on the strategy defaults', async () => {
    const useStore = await setup();
    useStore.getState().init();
    useStore.getState().applyBacktestHandoff(handoff({ strategyId: 'macd_cross', params: { fast: 8 }, source: '' }));
    expect(chartOf(useStore).getState().btConfig.params).toEqual({ fast: 8, slow: 26, signal: 9, direction: 1 });
  });

  it('takes the same trades the strategy maker showed (it backtests with the default config plus the risk and allowShort)', async () => {
    const useStore = await setup();
    useStore.getState().init();
    const h = handoff();
    useStore.getState().applyBacktestHandoff(h);
    const cfg = chartOf(useStore).getState().btConfig;
    const makerConfig = { ...defaultBacktestConfig(), feeBps: 10, slippageBps: 5, stopLossPct: 2, takeProfitPct: 4, allowShort: true };
    const run = (c: typeof cfg, params: Record<string, number>) =>
      runBacktest(candles, buildSignals(candles, 'sma_cross', params), { ...c, strategyId: 'sma_cross', params }).trades.map((t) => ({
        side: t.side,
        entryBar: t.entryBar,
        exitBar: t.exitBar,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
      }));
    const shown = run(makerConfig, h.params);
    expect(shown.length).toBeGreaterThan(0);
    expect(run(cfg, cfg.params)).toEqual(shown);
  });
});
