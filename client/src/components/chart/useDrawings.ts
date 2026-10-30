import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { flushSync } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MOUSE_HIT, TOUCH_HIT, snapToBar, type Pt } from '../../lib/drawingGeometry';
import {
  add,
  commit,
  createDrawingsStorage,
  emptyState,
  loadDrawings,
  saveDrawings,
  newDrawingId,
  preview,
  redo,
  remove,
  removeAll,
  cleanText,
  setText,
  sourceKey,
  undo,
  type Anchor,
  type Drawing,
  type DrawingsState,
  type DrawingsStorage,
} from '../../lib/drawings';
import { drawingKeyAction } from '../../lib/drawingKeys';
import { CURSOR, ERASER, type CursorKind, type RailEntry } from '../../lib/drawingRail';
import { useStore } from '../../state/store';
import { DrawingPrimitive } from './drawingPrimitive';
import { useDrawingSettings } from './useDrawingSettings';
import { ANCHOR_COUNTS, TEXT_TOOLS, TRANSIENT_TOOLS, getTool, type DrawingTool } from './tools';
import { useChart, useChartStore } from '../../state/chartContext';

export { CURSOR, ERASER };

/** Cursors the hover state sets: a small dot, and the eraser over a drawing it would delete. */
const DOT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="3" fill="#e5e7eb" stroke="#111827" stroke-width="1"/></svg>')}") 8 8, default`;
const ERASE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="none" stroke="#ef4444" stroke-width="2"/><path d="M5 15L15 5" stroke="#ef4444" stroke-width="2"/></svg>')}") 10 10, not-allowed`;

/** The container's cursor over empty chart for a mode and cursor kind ('' is the chart's own). */
function baseCursor(tool: string, kind: CursorKind): string {
  if (tool === ERASER) return 'default';
  if (tool !== CURSOR) return 'crosshair';
  return kind === 'dot' ? DOT_CURSOR : '';
}

/** The tab's one drawings store, shared by every chart panel (see createDrawingsStorage). */
let storage: DrawingsStorage | null = null;
function drawingsStorage(): DrawingsStorage {
  storage ??= createDrawingsStorage(() => loadDrawings(ANCHOR_COUNTS, TEXT_TOOLS, TRANSIENT_TOOLS).sources, saveDrawings);
  return storage;
}

/** Pixels a press must travel to count as a drag (a trend line press-drag-release rather than click, click). */
const DRAG_PX = 4;

/** Two taps on the same note within this many ms open its editor. */
const DOUBLE_TAP_MS = 350;

export type DrawingEditor = {
  /** Changes with every opening, so the input is made new. */
  key: number;
  left: number;
  top: number;
  text: string;
  onCommit(text: string): void;
  onCancel(): void;
};
type EditorTarget = { id: string | null; anchor: Anchor; text: string; key: number };

/** Where a dragged handle now is: its starting pixel moved by the drag. */
function handleTarget(def: DrawingTool, drag: Drag, prim: DrawingPrimitive, dx: number, dy: number): Pt {
  const h = def.handles(drag.origPts, prim.viewFor({ tool: def.id, anchors: drag.origAnchors, text: drag.origText, style: drag.origStyle }))[drag.handle as number];
  return { x: h.x + dx, y: h.y + dy };
}

/** A tool whose drawing spans the pane's width or height places even when its anchor is off the scale on that axis. */
const spansX = (t?: DrawingTool) => t?.priceOnly === true || t?.fullWidth === true;
const spansY = (t?: DrawingTool) => t?.timeOnly === true || t?.fullHeight === true;

type Drag = { id: string; handle: number | null; start: Pt; origAnchors: Anchor[]; origText: string | undefined; origStyle: Drawing['style']; origPts: Pt[]; before: Drawing[] };
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
  /** Whether this chart is the active one: only then do the keyboard shortcuts act on it. */
  active = true,
) {
  const providerId = useChart((s) => s.providerId);
  const chartStore = useChartStore();
  const symbol = useChart((s) => s.symbol);
  const activeDatasetId = useChart((s) => s.activeDatasetId);
  const hasData = useChart((s) => s.candles.length > 0);
  const magnet = useStore((s) => s.drawingMagnet);
  const hidden = useStore((s) => s.drawingsHidden);
  const defaults = useStore((s) => s.drawingDefaults);
  const timeframe = useChart((s) => s.timeframe);
  const cursorKind = useStore((s) => s.cursorKind);
  const key = sourceKey({ providerId, symbol, activeDatasetId });

  const [tool, setToolState] = useState(CURSOR);
  const [drawingCount, setDrawingCount] = useState(0);
  const toolRef = useRef(CURSOR);
  const keyRef = useRef(key);
  const hasDataRef = useRef(hasData);
  const primRef = useRef<DrawingPrimitive | null>(null);
  const statesRef = useRef(new Map<string, DrawingsState>());
  const selectedRef = useRef<string | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const measureRef = useRef<Drawing | null>(null);
  const editTargetRef = useRef<EditorTarget | null>(null);
  const editorKeyRef = useRef(0);
  const [editor, setEditor] = useState<DrawingEditor | null>(null);
  const magnetRef = useRef(magnet);
  const hiddenRef = useRef(hidden);
  const cursorKindRef = useRef(cursorKind);
  cursorKindRef.current = cursorKind;
  magnetRef.current = magnet;
  hiddenRef.current = hidden;
  keyRef.current = key;
  hasDataRef.current = hasData;

  const getState = useCallback((): DrawingsState => {
    const k = keyRef.current;
    let st = statesRef.current.get(k);
    if (!st) {
      st = emptyState(drawingsStorage().get(k));
      statesRef.current.set(k, st);
    }
    return st;
  }, []);

  const sync = useCallback(() => {
    if (hiddenRef.current) primRef.current?.set([], null, null);
    else {
      primRef.current?.set(
        getState().drawings,
        selectedRef.current,
        draftRef.current?.drawing ?? null,
        measureRef.current,
        editTargetRef.current?.id ?? null,
      );
    }
  }, [getState]);

  const setState = useCallback(
    (next: DrawingsState, persist: boolean) => {
      statesRef.current.set(keyRef.current, next);
      setDrawingCount(next.drawings.length);
      if (persist) {
        drawingsStorage().set(keyRef.current, next.drawings);
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

  const select = useCallback(
    (id: string | null) => {
      selectedRef.current = id;
      sync();
    },
    [sync],
  );
  const restore = useCallback((k: string, drawings: Drawing[]) => {
    const st = statesRef.current.get(k);
    if (st) statesRef.current.set(k, { ...st, drawings });
  }, []);
  const { settings, openSettings, settingsOpenRef } = useDrawingSettings({ sourceKey: key, getState, restore, setState, select });

  /* A new timeframe or default style changes what shows and how. */
  useEffect(() => {
    sync();
  }, [timeframe, defaults, sync]);

  /** The rail's pick: any tool, Cursor too, clears a measure left on the chart. */
  const pickTool = useCallback(
    (id: string) => {
      measureRef.current = null;
      setTool(id);
    },
    [setTool],
  );

  /** The rail's pick of one entry: sets its mode (and cursor kind) and remembers it as its family's last tool. */
  const pickEntry = useCallback(
    (e: RailEntry) => {
      if (e.toolId !== CURSOR && (hiddenRef.current || !hasDataRef.current)) return;
      pickTool(e.toolId);
      const app = useStore.getState();
      if (e.cursorKind) app.setCursorKind(e.cursorKind);
      app.setDrawingLastTool(e.group, e.key);
    },
    [pickTool],
  );

  /** Pixel position of the editor's note: the container's offset in the chart area plus the anchor's pixel. */
  const editorPos = useCallback(
    (anchor: Anchor): { left: number; top: number } | null => {
      const pt = primRef.current?.toPoint(anchor);
      const el = containerRef.current;
      return pt && el ? { left: el.offsetLeft + pt.x, top: el.offsetTop + pt.y } : null;
    },
    [containerRef],
  );

  const closeEditor = useCallback(() => {
    if (!editTargetRef.current) return;
    editTargetRef.current = null;
    setEditor(null);
    sync();
  }, [sync]);

  const commitEditor = useCallback(
    (target: EditorTarget, raw: string) => {
      if (editTargetRef.current?.key !== target.key) return;
      const text = cleanText(raw);
      editTargetRef.current = null;
      setEditor(null);
      if (target.id === null) {
        if (text) {
          const id = newDrawingId();
          setState(add(getState(), { id, tool: 'text', anchors: [target.anchor], text }), true);
          selectedRef.current = id;
        }
      } else if (!text) {
        setState(remove(getState(), target.id), true);
        if (selectedRef.current === target.id) selectedRef.current = null;
      } else {
        setState(setText(getState(), target.id, text), true);
        selectedRef.current = target.id;
      }
      sync();
    },
    [getState, setState, sync],
  );

  /** Opens the note input at an anchor; for an existing note pass its id and text. Renders at once so it can take focus. */
  const openEditor = useCallback(
    (id: string | null, anchor: Anchor, text: string) => {
      if (editTargetRef.current && editTargetRef.current.id === id && id !== null) return;
      const pos = editorPos(anchor);
      if (!pos) return;
      const target: EditorTarget = { id, anchor, text, key: ++editorKeyRef.current };
      editTargetRef.current = target;
      flushSync(() =>
        setEditor({
          key: target.key,
          ...pos,
          text,
          onCommit: (t) => commitEditor(target, t),
          onCancel: closeEditor,
        }),
      );
      sync();
    },
    [closeEditor, commitEditor, editorPos, sync],
  );

  /* The input follows its anchor when the chart pans, zooms or resizes. */
  useEffect(() => {
    const el = containerRef.current;
    if (!chart || !el) return;
    const place = () => {
      const target = editTargetRef.current;
      const pos = target && editorPos(target.anchor);
      if (!pos) return;
      setEditor((cur) => (cur && cur.key === target.key && (cur.left !== pos.left || cur.top !== pos.top) ? { ...cur, ...pos } : cur));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(place);
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(place);
      } catch {
        /* the chart is already gone */
      }
      ro.disconnect();
    };
  }, [chart, containerRef, editorPos]);

  /* Primitive on the candle series. */
  useEffect(() => {
    if (!chart || !series) return;
    let cachedFor: unknown = null;
    let cachedTimes: number[] = [];
    const prim = new DrawingPrimitive(() => {
      const candles = chartStore.getState().candles;
      if (candles !== cachedFor) {
        cachedFor = candles;
        cachedTimes = candles.map((c) => c.time);
      }
      return cachedTimes;
    }, () => chartStore.getState().timeframe, () => useStore.getState().drawingDefaults);
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
    measureRef.current = null;
    editTargetRef.current = null;
    setEditor(null);
    setDrawingCount(getState().drawings.length);
    sync();
  }, [key, sync, getState]);

  /* Hide all: nothing is painted or hit, and the selection, any draft and the tool are dropped. */
  useEffect(() => {
    if (hidden) {
      selectedRef.current = null;
      draftRef.current = null;
      dragRef.current = null;
      measureRef.current = null;
      editTargetRef.current = null;
      setEditor(null);
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
    const flush = () => drawingsStorage().flush();
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
    let lastTap: { id: string; t: number; p: Pt } | null = null;

    /** Magnet: snap an anchor to the nearest bar's time and OHLC price. */
    const snap = (a: Anchor, def?: DrawingTool): Anchor =>
      magnetRef.current ? snapToBar(chartStore.getState().candles, a, { priceOnly: def?.priceOnly, timeOnly: def?.timeOnly }) : a;

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
      if (getTool(id)?.transient) {
        // A measure is shown, never stored: it stays until the next press, Escape or a rail pick.
        measureRef.current = { id: 'measure', tool: id, anchors };
        draftRef.current = null;
        setTool(CURSOR);
        return;
      }
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
      if (measureRef.current) {
        measureRef.current = null;
        sync();
      }
      const p = point(e);
      if (!inPlot(p)) return;
      const prim = primRef.current;
      if (!prim) return;
      const toolId = toolRef.current;
      if (toolId === ERASER) {
        // A press on a drawing deletes it (one undo step); a press on empty chart is the chart's own.
        const hit = hiddenRef.current || !hasDataRef.current ? null : prim.hit(p, touch ? TOUCH_HIT : MOUSE_HIT);
        if (!hit) return;
        claim(e);
        setState(remove(getState(), hit.id), true);
        if (selectedRef.current === hit.id) selectedRef.current = null;
        sync();
        return; // the pointerup releases
      }
      if (toolId !== CURSOR) {
        const def = getTool(toolId);
        const raw = prim.toAnchor(p);
        if (!def || !raw || !hasDataRef.current) return;
        const anchor = snap(raw, def);
        claim(e);
        const draft = draftRef.current;
        if (draft) {
          finish([draft.drawing.anchors[0], anchor], toolId);
          return; // the pointerup releases
        }
        if (def.text) {
          draftRef.current = null;
          setTool(CURSOR);
          openEditor(null, anchor, '');
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
      const dt = getTool(d?.tool ?? '');
      const origPts = d?.anchors.map((a) => prim.toPoint(a, spansX(dt), spansY(dt)));
      if (!d || !origPts || origPts.some((q) => !q)) return;
      selectedRef.current = d.id;
      claim(e);
      dragRef.current = {
        id: d.id,
        handle: hit.handle,
        start: p,
        origAnchors: d.anchors,
        origText: d.text,
        origStyle: d.style,
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
          const a = snap(raw, getTool(draft.drawing.tool));
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
        const dragged =
          drag.handle !== null && def.dragHandle
            ? def.dragHandle(drag.origPts, drag.handle, handleTarget(def, drag, prim, dx, dy))
            : null;
        const next = drag.origAnchors.map((orig, i) => {
          if (dragged) {
            const a = prim.toAnchor(dragged[i]);
            return a ?? orig;
          }
          if (drag.handle !== null && drag.handle !== i) return orig;
          const q = drag.origPts[i];
          const a = prim.toAnchor({ x: q.x + dx, y: q.y + dy });
          if (!a) return orig;
          const placed = drag.handle !== null ? snap(a, def) : a;
          if (def.timeOnly) return { time: placed.time, price: orig.price };
          return def.priceOnly ? { time: orig.time, price: placed.price } : placed;
        });
        setState(preview(getState(), drag.id, next), false);
        return;
      }
      if (e.buttons === 0) {
        const over = inPlot(p) && prim.hit(p);
        el.style.cursor = toolRef.current === ERASER && over ? ERASE_CURSOR : toolRef.current === CURSOR && over ? 'pointer' : baseCursor(toolRef.current, cursorKindRef.current);
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
        const p = point(e);
        if (touch && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < DRAG_PX) {
          const prev = lastTap;
          lastTap = { id: drag.id, t: e.timeStamp, p };
          const note = getState().drawings.find((x) => x.id === drag.id);
          if (note && TEXT_TOOLS.has(note.tool) && prev && prev.id === drag.id && e.timeStamp - prev.t <= DOUBLE_TAP_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < DRAG_PX * 2) {
            lastTap = null;
            openEditor(note.id, note.anchors[0], note.text ?? '');
          }
        } else lastTap = null;
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

    const onDblClick = (e: MouseEvent) => {
      const prim = primRef.current;
      if (!prim || toolRef.current !== CURSOR || hiddenRef.current) return;
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!inPlot(p)) return;
      const hit = prim.hit(p);
      const d = hit && getState().drawings.find((x) => x.id === hit.id);
      if (!d) return;
      e.stopPropagation();
      e.preventDefault();
      if (TEXT_TOOLS.has(d.tool)) openEditor(d.id, d.anchors[0], d.text ?? '');
      else openSettings(d.id);
    };

    const eat = (e: Event) => {
      if (swallow) e.stopPropagation();
    };

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onUp, true);
    el.addEventListener('dblclick', onDblClick, true);
    el.addEventListener('mousedown', eat, true);
    el.addEventListener('touchstart', eat, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('dblclick', onDblClick, true);
      el.removeEventListener('mousedown', eat, true);
      el.removeEventListener('touchstart', eat, true);
      el.style.cursor = '';
    };
  }, [chart, containerRef, getState, setState, setTool, sync, openEditor, openSettings]);

  /* A new mode or cursor kind shows at once, without waiting for the pointer to move. */
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.style.cursor = baseCursor(tool, cursorKind);
  }, [tool, cursorKind, containerRef, chart]);

  /* Another chart changed a source this chart has open: show it, keeping this chart's own undo history. */
  useEffect(
    () =>
      drawingsStorage().subscribe((changed) => {
        const st = statesRef.current.get(changed);
        const list = drawingsStorage().get(changed);
        if (!st || st.drawings === list) return;
        statesRef.current.set(changed, { ...st, drawings: list });
        if (changed !== keyRef.current) return;
        if (selectedRef.current && !list.some((d) => d.id === selectedRef.current)) selectedRef.current = null;
        setDrawingCount(list.length);
        sync();
      }),
    [sync],
  );

  /* Keyboard: only the active chart's panel acts on it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpenRef.current) return;
      const action = drawingKeyAction(e, {
        active,
        editable: isEditable(e.target),
        dragging: dragRef.current != null,
        hasSelection: selectedRef.current != null,
      });
      if (!action) return;
      if (action === 'escape') {
        if (draftRef.current || toolRef.current !== CURSOR || measureRef.current) {
          measureRef.current = null;
          setTool(CURSOR);
          e.preventDefault();
        }
        return;
      }
      if (action === 'undo' || action === 'redo') {
        const st = getState();
        const next = action === 'redo' ? redo(st) : undo(st);
        e.preventDefault();
        if (next === st) return;
        if (selectedRef.current && !next.drawings.some((d) => d.id === selectedRef.current)) selectedRef.current = null;
        setState(next, true);
        return;
      }
      e.preventDefault();
      setState(remove(getState(), selectedRef.current as string), true);
      selectedRef.current = null;
      sync();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, getState, setState, setTool, sync, settingsOpenRef]);

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
    pickTool,
    pickEntry,
    cursorKind,
    editor,
    hasData,
    magnet,
    hidden,
    toggleMagnet: () => useStore.getState().setDrawingMagnet(!magnet),
    toggleHidden: () => useStore.getState().setDrawingsHidden(!hidden),
    deleteAll,
    drawingCount,
    /** The open settings dialog's model, or null. */
    settings,
    /** Opens the settings dialog of a drawing (a no-op for one without settings). */
    openSettings,
  };
}
