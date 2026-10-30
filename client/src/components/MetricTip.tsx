import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { METRIC_HELP, type HelpKey } from '../lib/backtest/metricHelp';
import { placeTip, type Placement } from '../lib/tipPlacement';

const HOVER_DELAY_MS = 300;

/**
 * Wraps a figure and shows its help text: on mouse hover after a short delay,
 * at once on keyboard focus, and on tap for touch. Closes on leave, blur,
 * Escape, scroll and resize. The tooltip is portalled and fixed-positioned so
 * the scrolling dock cannot clip it.
 */
export function MetricTip({
  help,
  children,
  as: Tag = 'span',
  className,
  style,
}: {
  help: HelpKey;
  children: ReactNode;
  as?: 'span' | 'div';
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const touched = useRef(false);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);
  const h = METRIC_HELP[help];

  const clearTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPlace(null);
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const t = tipRef.current;
    setPlace(
      placeTip(
        { left: a.left, top: a.top, width: a.width, height: a.height },
        { width: t.offsetWidth, height: t.offsetHeight },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
      ),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!anchorRef.current?.contains(n) && !tipRef.current?.contains(n)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  useEffect(() => clearTimer, []);

  return (
    <>
      <Tag
        ref={anchorRef as never}
        className={`metric-tip-anchor${className ? ` ${className}` : ''}`}
        style={style}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onPointerDown={(e) => {
          touched.current = e.pointerType === 'touch';
        }}
        onClick={() => {
          if (!touched.current) return;
          touched.current = false;
          if (open) close();
          else setOpen(true);
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return;
          clearTimer();
          timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') close();
        }}
        onFocus={(e) => {
          if (!touched.current && e.currentTarget === e.target) setOpen(true);
        }}
        onBlur={close}
      >
        {children}
      </Tag>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="metric-tip"
            style={
              place
                ? { left: place.left, top: place.top, maxWidth: place.width }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
          >
            <div className="metric-tip-title">{h.label}</div>
            <p>{h.what}</p>
            <p>
              <b>How to read it:</b> {h.reading}
            </p>
            <p>
              <b>Profit:</b> {h.profit}
            </p>
            <p>
              <b>Related:</b> {h.related.map((r) => `${METRIC_HELP[r.key].label} (${r.note})`).join('; ')}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
