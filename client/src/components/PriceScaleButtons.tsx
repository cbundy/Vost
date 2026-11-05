import { toggleLogMode, type PriceScaleModeId } from '../lib/priceScaleMode';
import { BUTTON_GAP, BUTTON_SIZE, type PriceScaleControl } from './chart/usePriceScale';

/**
 * The two small buttons at the bottom of the main pane's price scale, shown only while the pointer is over the scale:
 * "A" fits the scale to the visible data (lit while on), "L" switches the logarithmic scale (lit while on).
 */
export function PriceScaleButtons({
  control,
  mode,
  onMode,
  disabled,
}: {
  control: PriceScaleControl;
  mode: PriceScaleModeId;
  onMode: (m: PriceScaleModeId) => void;
  disabled: boolean;
}) {
  const { box } = control;
  if (!box || disabled) return null;
  return (
    <div
      className="price-scale-buttons"
      style={{ left: box.left, top: box.top, width: box.width, gap: BUTTON_GAP, ['--ps-size' as string]: `${BUTTON_SIZE}px` }}
      onPointerEnter={() => control.holdButtons(true)}
      onPointerLeave={() => control.holdButtons(false)}
    >
      <button type="button" className={control.auto ? 'on' : ''} title="Auto (fits data to screen)" aria-pressed={control.auto} onClick={() => control.setAuto(!control.auto)}>
        A
      </button>
      <button type="button" className={mode === 'log' ? 'on' : ''} title="Logarithmic scale" aria-pressed={mode === 'log'} onClick={() => onMode(toggleLogMode(mode))}>
        L
      </button>
    </div>
  );
}
