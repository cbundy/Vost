/** The find form: its defaults, its numbers read with a message for each bad one, and what Find needs. */
import { SIGNAL_FAMILIES } from './engine';
import { defaultBacktestConfig } from '../lib/backtest/types';
import { DEFAULT_ATR_LENGTH } from '../lib/backtest/exits';
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
    stopMode: 'pct',
    stopAtrMult: '',
    takeProfitMode: 'pct',
    takeProfitAtrMult: '',
    takeProfitR: '',
    trailMode: 'off',
    trailPct: '',
    trailAtrMult: '',
    atrLength: String(DEFAULT_ATR_LENGTH),
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
    stopMode: r.stopMode === 'pct' || r.stopMode === 'atr' ? r.stopMode : d.stopMode,
    stopAtrMult: str('stopAtrMult'),
    takeProfitMode: r.takeProfitMode === 'pct' || r.takeProfitMode === 'atr' || r.takeProfitMode === 'r' ? r.takeProfitMode : d.takeProfitMode,
    takeProfitAtrMult: str('takeProfitAtrMult'),
    takeProfitR: str('takeProfitR'),
    trailMode: r.trailMode === 'off' || r.trailMode === 'pct' || r.trailMode === 'atr' ? r.trailMode : d.trailMode,
    trailPct: str('trailPct'),
    trailAtrMult: str('trailAtrMult'),
    atrLength: str('atrLength'),
    minRR: str('minRR'),
    minHitRatePct: str('minHitRatePct'),
    maxDrawdownPct: str('maxDrawdownPct'),
    setIds: Array.isArray(r.setIds) ? r.setIds.filter((s): s is string => typeof s === 'string') : null,
  };
}

export type FormErrors = Partial<
  Record<
    | 'feeBps'
    | 'slippageBps'
    | 'stopLossPct'
    | 'takeProfitPct'
    | 'stopAtrMult'
    | 'takeProfitAtrMult'
    | 'takeProfitR'
    | 'trailPct'
    | 'trailAtrMult'
    | 'atrLength'
    | 'minRR'
    | 'minHitRatePct'
    | 'maxDrawdownPct',
    string
  >
>;

/** The same wording as the Backtest tab. */
const R_NEEDS_STOP = 'A take profit in times the stop needs a stop loss or a trailing stop';

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

/** ATR length: a whole number from 1 to 500. */
function atrLength(text: string): Num {
  const n = num(text, 'ATR length', 1, 500, false);
  if (n.value != null && !Number.isInteger(n.value)) return { value: null, error: 'ATR length must be a whole number.' };
  return n;
}

export function readForm(f: FindForm): { inputs: FindInputs; errors: FormErrors } {
  const fee = num(f.feeBps, 'Fee', 0, 1000, false);
  const slip = num(f.slippageBps, 'Slippage', 0, 1000, false);
  const stopAtr = f.stopMode === 'atr';
  const takeMode = f.takeProfitMode;
  const trailMode = f.trailMode;
  const stop = stopAtr ? { value: null } : num(f.stopLossPct, 'Stop loss', 0, 100, true, true);
  const stopAtrMult = stopAtr ? num(f.stopAtrMult, 'Stop loss', 0, 1000, true, true) : { value: null };
  const take = takeMode === 'pct' ? num(f.takeProfitPct, 'Take profit', 0, 10000, true, true) : { value: null };
  const takeAtrMult = takeMode === 'atr' ? num(f.takeProfitAtrMult, 'Take profit', 0, 1000, true, true) : { value: null };
  const takeR = takeMode === 'r' ? num(f.takeProfitR, 'Take profit', 0, 1000, true, true) : { value: null };
  const trailPct = trailMode === 'pct' ? num(f.trailPct, 'Trailing stop', 0, 100, true, true) : { value: null };
  const trailAtrMult = trailMode === 'atr' ? num(f.trailAtrMult, 'Trailing stop', 0, 1000, true, true) : { value: null };
  const anyAtr = (stopAtr && stopAtrMult.value != null) || (takeMode === 'atr' && takeAtrMult.value != null) || (trailMode === 'atr' && trailAtrMult.value != null);
  const atrOn = stopAtr || takeMode === 'atr' || trailMode === 'atr';
  const atrLen = atrOn ? atrLength(f.atrLength) : { value: null };
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
  put('stopAtrMult', stopAtrMult);
  put('takeProfitAtrMult', takeAtrMult);
  put('takeProfitR', takeR);
  put('trailPct', trailPct);
  put('trailAtrMult', trailAtrMult);
  put('atrLength', atrLen);
  const hasStop = stop.value != null || stopAtrMult.value != null || trailPct.value != null || trailAtrMult.value != null;
  if (takeR.value != null && !hasStop && !errors.takeProfitR) errors.takeProfitR = R_NEEDS_STOP;
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
      risk: {
        feeBps: fee.value ?? cfg.feeBps,
        slippageBps: slip.value ?? cfg.slippageBps,
        stopLossPct: stop.value,
        takeProfitPct: take.value,
        // Only an option that is on adds its keys, so a form with every option off gives today's four.
        ...(stopAtrMult.value != null && { stopMode: 'atr' as const, stopAtrMult: stopAtrMult.value }),
        ...(takeAtrMult.value != null && { takeProfitMode: 'atr' as const, takeProfitAtrMult: takeAtrMult.value }),
        ...(takeR.value != null && { takeProfitMode: 'r' as const, takeProfitR: takeR.value }),
        ...(trailPct.value != null && { trailMode: 'pct' as const, trailPct: trailPct.value }),
        ...(trailAtrMult.value != null && { trailMode: 'atr' as const, trailAtrMult: trailAtrMult.value }),
        ...(anyAtr && atrLen.value != null && { atrLength: atrLen.value }),
      },
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
