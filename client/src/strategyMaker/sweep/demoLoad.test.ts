import { describe, expect, it, vi } from 'vitest';
import { withDemo } from './demoLoad';

describe('withDemo', () => {
  it('generates a demo market without calling the loader, and hands every other market to it', async () => {
    const inner = vi.fn(async () => []);
    const load = withDemo(inner);
    const a = await load({ provider: 'demo', symbol: 'DEMO' }, '1d');
    const b = await load({ provider: 'demo', symbol: 'DEMO' }, '1d');
    expect(a.length).toBeGreaterThan(1000);
    expect(a.map((c) => c.close)).toEqual(b.map((c) => c.close));
    expect(inner).not.toHaveBeenCalled();
    await load({ provider: 'binance', symbol: 'BTCUSDT' }, '1d');
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
