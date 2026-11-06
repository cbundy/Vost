/** The find form: its defaults, its numbers read with a message for each bad one, and what Find needs. */
import { SIGNAL_FAMILIES } from './engine';
import { defaultBacktestConfig } from '../lib/backtest/types';
import { MIN_TRADES } from './brush';
import type { FindForm } from './store';
import type { FindInputs } from './run';

const cfg = defaultBacktestConfig();

export function defaultForm(): FindForm {
  return {
    direction: 'both',
    families: [...SIGNAL_FAMILIES],
    feeBps: String(cfg.feeBps),
    slippageBps: String(cfg.slippageBps),
    stopLossPct: '',
    takeProfitPct: '',
    minRR: '',
    minHitRatePct: '',
    maxDrawdownPct: '',
    setIds: null,
  };
}

/** Reads what was stored; anything off falls back to the default for that field. */
export function sanitizeForm(raw: unknown): FindForm {
  const d = defaultForm();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const str = (k: keyof FindForm): string => (typeof r[k] === 'string' ? (r[k] as string) : (d[k] as string));
  return {
    direction: r.direction === 'long' || r.direction === 'short' || r.direction === 'both' ? r.direction : d.direction,
    families: Array.isArray(r.families) ? r.families.filter((f): f is string => (SIGNAL_FAMILIES as readonly string[]).includes(f as string)) : d.families,
    feeBps: str('feeBps'),
    slippageBps: str('slippageBps'),
    stopLossPct: str('stopLossPct'),
    takeProfitPct: str('takeProfitPct'),
    minRR: str('minRR'),
    minHitRatePct: str('minHitRatePct'),
    maxDrawdownPct: str('maxDrawdownPct'),
    setIds: Array.isArray(r.setIds) ? r.setIds.filter((s): s is string => typeof s === 'string') : null,
  };
}

export type FormErrors = Partial<Record<'feeBps' | 'slippageBps' | 'stopLossPct' | 'takeProfitPct' | 'minRR' | 'minHitRatePct' | 'maxDrawdownPct', string>>;

export type Num = { value: number | null; error?: string };

/** Empty is fine when `optional`; otherwise a number inside the range. */
export function num(text: string, label: string, min: number, max: number, optional: boolean, minExclusive = false): Num {
  const t = text.trim();
  if (t === '') return optional ? { value: null } : { value: null, error: `${label} needs a number.` };
  const v = Number(t);
  if (!Number.isFinite(v)) return { value: null, error: `${label} must be a number.` };
  if (v < min || (minExclusive && v === min)) return { value: null, error: `${label} must be ${minExclusive ? 'above' : 'at least'} ${min}.` };
  if (v > max) return { value: null, error: `${label} must be at most ${max}.` };
  return { value: v };
}

export function readForm(f: FindForm): { inputs: FindInputs; errors: FormErrors } {
  const fee = num(f.feeBps, 'Fee', 0, 1000, false);
  const slip = num(f.slippageBps, 'Slippage', 0, 1000, false);
  const stop = num(f.stopLossPct, 'Stop loss', 0, 100, true, true);
  const take = num(f.takeProfitPct, 'Take profit', 0, 10000, true, true);
  const rr = num(f.minRR, 'Min R:R', 0, 1000, true, true);
  const hit = num(f.minHitRatePct, 'Min hit rate', 0, 100, true, true);
  const dd = num(f.maxDrawdownPct, 'Max drawdown', 0, 100, true, true);
  const errors: FormErrors = {};
  const put = (k: keyof FormErrors, n: Num): void => {
    if (n.error) errors[k] = n.error;
  };
  put('feeBps', fee);
  put('slippageBps', slip);
  put('stopLossPct', stop);
  put('takeProfitPct', take);
  put('minRR', rr);
  put('minHitRatePct', hit);
  put('maxDrawdownPct', dd);
  const targets: FindInputs['targets'] = {};
  if (rr.value != null) targets.minRR = rr.value;
  if (hit.value != null) targets.minHitRatePct = hit.value;
  if (dd.value != null) targets.maxDrawdownPct = dd.value;
  return {
    errors,
    inputs: {
      direction: f.direction,
      families: f.families,
      risk: { feeBps: fee.value ?? cfg.feeBps, slippageBps: slip.value ?? cfg.slippageBps, stopLossPct: stop.value, takeProfitPct: take.value },
      targets,
    },
  };
}

/** Why Find is off, or null when it can run. */
export function blocker(errors: FormErrors, families: string[], trades: number): string | null {
  if (Object.keys(errors).length) return 'Fix the numbers marked above.';
  if (families.length === 0) return 'Allow at least one indicator family.';
  if (trades < MIN_TRADES) return `${MIN_TRADES - trades} more trade${MIN_TRADES - trades === 1 ? '' : 's'} needed (${trades} of ${MIN_TRADES}).`;
  return null;
}
