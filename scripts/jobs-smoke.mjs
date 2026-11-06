// Posts a backtest `run` job of generated candles to the running server, polls it until done and checks the result has metrics.
// Usage: node scripts/jobs-smoke.mjs [baseUrl] (default http://localhost:8787)
const base = process.argv[2] ?? 'http://localhost:8787';
const candles = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 8);
  return { time: 1_700_000_000 + i * 3600, open: c, high: c + 1, low: c - 1, close: c + 0.5, volume: 1000 };
});
const config = { strategyId: 'sma_cross', params: { fast: 5, slow: 20 }, initialCapital: 10000, positionSizePct: 100, feeBps: 0, slippageBps: 0, allowShort: false, stopLossPct: null, takeProfitPct: null };

function fail(why) {
  console.error(`jobs smoke failed: ${why}`);
  process.exit(1);
}

const res = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'run', scope: 'smoke', request: { candles, config } }) });
if (res.status !== 201) fail(`POST /api/jobs answered ${res.status}: ${await res.text()}`);
const { id } = await res.json();
const deadline = Date.now() + 60_000;
for (;;) {
  const job = await (await fetch(`${base}/api/jobs/${id}`)).json();
  if (job.state === 'failed') fail(job.error);
  if (job.state === 'done') {
    if (!job.result?.result?.metrics) fail('the result has no metrics');
    await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    console.log('jobs smoke ok');
    process.exit(0);
  }
  if (Date.now() > deadline) fail(`still ${job.state} after 60 s`);
  await new Promise((r) => setTimeout(r, 200));
}
