import { describe, expect, it } from 'vitest';
import type { StatusCheck } from '../../../shared/status.ts';
import { groupByProvider, problemCount, relativeTime, serverDown, summaryText, uptimeText, viewOf, worstState, type StatusView } from './status';

const check = (provider: string, feed: StatusCheck['feed'], state: StatusCheck['state']): StatusCheck => ({
  provider,
  providerName: provider.toUpperCase(),
  feed,
  state,
  latencyMs: 100,
  checkedAt: 1,
  lastOkAt: 1,
  error: state === 'ok' ? null : 'boom',
  source: 'probe',
});
const view = (...states: StatusCheck['state'][]): StatusView => ({
  server: { state: 'ok', version: '1', uptimeSeconds: 5 },
  intervalSeconds: 60,
  checks: states.map((s, i) => check(`p${i}`, 'history', s)),
});

describe('worstState', () => {
  it('orders down > degraded > unknown > ok', () => {
    expect(worstState(view('ok', 'ok'))).toBe('ok');
    expect(worstState(view('ok', 'unknown'))).toBe('unknown');
    expect(worstState(view('unknown', 'degraded', 'ok'))).toBe('degraded');
    expect(worstState(view('ok', 'degraded', 'down', 'unknown'))).toBe('down');
  });
  it('counts the server: down server is down even with every check ok', () => {
    const v = view('ok');
    v.server.state = 'down';
    expect(worstState(v)).toBe('down');
  });
  it('is unknown before the first answer', () => {
    expect(worstState(null)).toBe('unknown');
  });
});

describe('problemCount and summaryText', () => {
  it('counts checks that are not ok', () => {
    expect(problemCount(view('ok', 'degraded', 'down', 'unknown'))).toBe(3);
    expect(problemCount(null)).toBe(0);
  });
  it('words the summary', () => {
    expect(summaryText(view('ok'))).toBe('All connections ok');
    expect(summaryText(view('ok', 'down'))).toBe('Connections: 1 problem');
    expect(summaryText(view('degraded', 'down'))).toBe('Connections: 2 problems');
    expect(summaryText(null)).toBe('Connections: checking');
  });
});

describe('serverDown', () => {
  it('marks the server down and every check unknown, keeping the rows', () => {
    const prev = view('ok', 'degraded');
    const v = serverDown(prev);
    expect(v.server.state).toBe('down');
    expect(v.checks.map((c) => c.state)).toEqual(['unknown', 'unknown']);
    expect(v.checks.map((c) => c.provider)).toEqual(['p0', 'p1']);
    expect(v.checks[0].lastOkAt).toBe(1);
    expect(worstState(v)).toBe('down');
    expect(prev.checks[0].state).toBe('ok'); // the previous view is untouched
  });
  it('works with nothing known yet', () => {
    expect(serverDown(null)).toMatchObject({ server: { state: 'down' }, checks: [] });
  });
});

describe('viewOf', () => {
  it('maps the response', () => {
    const v = viewOf({ server: { state: 'ok', version: '2', uptimeSeconds: 9 }, intervalSeconds: 0, checks: [] });
    expect(v).toEqual({ server: { state: 'ok', version: '2', uptimeSeconds: 9 }, intervalSeconds: 0, checks: [] });
  });
});

describe('relativeTime', () => {
  it.each([
    [0, 'just now'],
    [30_000, '30 s ago'],
    [5 * 60_000, '5 min ago'],
    [3 * 3600_000, '3 h ago'],
    [72 * 3600_000, '3 d ago'],
  ])('%i ms ago', (ms, text) => expect(relativeTime(1_000_000, 1_000_000 + ms)).toBe(text));
});

describe('groupByProvider', () => {
  it('groups in server order', () => {
    const g = groupByProvider([check('a', 'history', 'ok'), check('a', 'live', 'ok'), check('b', 'history', 'ok')]);
    expect(g.map((x) => [x.provider, x.checks.length])).toEqual([['a', 2], ['b', 1]]);
  });
});

describe('uptimeText', () => {
  it.each([
    [5, '5 s'],
    [720, '12 min'],
    [3 * 3600 + 10, '3 h'],
    [3 * 86400, '3 d'],
  ])('%i s', (s, text) => expect(uptimeText(s)).toBe(text));
});
