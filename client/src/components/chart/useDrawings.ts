import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MOUSE_HIT, TOUCH_HIT, snapToBar, type Pt } from '../../lib/drawingGeometry';
import {
  add,
  commit,
  createDrawingSaver,
  emptyState,
  loadDrawings,
  newDrawingId,
  preview,
  redo,
  remove,
  removeAll,
  sourceKey,
  undo,
  type Anchor,
  type Drawing,
  type DrawingsState,
} from '../../lib/drawings';
import { useStore } from '../../state/store';
import { DrawingPrimitive } from './drawingPrimitive';
import { ANCHOR_COUNTS, getTool } from './tools';

export const CURSOR = 'cursor';
/** Pixels a press must travel to count as a drag (a trend line press-drag-release rather than click, click). */
const DRAG_PX = 4;

type Drag = { id: string; handle: number | null; start: Pt; origAnchors: Anchor[]; origPts: Pt[]; before: Drawing[] };
type Draft = { drawing: Drawing; start: Pt; /** pressing: the button is down; waiting: the first anchor is placed, the next click ends it. */ phase: 'pressing' | 'waiting' };

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * Chart drawing: owns the drawing primitive, the active tool, the selection, pointer routing on the chart
 * container, keyboard shortcuts and persistence. Returns the active tool id for the rail.
 */
export function useDrawings(
  chart: IChartApi | null,
  series: ISeriesApi<'Candlestick'> | null,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const providerId = useStore((s) => s.providerId);
  const symbol = useStore((s) => s.symbol);
  const activeDatasetId = useStore((s) => s.activeDatasetId);
  const hasData = useStore((s) => s.candles.length > 0);
  const magnet = useStore((s) => s.drawingMagnet);
  const hidden = useStore((s) => s.drawingsHidden);
  const key = sourceKey({ providerId, symbol, activeDatasetId });

  const [tool, setToolState] = useState(CURSOR);
  const [drawingCount, setDrawingCount] = useState(0);
  const toolRef = useRef(CURSOR);
  const keyRef = useRef(key);
  const hasDataRef = useRef(hasData);
  const primRef = useRef<DrawingPrimitive | null>(null);
  const statesRef = useRef(new Map<string, DrawingsState>());
  const sourcesRef = useRef<Record<string, Drawing[]> | null>(null);
  const saverRef = useRef<ReturnType<typeof createDrawingSaver> | null>(null);
  const selectedRef = useRef<string | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const magnetRef = useRef(magnet);
  const hiddenRef = useRef(hidden);
  magnetRef.current = magnet;
  hiddenRef.current = hidden;
  keyRef.current = key;
  hasDataRef.current = hasData;

  const getState = useCallback((): DrawingsState => {
    const k = keyRef.current;
    let st = statesRef.current.get(k);
    if (!st) {
      sourcesRef.current ??= loadDrawings(ANCHOR_COUNTS).sources;
      st = emptyState(sourcesRef.current[k] ?? []);
      statesRef.current.set(k, st);
    }
    return st;
  }, []);

  const sync = useCallback(() => {
    if (hiddenRef.current) primRef.current?.set([], null, null);
    else primRef.current?.set(getState().drawings, selectedRef.current, draftRef.current?.drawing ?? null);
  }, [getState]);

  const setState = useCallback(
    (next: DrawingsState, persist: boolean) => {
      statesRef.current.set(keyRef.current, next);
      setDrawingCount(next.drawings.length);
      if (persist) {
        sourcesRef.current = { ...(sourcesRef.current ?? loadDrawings(ANCHOR_COUNTS).sources), [keyRef.current]: next.drawings };
        saverRef.current ??= createDrawingSaver();
        saverRef.current(sourcesRef.current);
      }
      sync();
    },
    [sync],
  );

  const setTool = useCallback(
    (id: string) => {
      if (id !== CURSOR && hiddenRef.current) return;
      toolRef.current = id;
      setToolState(id);
      draftRef.current = null;
      if (id !== CURSOR) selectedRef.current = null;
      sync();
    },
    [sync],
  );

  /* Primitive on the candle series. */
  useEffect(() => {
    if (!chart || !series) return;
    let cachedFor: unknown = null;
    let cachedTimes: number[] = [];
    const prim = new DrawingPrimitive(() => {
      const candles = useStore.getState().candles;
      if (candles !== cachedFor) {
        cachedFor = candles;
        cachedTimes = candles.map((c) => c.time);
      }
      return cachedTimes;
    });
    series.attachPrimitive(prim);
    primRef.current = prim;
    sync();
    return () => {
      primRef.current = null;
      try {
        series.detachPrimitive(prim);
      } catch {
        /* the chart is already gone */
      }
    };
  }, [chart, series, sync]);

  /* A different source shows its own drawings and drops any selection or draft in flight. */
  useEffect(() => {
    selectedRef.current = null;
    draftRef.current = null;
    dragRef.current = null;
    setDrawingCount(getState().drawings.length);
    sync();
  }, [key, sync, getState]);

  /* Hide all: nothing is painted or hit, and the selection, any draft and the tool are dropped. */
  useEffect(() => {
    if (hidden) {
      selectedRef.current = null;
      draftRef.current = null;
      dragRef.current = null;
      toolRef.current = CURSOR;
      setToolState(CURSOR);
    }
    sync();
  }, [hidden, sync]);

  /* No data, no drawing. */
  useEffect(() => {
    if (!hasData) setTool(CURSOR);
  }, [hasData, setTool]);

  /* Flush a pending save when the page goes away. */
  useEffect(() => {
    const flush = () => saverRef.current?.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  /* Pointer routing on the chart container. */
  useEffect(() => {
    const el = containerRef.current;
    if (!chart || !el) return;
    let swallow = false;
    let idle: { p: Pt; hit: boolean } | null = null;
    let touch = false;

    /** Magnet: snap an anchor to the nearest bar's time and OHLC price. */
    const snap = (a: Anchor, priceOnly = false): Anchor =>
      magnetRef.current ? snapToBar(useStore.getState().candles, a, { priceOnly }) : a;

    const point = (e: PointerEvent): Pt => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const inPlot = (p: Pt) => {
      const s = chart.paneSize(0);
      return p.x >= 0 && p.y >= 0 && p.x < s.width && p.y < s.height;
    };
    const scroll = (on: boolean) => chart.applyOptions({ handleScroll: on, handleScale: on });
    const claim = (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (isEditable(document.activeElement)) (document.activeElement as HTMLElement).blur();
      swallow = true;
      scroll(false);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
    };
    const release = (e?: PointerEvent) => {
      swallow = false;
      scroll(true);
      if (e) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* not captured */
        }
      }
    };
    const finish = (anchors: Anchor[], id: string) => {
      setState(add(getState(), { id: newDrawingId(), tool: id, anchors }), true);
      const created = getState().drawings.at(-1)!;
      draftRef.current = null;
      setTool(CURSOR);
      selectedRef.current = created.id;
      sync();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!e.isPrimary) {
        // A second finger belongs to the chart (pinch): a draft still being pressed is cancelled.
        if (draftRef.current?.phase === 'pressing') {
          draftRef.current = null;
          release();
          sync();
        }
        return;
      }
      touch = e.pointerType === 'touch';
      const p = point(e);
      if (!inPlot(p)) return;
      const prim = primRef.current;
      if (!prim) return;
      const toolId = toolRef.current;
      if (toolId !== CURSOR) {
        const def = getTool(toolId);
        const raw = prim.toAnchor(p);
        if (!def || !raw || !hasDataRef.current) return;
        const anchor = snap(raw, def.priceOnly);
        claim(e);
        const draft = draftRef.current;
        if (draft) {
          finish([draft.drawing.anchors[0], anchor], toolId);
          return; // the pointerup releases
        }
        if (def.anchors === 1) {
          finish([anchor], toolId);
          return; // the pointerup releases
        }
        draftRef.current = { drawing: { id: 'draft', tool: toolId, anchors: [anchor, anchor] }, start: p, phase: 'pressing' };
        sync();
        return;
      }
      const hit = prim.hit(p, touch ? TOUCH_HIT : MOUSE_HIT);
      if (!hit) {
        idle = { p, hit: false };
        return;
      }
      const st = getState();
      const d = st.drawings.find((x) => x.id === hit.id);
      const anyX = getTool(d?.tool ?? '')?.priceOnly === true;
      const origPts = d?.anchors.map((a) => prim.toPoint(a, anyX));
      if (!d || !origPts || origPts.some((q) => !q)) return;
      selectedRef.current = d.id;
      claim(e);
      dragRef.current = {
        id: d.id,
        handle: hit.handle,
        start: p,
        origAnchors: d.anchors,
        origPts: origPts as Pt[],
        before: st.drawings,
      };
      sync();
    };

    const onMove = (e: PointerEvent) => {
      const prim = primRef.current;
      if (!prim) return;
      if (!e.isPrimary) return;
      const p = point(e);
      const draft = draftRef.current;
      if (draft) {
        const raw = prim.toAnchor(p);
        if (raw) {
          const a = snap(raw, getTool(draft.drawing.tool)?.priceOnly);
          draftRef.current = { ...draft, drawing: { ...draft.drawing, anchors: [draft.drawing.anchors[0], a] } };
          sync();
        }
        return;
      }
      const drag = dragRef.current;
      if (drag) {
        const def = getTool(getState().drawings.find((x) => x.id === drag.id)?.tool ?? '');
        if (!def) return;
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        const next = drag.origAnchors.map((orig, i) => {
          if (drag.handle !== null && drag.handle !== i) return orig;
          const q = drag.origPts[i];
          const a = prim.toAnchor({ x: q.x + dx, y: q.y + dy });
          if (!a) return orig;
          const placed = drag.handle !== null ? snap(a, def.priceOnly) : a;
          return def.priceOnly ? { time: orig.time, price: placed.price } : placed;
        });
        setState(preview(getState(), drag.id, next), false);
        return;
      }
      if (e.buttons === 0) {
        el.style.cursor = toolRef.current !== CURSOR ? 'crosshair' : inPlot(p) && prim.hit(p) ? 'pointer' : '';
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      const draft = draftRef.current;
      if (draft && draft.phase === 'pressing') {
        const p = point(e);
        const moved = Math.hypot(p.x - draft.start.x, p.y - draft.start.y) >= DRAG_PX;
        const [a, b] = draft.drawing.anchors;
        if (moved) {
          finish([a, b], draft.drawing.tool);
        } else {
          draftRef.current = { ...draft, phase: 'waiting' };
        }
        release(e);
        return;
      }
      if (dragRef.current) {
        const drag = dragRef.current;
        dragRef.current = null;
        setState(commit(getState(), drag.before), true);
        release(e);
        return;
      }
      if (idle) {
        const p = point(e);
        if (Math.hypot(p.x - idle.p.x, p.y - idle.p.y) < DRAG_PX && selectedRef.current) {
          selectedRef.current = null;
          sync();
        }
        idle = null;
      }
      if (swallow) release(e);
    };

    const eat = (e: Event) => {
      if (swallow) e.stopPropagation();
    };

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onUp, true);
    el.addEventListener('mousedown', eat, true);
    el.addEventListener('touchstart', eat, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('mousedown', eat, true);
      el.removeEventListener('touchstart', eat, true);
      el.style.cursor = '';
    };
  }, [chart, containerRef, getState, setState, setTool, sync]);

  /* Keyboard. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || dragRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (draftRef.current || toolRef.current !== CURSOR) {
          setTool(CURSOR);
          e.preventDefault();
        }
        return;
      }
      if (mod && !e.altKey && (k === 'z' || k === 'y')) {
        const wantRedo = k === 'y' || e.shiftKey;
        const st = getState();
        const next = wantRedo ? redo(st) : undo(st);
        e.preventDefault();
        if (next === st) return;
        if (selectedRef.current && !next.drawings.some((d) => d.id === selectedRef.current)) selectedRef.current = null;
        setState(next, true);
        return;
      }
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        e.preventDefault();
        setState(remove(getState(), selectedRef.current), true);
        selectedRef.current = null;
        sync();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getState, setState, setTool, sync]);

  const deleteAll = useCallback(() => {
    if (getState().drawings.length === 0) return;
    if (!window.confirm('Delete all drawings on this chart?')) return;
    setState(removeAll(getState()), true);
    selectedRef.current = null;
    draftRef.current = null;
    sync();
  }, [getState, setState, sync]);

  return {
    tool,
    setTool,
    hasData,
    magnet,
    hidden,
    toggleMagnet: () => useStore.getState().setDrawingMagnet(!magnet),
    toggleHidden: () => useStore.getState().setDrawingsHidden(!hidden),
    deleteAll,
    drawingCount,
  };
}
