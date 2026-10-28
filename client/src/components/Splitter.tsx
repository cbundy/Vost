import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { step } from '../lib/paneSizes';

interface Props {
  /** vertical = a column divider (resizes a width); horizontal = a row divider (resizes a height, growing upward). */
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  /** Called with the wanted size, not clamped for drags (so a caller can tell a drag past its minimum). */
  onChange(next: number, via: 'drag' | 'key'): void;
  onReset(): void;
  /** Called when a drag begins. */
  onDragStart?(): void;
  label: string;
  className?: string;
}

export function Splitter({ orientation, value, min, max, onChange, onReset, onDragStart, label, className }: Props) {
  const latest = useRef({ value, min, max, onChange, orientation, onDragStart });
  latest.current = { value, min, max, onChange, orientation, onDragStart };
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    cleanup.current?.();
    const el = e.currentTarget;
    const app = el.closest('.app');
    const startX = e.clientX;
    const startY = e.clientY;
    const startValue = latest.current.value;
    const pointerId = e.pointerId;
    latest.current.onDragStart?.();
    el.setPointerCapture(pointerId);
    app?.classList.add('resizing', orientation === 'vertical' ? 'resizing-col' : 'resizing-row');

    const move = (ev: globalThis.PointerEvent) => {
      const delta = latest.current.orientation === 'vertical' ? ev.clientX - startX : startY - ev.clientY;
      latest.current.onChange(startValue + delta, 'drag');
    };
    const stop = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
      el.removeEventListener('lostpointercapture', stop);
      app?.classList.remove('resizing', 'resizing-col', 'resizing-row');
      if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
      cleanup.current = null;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('lostpointercapture', stop);
    cleanup.current = stop;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = step(value, e.key, e.shiftKey, { min, max });
    if (next === null) return;
    e.preventDefault();
    onChange(next, 'key');
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-label={label}
      tabIndex={0}
      className={`splitter ${orientation}${className ? ` ${className}` : ''}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
