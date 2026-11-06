// Loads server/dist/engine.mjs in a worker thread, sends one backtest `run` on generated candles and exits 0 on a `result` reply.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../server/dist/engine.mjs', import.meta.url));
const candles = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 8);
  return { time: 1_700_000_000 + i * 3600, open: c, high: c + 1, low: c - 1, close: c + 0.5, volume: 1000 };
});
const config = { strategyId: 'sma_cross', params: { fast: 5, slow: 20 }, initialCapital: 10000, positionSizePct: 100, feeBps: 0, slippageBps: 0, allowShort: false, stopLossPct: null, takeProfitPct: null };

const worker = new Worker(file);
const timer = setTimeout(() => fail('timed out after 60 s'), 60_000);
function fail(why) {
  console.error(`engine smoke failed: ${why}`);
  process.exit(1);
}
worker.on('error', (e) => fail(e.message));
worker.on('message', (m) => {
  if (m.proto !== 'backtest') return;
  if (m.msg.type === 'result') {
    clearTimeout(timer);
    console.log('engine smoke ok');
    process.exit(0);
  }
  if (m.msg.type === 'error') fail(m.msg.message);
});
worker.postMessage({ proto: 'backtest', msg: { id: 'smoke', type: 'run', candles, config } });
