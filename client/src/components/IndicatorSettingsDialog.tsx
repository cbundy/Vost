import { useRef, useState } from 'react';
import { INDICATOR_META, type IndicatorSpec } from '../lib/indicatorCompute';
import { TIMEFRAME_KINDS, type TimeframeKind } from '../lib/drawingStyle';
import { indicatorShortName, resetIndicator } from '../lib/indicatorSettings';
import { declaresTimeframe } from '../lib/pine/declaredTimeframe';
import { pineIndicatorName } from '../lib/pine/title';
import { useStore } from '../state/store';
import { useChart } from '../state/chartContext';
import { Modal } from './Modal';
import { NumField } from './NumField';
import { PineCalculationSection, PineInputList } from './PineInputControl';

type Tab = 'inputs' | 'visibility';
const TAB_LABEL: Record<Tab, string> = { inputs: 'Inputs', visibility: 'Visibility' };
const TABS: Tab[] = ['inputs', 'visibility'];
const KIND_LABEL: Record<TimeframeKind, string> = { seconds: 'Seconds', minutes: 'Minutes', hours: 'Hours', days: 'Days', weeks: 'Weeks', months: 'Months' };

/**
 * The settings of one indicator or Pine script. Every edit shows on the chart at once; OK keeps them and Cancel,
 * Escape and the close button put the spec back as it was when the dialog opened.
 */
export function IndicatorSettingsDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const spec = useChart((s) => s.indicators.find((i) => i.id === id));
  const run = useChart((s) => s.pineRuns[id]);
  const updateIndicator = useChart((s) => s.updateIndicator);
  const restoreIndicator = useChart((s) => s.restoreIndicator);
  const saved = useStore((s) => (spec ? (s.indicatorDefaults[spec.kind] ?? null) : null));
  const setIndicatorDefault = useStore((s) => s.setIndicatorDefault);
  // The spec as it was when the dialog opened: what Cancel puts back.
  const opening = useRef<IndicatorSpec | undefined>(spec);
  const [tab, setTab] = useState<Tab>('inputs');
  const [menu, setMenu] = useState(false);
  // Remounts the number fields after Reset so they show the restored values.
  const [epoch, setEpoch] = useState(0);
  if (!spec) return null;

  const meta = INDICATOR_META[spec.kind];
  const title = indicatorShortName(spec.kind, pineIndicatorName(spec.source ?? '', run?.result?.declaration.title));
  const cancel = () => {
    if (opening.current) restoreIndicator(id, opening.current);
    onClose();
  };
  const hidden = new Set(spec.hideOn ?? []);
  const setHidden = (k: TimeframeKind, hide: boolean) => {
    const next = new Set(hidden);
    if (hide) next.add(k);
    else next.delete(k);
    updateIndicator(id, { hideOn: TIMEFRAME_KINDS.filter((x) => next.has(x)) });
  };
  const reset = () => {
    restoreIndicator(id, resetIndicator(spec, saved));
    setEpoch((e) => e + 1);
    setMenu(false);
  };
  const saveDefault = () => {
    setIndicatorDefault(spec.kind, { params: spec.params, hideOn: spec.hideOn ?? [] });
    setMenu(false);
  };

  return (
    <Modal
      title={title}
      onClose={cancel}
      width={520}
      footer={
        <>
          <span className="ind-defaults">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              Defaults ▾
            </button>
            {menu && (
              <div className="ind-defaults-menu" role="menu" aria-label="Defaults">
                <button type="button" role="menuitem" onClick={reset}>
                  Reset settings
                </button>
                {spec.kind !== 'pine' && (
                  <button type="button" role="menuitem" onClick={saveDefault} title="Use these settings for new indicators of this kind">
                    Save as default
                  </button>
                )}
              </div>
            )}
          </span>
          <span className="ds-spacer" />
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onClose}>
            OK
          </button>
        </>
      }
    >
      <div className="ds-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`ds-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="ds-panel" role="tabpanel" aria-label={TAB_LABEL[tab]} key={`${tab}-${epoch}`}>
        {tab === 'inputs' && spec.kind !== 'pine' && (
          <>
            {meta.params.length === 0 && <p className="muted-2 ds-hint">This indicator has no inputs.</p>}
            {meta.params.map((p) => (
              <div className="ds-row" key={p.key}>
                <span className="ds-label">{p.label}</span>
                <span className="ds-control">
                  <NumField
                    label={p.label}
                    value={spec.params[p.key] ?? p.default}
                    min={p.min}
                    max={p.max}
                    step={p.step ?? (p.type === 'int' ? 1 : 0.1)}
                    onCommit={(n) => updateIndicator(id, { params: { [p.key]: n } })}
                  />
                </span>
              </div>
            ))}
          </>
        )}
        {tab === 'inputs' && spec.kind === 'pine' && (
          <>
            {!run?.result && <p className="muted-2 ds-hint">The inputs appear after the script runs.</p>}
            {run?.result && run.result.inputs.length > 0 && (
              <PineInputList inputs={run.result.inputs} valueOf={(inp) => spec.inputs?.[inp.name] ?? inp.defval} onChange={(inp, v) => updateIndicator(id, { inputs: { [inp.name]: v } })} />
            )}
            {run?.result && run.result.inputs.length === 0 && !declaresTimeframe(spec.source ?? '') && <p className="muted-2 ds-hint">This script has no inputs.</p>}
            {run?.result && declaresTimeframe(spec.source ?? '') && (
              <PineCalculationSection
                timeframe={spec.calculation?.timeframe ?? run.result.calculation?.timeframe ?? ''}
                gaps={spec.calculation?.gaps ?? run.result.calculation?.gaps ?? true}
                onTimeframe={(timeframe) => updateIndicator(id, { calculation: { timeframe } })}
                onGaps={(gaps) => updateIndicator(id, { calculation: { gaps } })}
              />
            )}
          </>
        )}
        {tab === 'visibility' && (
          <>
            <p className="muted-2 ds-hint">Show this indicator on these timeframes.</p>
            {TIMEFRAME_KINDS.map((k) => (
              <div className="ds-row" key={k}>
                <span className="ds-label">{KIND_LABEL[k]}</span>
                <input type="checkbox" checked={!hidden.has(k)} aria-label={KIND_LABEL[k]} onChange={(e) => setHidden(k, !e.target.checked)} />
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
