import { afterEach, describe, expect, it, vi } from 'vitest';

const workerCall = vi.fn();
vi.mock('../state/worker', () => ({ workerCall: (m: unknown) => workerCall(m) }));

import { makeRole } from './PineRolePicker';

afterEach(() => {
  vi.unstubAllGlobals();
  workerCall.mockReset();
});

describe('makeRole', () => {
  it('converts a stored pre-v5 indicator before reading its plots', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ source: '//@version=4\nstudy("Old")\nplot(sma(close, 5), "line")' }),
    })));
    workerCall.mockResolvedValue({
      type: 'pineResult',
      outcome: { ok: true, kind: 'indicator', plots: [{ name: 'line', kind: 'plot' }], inputs: [] },
    });
    const candles = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
    const role = await makeRole('filter', { scriptId: 'old', name: 'Old' }, candles);
    expect(typeof role).not.toBe('string');
    const sent = workerCall.mock.calls[0][0] as { source: string };
    expect(sent.source).toContain('//@version=6');
  });
});
