import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createChartStore, defaultChartInitial, type ChartEnv } from './chart';
import { ChartStoreProvider, useChart, useChartStore } from './chartContext';

const env: ChartEnv = {
  pushToast: () => {},
  pushMessage: () => {},
  timeZone: () => 'UTC',
  buildTimeframes: () => false,
  datasets: () => [],
  addDataset: () => {},
  removeDataset: () => {},
  onPrefsChange: () => {},
};

function Symbol() {
  return createElement('span', null, useChart((s) => s.symbol));
}

describe('chartContext', () => {
  it('useChart outside a provider throws a clear error', () => {
    expect(() => renderToString(createElement(Symbol))).toThrow(/ChartStoreProvider/);
  });

  it('useChart reads the chart of the nearest provider', () => {
    const a = createChartStore('a', { ...defaultChartInitial(), symbol: 'AAA' }, env);
    const b = createChartStore('b', { ...defaultChartInitial(), symbol: 'BBB' }, env);
    const html = renderToString(
      createElement('div', null, createElement(ChartStoreProvider, { store: a, children: createElement(Symbol) }), createElement(ChartStoreProvider, { store: b, children: createElement(Symbol) })),
    );
    expect(html).toContain('AAA');
    expect(html).toContain('BBB');
  });

  it('useChartStore hands back the store itself', () => {
    const a = createChartStore('a', defaultChartInitial(), env);
    let got: unknown;
    function Probe() {
      got = useChartStore();
      return null;
    }
    renderToString(createElement(ChartStoreProvider, { store: a, children: createElement(Probe) }));
    expect(got).toBe(a);
  });
});
