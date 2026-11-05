import { useMemo, useState } from 'react';
import type { IndicatorSpec } from '../lib/indicatorCompute';
import { buildPineChart } from '../lib/pine/chartSeries';
import {
  PLOT_TYPES,
  plotRowsBuiltin,
  plotRowsPine,
  resolveRow,
  withPlotStyle,
  withStyleOptions,
  type IndicatorStyle,
  type PlotStyle,
  type PlotType,
} from '../lib/plotStyle';
import type { PineRunState } from '../state/chart';
import { PlotStylePopover } from './PlotStylePopover';

const TYPE_LABEL = Object.fromEntries(PLOT_TYPES.map((t) => [t.value, t.label])) as Record<PlotType, string>;

/** The Style tab: one row per plot, then the output and input values sections. Every edit goes out whole through `onStyle`. */
export function IndicatorStyleTab({
  spec,
  run,
  onStyle,
}: {
  spec: IndicatorSpec;
  run: PineRunState | undefined;
  onStyle: (next: IndicatorStyle | undefined) => void;
}) {
  const style = spec.style;
  const [open, setOpen] = useState<{ key: string; what: 'color' | 'type' } | null>(null);
  const result = run?.result;
  const candles = run?.candles;
  const rows = useMemo(
    () => (spec.kind === 'pine' ? (result && candles ? plotRowsPine(buildPineChart(result, candles, spec.color).series) : []) : plotRowsBuiltin(spec)),
    // The plots of a built-in indicator follow its kind and params; a Pine script's follow its run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.kind, JSON.stringify(spec.params), spec.color, result, candles],
  );
  const setPlot = (key: string, patch: Partial<PlotStyle>) => onStyle(withPlotStyle(style, key, patch));
  const setOpt = (patch: Partial<Omit<IndicatorStyle, 'plots'>>) => onStyle(withStyleOptions(style, patch));
  const toggle = (what: 'color' | 'type', key: string) => setOpen((o) => (o && o.key === key && o.what === what ? null : { key, what }));

  return (
    <>
      {spec.kind === 'pine' && !result && <p className="muted-2 ds-hint">The plots appear after the script runs.</p>}
      {spec.kind === 'pine' && result && rows.length === 0 && <p className="muted-2 ds-hint">This script has no plots to style.</p>}
      {rows.map((row) => {
        const r = resolveRow(row, style?.plots?.[row.key]);
        return (
          <div className="ds-row ind-plot" key={row.key} data-plot={row.key}>
            <label className="ind-plot-name">
              <input type="checkbox" checked={r.visible} aria-label={row.title} onChange={(e) => setPlot(row.key, { visible: e.target.checked ? undefined : false })} />
              <span>{row.title}</span>
            </label>
            <span className="ds-control ind-plot-controls">
              <button type="button" className="ind-color" aria-label={`${row.title} colour`} aria-expanded={open?.key === row.key && open.what === 'color'} onClick={() => toggle('color', row.key)}>
                <span className="dt-chip" style={{ background: r.color }} />
              </button>
              {!row.hline && (
                <button type="button" className="ind-type" aria-label={`${row.title} plot type`} aria-haspopup="listbox" aria-expanded={open?.key === row.key && open.what === 'type'} onClick={() => toggle('type', row.key)}>
                  {TYPE_LABEL[r.type]} ▾
                </button>
              )}
              {!row.hline && (
                <label className="ind-switch">
                  <input type="checkbox" checked={r.priceLine} aria-label={`${row.title} price line`} onChange={(e) => setPlot(row.key, { priceLine: e.target.checked ? true : undefined })} />
                  Price line
                </label>
              )}
            </span>
            {open?.key === row.key && open.what === 'color' && (
              <PlotStylePopover
                title={row.title}
                color={r.color}
                opacity={r.opacity}
                type={r.type}
                hline={row.hline}
                width={r.width}
                lineStyle={r.lineStyle}
                onChange={(patch) => setPlot(row.key, patch)}
              />
            )}
            {open?.key === row.key && open.what === 'type' && (
              <div className="ind-pop dt-list" role="listbox" aria-label={`${row.title} plot type`}>
                {PLOT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="option"
                    aria-selected={r.type === t.value}
                    onClick={() => {
                      setPlot(row.key, { plotType: t.value });
                      setOpen(null);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <h3 className="ds-section">Output values</h3>
      <div className="ds-row">
        <span className="ds-label">Precision</span>
        <select aria-label="Precision" value={style?.precision === undefined ? 'default' : String(style.precision)} onChange={(e) => setOpt({ precision: e.target.value === 'default' ? undefined : Number(e.target.value) })}>
          <option value="default">Default</option>
          {Array.from({ length: 9 }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>
      <div className="ds-row">
        <span className="ds-label">Labels on price scale</span>
        <input type="checkbox" aria-label="Labels on price scale" checked={style?.labelsOnScale ?? spec.kind !== 'volume'} onChange={(e) => setOpt({ labelsOnScale: e.target.checked })} />
      </div>
      <div className="ds-row">
        <span className="ds-label">Values in status line</span>
        <input type="checkbox" aria-label="Values in status line" checked={style?.valuesInStatusLine !== false} onChange={(e) => setOpt({ valuesInStatusLine: e.target.checked ? undefined : false })} />
      </div>
      <h3 className="ds-section">Input values</h3>
      <div className="ds-row">
        <span className="ds-label">Inputs in status line</span>
        <input type="checkbox" aria-label="Inputs in status line" checked={style?.inputsInStatusLine !== false} onChange={(e) => setOpt({ inputsInStatusLine: e.target.checked ? undefined : false })} />
      </div>
    </>
  );
}
