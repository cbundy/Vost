import { describe, expect, it } from 'vitest';
import { optimizeContextLines, optimizeResultToCsv, optimizerCsvFileName, METRIC_KEYS, type OptimizeRunContext } from './optimizerCsv';
import type { OptimizeRow } from './optimizer';
import type { Metrics } from './types';
import type { SplitSettings } from './validation';

const sample: Metrics = {
  initialCapital: 10000, finalEquity: 11234.5678, totalReturnPct: 12.345678, cagrPct: null, sharpe: 1.23456789, sortino: Number.NaN,
  calmar: 0.5, maxDrawdownPct: -8.123456, maxDrawdownBars: 40, exposurePct: 55.5, buyHoldPct: 3.3, trades: 12, winRatePct: 50,
  profitFactor: Number.POSITIVE_INFINITY, expectancy: 12.5, avgTradePct: Number.NEGATIVE_INFINITY, bestTradePct: 9, worstTradePct: -4,
  avgBarsInTrade: 6, totalFees: 33.3, barsPerYear: 365,
};
const ctx: OptimizeRunContext = {
  strategyId: 'sma_cross', strategyName: 'SMA crossover', params: { threshold: 1.5, 'we"ird': 2, __hidden: 9 }, symbol: 'BTC/USD',
  timeframe: '1h', dataLabel: 'Coinbase, "demo"', rangeFrom: 1_700_000_000, rangeTo: 1_700_086_400, bars: 25, initialCapital: 10000,
  positionSizePct: 100, feeBps: 10, slippageBps: 2, stopLossPct: null, takeProfitPct: 5, allowShort: true,
  sweeps: [{ key: 'fast', from: 5, to: 15, step: 2 }, { key: 'slow', from: 20, to: 40, step: 5 }],
};
const rows: OptimizeRow[] = [
  { params: { fast: 5, slow: 20 }, metrics: sample, value: 1.23456789 },
  { params: { fast: 7, slow: 25 }, metrics: { ...sample, sharpe: null, trades: 0, totalReturnPct: -1.5 }, value: null },
];
const result = { rows, keys: ['fast', 'slow'], metric: 'sharpe' as const, combos: 2, errored: 1 };

/** Minimal CSV parser (quotes, doubled quotes, commas, newlines in quotes). */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(f); f = ''; }
    else if (ch === '\n') { cur.push(f); out.push(cur); cur = []; f = ''; }
    else f += ch;
  }
  cur.push(f);
  out.push(cur);
  return out;
}

describe('optimizeResultToCsv', () => {
  const csv = optimizeResultToCsv(result, ctx);
  const lines = csv.split('\n');
  const contextLines = lines.filter((l) => l.startsWith('# '));
  const records = parseCsv(lines.slice(contextLines.length).join('\n'));

  it('starts with # context lines and then the header', () => {
    expect(lines.slice(0, contextLines.length).every((l) => l.startsWith('# '))).toBe(true);
    expect(contextLines).toEqual(optimizeContextLines(ctx, result));
    expect(records[0]).toEqual(['rank', 'fast', 'slow', ...METRIC_KEYS]);
  });

  it('lists every Metrics field', () => {
    expect(METRIC_KEYS.slice().sort()).toEqual(Object.keys(sample).sort());
  });

  it('records the run settings', () => {
    expect(contextLines).toEqual([
      '# strategy: SMA crossover (sma_cross)',
      '# fixed params: threshold=1.5; we"ird=2',
      '# symbol: BTC/USD',
      '# timeframe: 1h',
      '# data: Coinbase, "demo"',
      '# range from: 2023-11-14T22:13:20.000Z',
      '# range to: 2023-11-15T22:13:20.000Z',
      '# bars: 25',
      '# initial capital: 10000',
      '# position size %: 100',
      '# fee bps: 10',
      '# slippage bps: 2',
      '# stop loss %: off',
      '# take profit %: 5',
      '# shorts: yes',
      '# rank metric: sharpe (Sharpe)',
      '# sweeps: fast 5..15 step 2; slow 20..40 step 5',
      '# combinations: 2',
      '# failed: 1',
    ]);
  });

  it('writes one row per combination in ranking order with raw numbers', () => {
    expect(records).toHaveLength(3);
    const col = (name: string) => records[0].indexOf(name);
    expect(records[1].slice(0, 3)).toEqual(['1', '5', '20']);
    expect(records[2].slice(0, 3)).toEqual(['2', '7', '25']);
    expect(records[1][col('sharpe')]).toBe('1.23456789');
    expect(records[1][col('finalEquity')]).toBe('11234.5678');
    expect(records[1][col('profitFactor')]).toBe('Infinity');
    expect(records[1][col('avgTradePct')]).toBe('-Infinity');
    expect(records[1][col('cagrPct')]).toBe('');
    expect(records[1][col('sortino')]).toBe('');
    expect(records[2][col('sharpe')]).toBe('');
    expect(records[2][col('totalReturnPct')]).toBe('-1.5');
    expect(records.every((r) => r.length === records[0].length)).toBe(true);
  });

  it('round-trips every value', () => {
    for (const [i, r] of rows.entries()) {
      const rec = records[i + 1];
      METRIC_KEYS.forEach((k) => {
        const v = r.metrics[k] as number | null;
        const got = rec[records[0].indexOf(k)];
        if (v == null || Number.isNaN(v)) expect(got).toBe('');
        else expect(Number(got)).toBe(v);
      });
    }
  });

  it('sanitises the file name', () => {
    expect(optimizerCsvFileName(ctx)).toBe('vost_optimizer_BTC_USD_1h.csv');
  });
});

describe('optimizeResultToCsv with a split validation', () => {
  const span = (from: number, to: number, bars: number) => ({ from, to, bars });
  const splitCtx: OptimizeRunContext = {
    ...ctx,
    validation: { method: 'split', inSamplePct: 70, topN: 1, inSample: span(1_700_000_000, 1_700_050_000, 17), heldOut: span(1_700_060_000, 1_700_086_400, 8) },
  };
  const held: Metrics = { ...sample, totalReturnPct: -2.5, trades: 3 };
  const withV = {
    ...result,
    validation: {
      ...(splitCtx.validation as SplitSettings),
      failed: 0,
      checks: [{ rank: 1, params: { fast: 5, slow: 20 }, inSample: sample, heldOut: held, heldOutValue: 1.5, heldOutRank: 1 }],
    },
  };
  const csv = optimizeResultToCsv(withV, splitCtx);
  const lines = csv.split('\n');
  const contextLines = lines.filter((l) => l.startsWith('# '));
  const records = parseCsv(lines.slice(contextLines.length).join('\n'));

  it('adds the validation context lines', () => {
    expect(contextLines).toContain('# validation: split');
    expect(contextLines).toContain('# in-sample %: 70');
    expect(contextLines).toContain('# top results checked: 1');
    expect(contextLines).toContain('# in-sample bars: 17');
    expect(contextLines).toContain('# held-out bars: 8');
    expect(contextLines).toContain(`# held-out from: ${new Date(1_700_060_000 * 1000).toISOString()}`);
    expect(contextLines).toContain(`# in-sample to: ${new Date(1_700_050_000 * 1000).toISOString()}`);
  });

  it('adds heldout columns, filled for checked rows and empty for the rest', () => {
    const header = records[0];
    expect(header.slice(0, 3 + METRIC_KEYS.length)).toEqual(['rank', 'fast', 'slow', ...METRIC_KEYS]);
    expect(header.slice(3 + METRIC_KEYS.length)).toEqual(['heldout_rank', ...METRIC_KEYS.map((k) => `heldout_${k}`)]);
    const col = (k: string) => header.indexOf(k);
    expect(records[1][col('heldout_rank')]).toBe('1');
    expect(records[1][col('heldout_totalReturnPct')]).toBe('-2.5');
    expect(records[1][col('heldout_trades')]).toBe('3');
    expect(records[1][col('heldout_cagrPct')]).toBe('');
    for (const k of ['heldout_rank', ...METRIC_KEYS.map((m) => `heldout_${m}`)]) expect(records[2][col(k)]).toBe('');
    expect(records.every((r) => r.length === header.length)).toBe(true);
  });

  it('without validation the file has no validation lines or heldout columns', () => {
    const plain = optimizeResultToCsv(result, ctx);
    expect(plain).not.toMatch(/validation|heldout/);
  });
});

describe('optimizeResultToCsv with a robustness validation', () => {
  const robCtx: OptimizeRunContext = { ...ctx, validation: { method: 'robustness', radius: 2, rankByScore: true } };
  const scores = [
    { neighbourMean: 0.5, neighbourMin: -1, neighbourCount: 3, robustness: 0.625, capped: false },
    { neighbourMean: null, neighbourMin: null, neighbourCount: 0, robustness: null, capped: false },
  ];
  const withV = { ...result, validation: { method: 'robustness' as const, radius: 2, rankByScore: true, scores } };
  const csv = optimizeResultToCsv(withV, robCtx);
  const lines = csv.split('\n');
  const contextLines = lines.filter((l) => l.startsWith('# '));
  const records = parseCsv(lines.slice(contextLines.length).join('\n'));

  it('adds the robustness context lines', () => {
    expect(contextLines).toContain('# validation: robustness');
    expect(contextLines).toContain('# neighbourhood: 2');
    expect(contextLines).toContain('# rank by robustness: yes');
    expect(optimizeContextLines({ ...robCtx, validation: { method: 'robustness', radius: 1, rankByScore: false } }, result)).toContain('# rank by robustness: no');
  });

  it('adds the four columns with raw numbers and empty nulls, rows in metric order', () => {
    const header = records[0];
    expect(header.slice(0, 3 + METRIC_KEYS.length)).toEqual(['rank', 'fast', 'slow', ...METRIC_KEYS]);
    expect(header.slice(3 + METRIC_KEYS.length)).toEqual(['neighbour_mean', 'neighbour_min', 'neighbour_count', 'robustness']);
    const col = (k: string) => header.indexOf(k);
    expect(records[1][col('rank')]).toBe('1');
    expect(records[1][col('neighbour_mean')]).toBe('0.5');
    expect(records[1][col('neighbour_min')]).toBe('-1');
    expect(records[1][col('neighbour_count')]).toBe('3');
    expect(records[1][col('robustness')]).toBe('0.625');
    for (const k of ['neighbour_mean', 'neighbour_min', 'robustness']) expect(records[2][col(k)]).toBe('');
    expect(records[2][col('neighbour_count')]).toBe('0');
    expect(records.every((r) => r.length === header.length)).toBe(true);
    expect(csv).not.toMatch(/heldout/);
  });
});

describe('optimizeResultToCsv with a walk-forward', () => {
  const span = (from: number, to: number, bars: number) => ({ from, to, bars });
  const spans = [
    { inSample: span(1_700_000_000, 1_700_050_000, 17), heldOut: span(1_700_060_000, 1_700_070_000, 4) },
    { inSample: span(1_700_010_000, 1_700_060_000, 17), heldOut: span(1_700_070_000, 1_700_086_400, 4) },
  ];
  const wfCtx: OptimizeRunContext = { ...ctx, walkForward: { method: 'walk-forward', windows: 2, inSamplePct: 80, anchored: true, spans } };
  const win = (index: number, status: 'ok' | 'failed' | 'no-winner') => ({
    index,
    inSample: spans[index - 1].inSample,
    heldOut: spans[index - 1].heldOut,
    status,
    params: status === 'no-winner' ? null : { fast: 5, slow: 20 },
    inSampleMetrics: status === 'no-winner' ? null : sample,
    inSampleValue: status === 'no-winner' ? null : 1.5,
    heldOutMetrics: status === 'ok' ? { ...sample, totalReturnPct: -2.5, maxDrawdownPct: -4, trades: 3 } : null,
    heldOutValue: status === 'ok' ? 0.5 : null,
  });
  const complete = {
    ...result,
    walkForward: {
      ...wfCtx.walkForward!,
      results: [win(1, 'ok'), win(2, 'ok')],
      incomplete: 0,
      failed: 0,
      combined: { totalReturnPct: 4.5, maxDrawdownPct: -6, trades: 6, efficiency: null },
      equity: [],
    },
  };
  const lines = (r: unknown, c = wfCtx) => optimizeContextLines(c, r as Parameters<typeof optimizeContextLines>[1]);

  it('adds the settings, one block per window and the combined figures', () => {
    const l = lines(complete);
    expect(l).toContain('# validation: walk-forward');
    expect(l).toContain('# windows: 2');
    expect(l).toContain('# in-sample %: 80');
    expect(l).toContain('# mode: anchored');
    expect(l).toContain('# window 1 in-sample bars: 17');
    expect(l).toContain(`# window 2 held-out from: ${new Date(1_700_070_000 * 1000).toISOString()}`);
    expect(l).toContain('# window 1 params: fast=5; slow=20');
    expect(l).toContain('# window 1 in-sample sharpe: 1.5');
    expect(l).toContain('# window 2 held-out return %: -2.5');
    expect(l).toContain('# window 2 held-out max drawdown %: -4');
    expect(l).toContain('# window 2 held-out trades: 3');
    expect(l).toContain('# combined held-out return %: 4.5');
    expect(l).toContain('# combined held-out max drawdown %: -6');
    expect(l).toContain('# combined held-out trades: 6');
    expect(l).toContain('# walk-forward efficiency: n/a');
  });

  it('records failed and no-winner windows and an incomplete combined result', () => {
    const l = lines({ ...complete, walkForward: { ...complete.walkForward, results: [win(1, 'failed'), win(2, 'no-winner')], incomplete: 2, failed: 1, combined: null } });
    expect(l).toContain('# window 1 held-out: failed');
    expect(l).toContain('# window 2 held-out: no winner');
    expect(l).toContain('# combined held-out: incomplete (0 of 2 windows have a held-out result)');
    expect(l.some((x) => x.startsWith('# combined held-out return'))).toBe(false);
  });

  it('rows are the last window grid without held-out columns', () => {
    const csv = optimizeResultToCsv(complete, wfCtx);
    expect(csv).not.toMatch(/heldout/);
    const header = csv.split('\n').find((x) => !x.startsWith('# '))!;
    expect(header.split(',').slice(0, 3)).toEqual(['rank', 'fast', 'slow']);
  });
});

describe('optimizeResultToCsv with a Monte Carlo validation', () => {
  const mcSettings = { method: 'monte-carlo' as const, topN: 1, iterations: 500, mcMethod: 'bootstrap' as const, seed: 3 };
  const mcCtx: OptimizeRunContext = { ...ctx, validation: mcSettings };
  const checks = [
    {
      rank: 1,
      params: { fast: 5, slow: 20 },
      value: 1.23,
      trades: 12,
      status: 'ok' as const,
      result: { finalReturn: { p5: -1, p25: 0, p50: 2, p75: 3, p95: 5 }, maxDrawdown: { p5: 1, p25: 2, p50: 3, p75: 4, p95: 6 }, probLossPct: 12.5 } as never,
    },
  ];
  const withV = { ...result, validation: { ...mcSettings, checks, failed: 0 } };
  const csv = optimizeResultToCsv(withV, mcCtx);
  const lines = csv.split('\n');
  const contextLines = lines.filter((l) => l.startsWith('# '));
  const records = parseCsv(lines.slice(contextLines.length).join('\n'));

  it('adds the context lines', () => {
    expect(contextLines).toEqual(expect.arrayContaining([
      '# validation: monte-carlo',
      '# top results checked: 1',
      '# runs: 500',
      '# method: bootstrap (resample trades)',
      '# seed: 3',
      '# max drawdown is measured trade to trade',
    ]));
    expect(optimizeContextLines({ ...mcCtx, validation: { ...mcSettings, mcMethod: 'shuffle' } }, result)).toContain('# method: shuffle (shuffle trade order)');
  });

  it('adds nine columns filled for checked ranks and empty for the rest', () => {
    const header = records[0];
    expect(header.slice(3 + METRIC_KEYS.length)).toEqual([
      'mc_status', 'mc_trades', 'mc_return_p5', 'mc_return_p50', 'mc_return_p95', 'mc_drawdown_p5', 'mc_drawdown_p50', 'mc_drawdown_p95', 'mc_prob_loss_pct',
    ]);
    expect(records[1].slice(3 + METRIC_KEYS.length)).toEqual(['ok', '12', '-1', '2', '5', '1', '3', '6', '12.5']);
    expect(records[2].slice(3 + METRIC_KEYS.length)).toEqual(Array(9).fill(''));
    expect(records.every((r) => r.length === header.length)).toBe(true);
  });
});
