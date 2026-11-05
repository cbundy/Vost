import { LINE_STYLES, type LineStyle } from '../lib/drawingStyle';
import { colorToHex, LINE_DRAWN, type PlotStyle, type PlotType } from '../lib/plotStyle';
import { SWATCHES, widthChoices } from '../lib/toolbarPickers';
import { theme } from '../lib/theme';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WIDTHS = widthChoices({ min: 1, max: 4 });

/**
 * The colour popover of one plot in the Style tab: swatches (stored as their hex), a custom colour, the opacity, and for
 * a line-drawn plot its thickness and line style.
 */
export function PlotStylePopover({
  title,
  color,
  opacity,
  type,
  hline,
  width,
  lineStyle,
  onChange,
}: {
  title: string;
  /** The colour the plot is drawn in now. */
  color: string;
  opacity: number;
  type: PlotType;
  hline: boolean;
  width: number;
  lineStyle: LineStyle;
  onChange: (patch: Partial<PlotStyle>) => void;
}) {
  const hex = colorToHex(color);
  const lineDrawn = hline || LINE_DRAWN.has(type);
  return (
    <div className="ind-pop" role="dialog" aria-label={`${title} style`}>
      <div className="dt-swatches">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            className="dt-swatch"
            style={{ background: theme[s] }}
            aria-label={cap(s)}
            title={cap(s)}
            aria-pressed={hex === theme[s]}
            onClick={() => onChange({ color: theme[s] })}
          />
        ))}
      </div>
      <label className="dt-custom">
        Custom
        <input type="color" value={hex ?? '#3b82f6'} aria-label={`Custom ${title} colour`} onChange={(e) => onChange({ color: e.target.value })} />
      </label>
      <label className="dt-custom">
        Opacity
        <span className="ind-opacity">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={opacity}
            aria-label={`${title} opacity`}
            onChange={(e) => onChange({ opacity: Number(e.target.value) === 100 ? undefined : Number(e.target.value) })}
          />
          <span className="ind-opacity-value">{opacity}%</span>
        </span>
      </label>
      {lineDrawn && (
        <>
          <div className="dt-custom">
            Thickness
            <span className="ind-choices" role="radiogroup" aria-label={`${title} thickness`}>
              {WIDTHS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={width === w} className="ind-choice" onClick={() => onChange({ width: w as PlotStyle['width'] })}>
                  {w}
                </button>
              ))}
            </span>
          </div>
          <div className="dt-custom">
            Line style
            <span className="ind-choices" role="radiogroup" aria-label={`${title} line style`}>
              {LINE_STYLES.map((ls) => (
                <button key={ls} type="button" role="radio" aria-checked={lineStyle === ls} className="ind-choice" title={cap(ls)} aria-label={cap(ls)} onClick={() => onChange({ lineStyle: ls })}>
                  <span className="dt-line" style={{ borderTopStyle: ls, width: 18 }} />
                </button>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
