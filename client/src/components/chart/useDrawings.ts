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
  previewMany,
  redo,
  remove,
  removeAll,
  removeMany,
  cleanText,
  cloneMany,
  setText,
  sourceKey,
  undo,
  anchorRange,
  type Anchor,
  type Drawing,
  type DrawingsState,
  type DrawingsStorage,
} from '../../lib/drawings';
import { addAll, normalizeRect, only, prune, toggle } from '../../lib/drawingSelection';
import { drawingKeyAction } from '../../lib/drawingKeys';
import { DRAG_PX, closesOnFirst, endDraft, isOpenEnded, moveDraft, pressDraft, releaseDraft, secondFinger, startDraft, undoPoint, type Draft } from '../../lib/drawingDraft';
import { CURSOR, ERASER, type CursorKind, type RailEntry } from '../../lib/drawingRail';
import { useStore } from '../../state/store';
import { DrawingPrimitive } from './drawingPrimitive';
import { NotePopups } from './notePopups';
import { editorStyle, type EditorTarget } from './textPlacement';
import { useDrawingActions } from './useDrawingActions';
import { useDrawingSettings } from './useDrawingSettings';
import { ANCHOR_COUNTS, CAPTION_TOOLS, PANE_TOOLS, TEXT_TOOLS, TRANSIENT_TOOLS, getTool, type DrawingTool } from './tools';
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
  storage ??= createDrawingsStorage(() => loadDrawings(ANCHOR_COUNTS, TEXT_TOOLS, TRANSIENT_TOOLS, PANE_TOOLS, CAPTION_TOOLS).sources, saveDrawings);
  return storage;
}

/** Two taps on the same note within this many ms open its editor. */
const DOUBLE_TAP_MS = 350;

/** A double-click or double tap this soon after a drawing was placed belongs to the placing, not to the new drawing. */
const DRAFT_END_GRACE_MS = 500;

export type DrawingEditor = {
  /** Changes with every opening, so the input is made new. */
  key: number;
  left: number;
  top: number;
  text: string;
  /** The tool's resolved style the note is typed in. */
  style: Readonly<Record<string, unknown>>;
  onCommit(text: string): void;
  onCancel(): void;
};

/** Where a dragged handle now is: its starting pixel moved by the drag. */
function handleTarget(def: DrawingTool, drag: Drag, item: DragItem, prim: DrawingPrimitive, dx: number, dy: number): Pt {
  const h = def.handles(item.origPts, prim.viewFor({ tool: def.id, anchors: item.origAnchors, text: item.origText, style: item.origStyle }))[drag.handle as number];
  return { x: h.x + dx, y: h.y + dy };
}

/** One drawing a drag moves, as it was when the press began. */
type DragItem = { id: string; tool: string; origAnchors: Anchor[]; origText: string | undefined; origStyle: Drawing['style']; origPts: Pt[] };
/** `items` is every drawing a body drag moves, or the one whose handle is dragged. */
type Drag = { handle: number | null; start: Pt; items: DragItem[]; before: Drawing[]; /** A press on a member of a selection: a release without moving keeps just this one. */ collapseTo: string | null };
const dragItem = (d: Drawing, origPts: Pt[]): DragItem => ({ id: d.id, tool: d.tool, origAnchors: d.anchors, origText: d.text, origStyle: d.style, origPts });
/** The draft as a drawing the primitive paints (it has fewer anchors than the tool needs until it is placed). */
const draftDrawing = (d: Draft | null): Drawing | null => (d ? { id: 'draft', tool: d.tool, anchors: d.anchors } : null);

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
  const selectedRef = useRef<string[]>([]);
  const draftRef = useRef<Draft | null>(null);
  /** Ends the open-ended draft in flight (Enter); set by the pointer effect, which owns finishing a drawing. */
  const endDraftRef = useRef<() => void>(() => {});
  const dragRef = useRef<Drag | null>(null);
  const measureRef = useRef<Drawing | null>(null);
  const editTargetRef = useRef<EditorTarget | null>(null);
  const popupsRef = useRef(new NotePopups());
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
    popupsRef.current.prune(getState().drawings);
    primRef.current?.setPopups(popupsRef.current.hovered, popupsRef.current.pinned);
    if (hiddenRef.current) primRef.current?.set([], [], null);
    else {
      primRef.current?.set(
        getState().drawings,
        selectedRef.current,
        draftDrawing(draftRef.current),
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
      if (id !== CURSOR) selectedRef.current = [];
      sync();
    },
    [sync],
  );

  const select = useCallback(
    (id: string | null) => {
      selectedRef.current = id ? only(id) : [];
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
    (anchor: Anchor, toolId: string): { left: number; top: number } | null => {
      const pt = primRef.current?.toPoint(anchor, getTool(toolId));
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
          setState(add(getState(), { id, tool: target.tool, anchors: target.anchors, text }), true);
          selectedRef.current = only(id);
        }
      } else if (!text) {
        setState(remove(getState(), target.id), true);
        selectedRef.current = prune(selectedRef.current, getState().drawings);
      } else {
        setState(setText(getState(), target.id, text), true);
        selectedRef.current = only(target.id);
      }
      sync();
    },
    [getState, setState, sync],
  );

  /** Opens the note input at an anchor; for an existing note pass its id and text. Renders at once so it can take focus. */
  const openEditor = useCallback(
    (id: string | null, toolId: string, anchors: Anchor[], text: string, own?: Drawing['style']) => {
      if (editTargetRef.current && editTargetRef.current.id === id && id !== null) return;
      const pos = editorPos(anchors[0], toolId);
      if (!pos) return;
      const style = editorStyle(toolId, own, useStore.getState().drawingDefaults);
      const target: EditorTarget = { id, tool: toolId, anchors, text, style, key: ++editorKeyRef.current };
      editTargetRef.current = target;
      flushSync(() =>
        setEditor({
          key: target.key,
          ...pos,
          text,
          style,
          onCommit: (t) => commitEditor(target, t),
          onCancel: closeEditor,
        }),
      );
      sync();
    },
    [closeEditor, commitEditor, editorPos, sync],
  );

  const deleteAll = useCallback(() => {
    if (getState().drawings.length === 0) return;
    if (!window.confirm('Delete all drawings on this chart?')) return;
    setState(removeAll(getState()), true);
    selectedRef.current = [];
    draftRef.current = null;
    sync();
  }, [getState, setState, sync]);

  const edit = useCallback(
    (id: string) => {
      const d = getState().drawings.find((x) => x.id === id);
      if (!d) return;
      if (TEXT_TOOLS.has(d.tool)) openEditor(d.id, d.tool, d.anchors, d.text ?? '', d.style);
      else openSettings(d.id);
    },
    [getState, openEditor, openSettings],
  );
  const actions = useDrawingActions({ getState, setState, selectedRef, primRef, containerRef, hiddenRef, sync, edit, deleteAll });
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  /* The input follows its anchor when the chart pans, zooms or resizes. */
  useEffect(() => {
    const el = containerRef.current;
    if (!chart || !el) return;
    const place = () => {
      const target = editTargetRef.current;
      const pos = target && editorPos(target.anchors[0], target.tool);
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
    }, () => chartStore.getState().timeframe, () => useStore.getState().drawingDefaults, () => chartStore.getState().candles);
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
    selectedRef.current = [];
    draftRef.current = null;
    dragRef.current = null;
    measureRef.current = null;
    editTargetRef.current = null;
    popupsRef.current.clear();
    setEditor(null);
    setDrawingCount(getState().drawings.length);
    sync();
  }, [key, sync, getState]);

  /* Hide all: nothing is painted or hit, and the selection, any draft and the tool are dropped. */
  useEffect(() => {
    if (hidden) {
      selectedRef.current = [];
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
    let idle: { p: Pt; collapseTo?: string; /** A still release toggles this note's popup. */ pin?: string } | null = null;
    /** A Shift+press on empty chart: the corner it began at and where the pointer is now. */
    let box: { start: Pt; cur: Pt } | null = null;
    let touch = false;
    let lastTap: { id: string; t: number; p: Pt } | null = null;
    /** The last touch press that added a point to an open-ended draft: a second one close by in time and place ends it. */
    let draftTap: { t: number; p: Pt } | null = null;
    /** When an open-ended draft last ended: the double-click that follows must not open the new drawing's settings. */
    let draftEndedAt = -Infinity;

    /** Magnet: snap an anchor to the nearest bar's time and OHLC price. */
    const snap = (a: Anchor, def?: DrawingTool): Anchor =>
      magnetRef.current && !def?.paneAnchored ? snapToBar(chartStore.getState().candles, a, { priceOnly: def?.priceOnly, timeOnly: def?.timeOnly }) : a;

    /** Whether a drawing's tool has a popup (a note). */
    const hasPopup = (id: string): boolean => {
      const d = getState().drawings.find((x) => x.id === id);
      return !!d && !!getTool(d.tool)?.popup;
    };
    const onLeave = () => {
      if (popupsRef.current.hover(null)) sync();
    };

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
    const finish = (placed: Anchor[], id: string) => {
      let anchors = placed;
      const settle = getTool(id)?.settle;
      const prim = primRef.current;
      if (settle && prim) {
        const def = getTool(id);
        const pts = placed.map((a) => prim.toPoint(a, def));
        if (pts.every((q) => q)) {
          const mapped = settle(pts as Pt[]).map((q, i) => prim.toAnchor(q, def) ?? placed[i] ?? null);
          if (mapped.some((a) => !a)) {
            // A point the tool added cannot be put on the chart: the drawing is not stored.
            draftRef.current = null;
            setTool(CURSOR);
            sync();
            return;
          }
          anchors = mapped as Anchor[];
        }
      }
      if (getTool(id)?.transient) {
        // A measure is shown, never stored: it stays until the next press, Escape or a rail pick.
        measureRef.current = { id: 'measure', tool: id, anchors };
        draftRef.current = null;
        setTool(CURSOR);
        return;
      }
      draftEndedAt = performance.now();
      if (getTool(id)?.text) {
        // A text tool with several anchors (Callout) types its text now that all are placed; the drawing is added on commit.
        draftRef.current = null;
        setTool(CURSOR);
        openEditor(null, id, anchors, '');
        return;
      }
      setState(add(getState(), { id: newDrawingId(), tool: id, anchors }), true);
      const created = getState().drawings.at(-1)!;
      draftRef.current = null;
      setTool(CURSOR);
      selectedRef.current = only(created.id);
      sync();
    };

    /** The user ends an open-ended draft: it is saved when it has enough points, else dropped (the tool stays picked). */
    const endOpen = (draft: Draft) => {
      const step = endDraft(draft, anchorRange(getTool(draft.tool)?.anchors ?? 2).min);
      draftEndedAt = performance.now();
      if (step.done) finish(step.done, draft.tool);
      else {
        draftRef.current = null;
        sync();
      }
    };
    endDraftRef.current = () => {
      const draft = draftRef.current;
      if (draft && draft.phase === 'waiting') endOpen(draft);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!e.isPrimary) {
        // A second finger belongs to the chart (pinch): a draft still being pressed is cancelled.
        const draft = draftRef.current;
        if (draft?.phase === 'pressing') {
          draftRef.current = secondFinger(draft);
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
        selectedRef.current = prune(selectedRef.current, getState().drawings);
        sync();
        return; // the pointerup releases
      }
      if (toolId !== CURSOR) {
        const def = getTool(toolId);
        const raw = prim.toAnchor(p, def);
        if (!def || !raw || !hasDataRef.current) return;
        const anchor = snap(raw, def);
        claim(e);
        const draft = draftRef.current;
        if (draft) {
          if (isOpenEnded(def.anchors) && draft.phase === 'waiting') {
            const { min } = anchorRange(def.anchors);
            const first = prim.toPoint(draft.anchors[0], def);
            const hitOpts = touch ? TOUCH_HIT : MOUSE_HIT;
            const doubleTap = touch && draftTap !== null && e.timeStamp - draftTap.t <= DOUBLE_TAP_MS && Math.hypot(p.x - draftTap.p.x, p.y - draftTap.p.y) < DRAG_PX * 2;
            draftTap = touch ? { t: e.timeStamp, p } : null;
            if (doubleTap || (first && closesOnFirst(draft, p, first, hitOpts.handleRadius, min))) {
              draftTap = null;
              endOpen(draft);
              return; // the pointerup releases
            }
          }
          const step = pressDraft(draft, anchor, def.placed ?? def.anchors);
          if (step.done) finish(step.done, toolId);
          else {
            draftRef.current = step.draft;
            sync();
          }
          return; // the pointerup releases
        }
        if (def.text && def.anchors === 1) {
          draftRef.current = null;
          setTool(CURSOR);
          openEditor(null, toolId, [anchor], '');
          return; // the pointerup releases
        }
        if (anchorRange(def.placed ?? def.anchors).max === 1) {
          finish([anchor], toolId);
          return; // the pointerup releases
        }
        draftRef.current = startDraft(toolId, anchor, p);
        sync();
        return;
      }
      const hit = prim.hit(p, touch ? TOUCH_HIT : MOUSE_HIT);
      const shift = e.shiftKey && !touch;
      if (!hit) {
        if (shift && !hiddenRef.current && hasDataRef.current) {
          // Shift+press on empty chart starts a selection box; the chart does not pan under it.
          claim(e);
          box = { start: p, cur: p };
          return; // the pointerup ends it
        }
        idle = { p };
        return;
      }
      const st = getState();
      const d = st.drawings.find((x) => x.id === hit.id);
      const dt = getTool(d?.tool ?? '');
      const origPts = d?.anchors.map((a) => prim.toPoint(a, dt));
      if (!d || !origPts || origPts.some((q) => !q)) return;
      if (shift && hit.handle === null) {
        // Shift+click adds the drawing to the selection, or takes it out; nothing drags.
        selectedRef.current = toggle(selectedRef.current, d.id);
        claim(e);
        sync();
        return; // the pointerup releases
      }
      const inSelection = selectedRef.current.includes(d.id);
      const multi = inSelection && selectedRef.current.length > 1 && hit.handle === null;
      if (!multi) selectedRef.current = only(d.id);
      claim(e);
      const cloning = hit.handle === null && (e.ctrlKey || e.metaKey);
      /** The selection in paint order that the body drag acts on. */
      const members = st.drawings.filter((x) => selectedRef.current.includes(x.id));
      const collapseTo = multi ? d.id : null;
      const before = st.drawings;
      let moving = hit.handle === null ? members : [d];
      if (cloning) {
        // Ctrl/Cmd+drag: copies of the whole selection are made and the copies are dragged; the copies and their move are
        // one undo step (`before` is pre-copy). Copies of locked drawings stay where they are.
        const cloned = cloneMany(st, members.map((x) => x.id));
        const known = new Set(st.drawings.map((x) => x.id));
        const copies = cloned.drawings.filter((x) => !known.has(x.id));
        selectedRef.current = copies.map((x) => x.id);
        if (copies.length === members.length && members.some((x) => !x.locked)) {
          setState({ ...st, drawings: cloned.drawings }, false);
          moving = copies.filter((_, i) => !members[i].locked);
        } else {
          setState(cloned, true);
          sync();
          return; // the pointerup releases
        }
      }
      const items: DragItem[] = [];
      for (const m of moving) {
        if (m.locked && !cloning) continue;
        const mt = getTool(m.tool);
        const pts = m.anchors.map((a) => prim.toPoint(a, mt));
        if (pts.some((q) => !q) || !prim.shown(m)) continue;
        items.push(dragItem(m, pts as Pt[]));
      }
      if (items.length === 0) {
        // Only locked drawings: the press selects, nothing drags and the chart does not pan under it (the pointerup releases).
        if (collapseTo || hasPopup(d.id)) idle = { p, collapseTo: collapseTo ?? undefined, pin: hasPopup(d.id) ? d.id : undefined };
        sync();
        return;
      }
      dragRef.current = { handle: hit.handle, start: p, items, before, collapseTo };
      sync();
    };

    const onMove = (e: PointerEvent) => {
      const prim = primRef.current;
      if (!prim) return;
      if (!e.isPrimary) return;
      const p = point(e);
      const draft = draftRef.current;
      if (draft) {
        const draftTool = getTool(draft.tool);
        const raw = prim.toAnchor(p, draftTool);
        if (raw) {
          draftRef.current = moveDraft(draft, snap(raw, draftTool));
          sync();
        }
        return;
      }
      if (box) {
        box.cur = p;
        prim.setBox(Math.hypot(p.x - box.start.x, p.y - box.start.y) < DRAG_PX ? null : normalizeRect(box.start, p));
        return;
      }
      const drag = dragRef.current;
      if (drag) {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        const moves: Record<string, Anchor[]> = {};
        for (const item of drag.items) {
          const def = getTool(item.tool);
          if (!def) continue;
          const dragged =
            drag.handle !== null && def.dragHandle
              ? def.dragHandle(item.origPts, drag.handle, handleTarget(def, drag, item, prim, dx, dy))
              : null;
          moves[item.id] = item.origAnchors.map((orig, i) => {
            if (dragged) {
              const a = prim.toAnchor(dragged[i], def);
              return a ?? orig;
            }
            if (drag.handle !== null && drag.handle !== i) return orig;
            const q = item.origPts[i];
            const a = prim.toAnchor({ x: q.x + dx, y: q.y + dy }, def);
            if (!a) return orig;
            const placed = drag.handle !== null ? snap(a, def) : a;
            if (def.timeOnly) return { time: placed.time, price: orig.price };
            return def.priceOnly ? { time: orig.time, price: placed.price } : placed;
          });
        }
        setState(previewMany(getState(), moves), false);
        return;
      }
      if (e.buttons === 0) {
        const over = inPlot(p) && prim.hit(p);
        // A note's popup shows while the pointer is on the note (or its open popup).
        const hoverId = over && hasPopup(over.id) ? over.id : null;
        if (popupsRef.current.hover(hoverId)) sync();
        el.style.cursor = toolRef.current === ERASER && over ? ERASE_CURSOR : toolRef.current === CURSOR && over ? 'pointer' : baseCursor(toolRef.current, cursorKindRef.current);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      const draft = draftRef.current;
      if (draft && draft.phase === 'pressing') {
        const step = releaseDraft(draft, point(e), getTool(draft.tool)?.placed ?? getTool(draft.tool)?.anchors ?? 2);
        if (step.done) finish(step.done, draft.tool);
        else {
          draftRef.current = step.draft;
          sync();
        }
        release(e);
        return;
      }
      if (box) {
        const b = box;
        box = null;
        const prim = primRef.current;
        prim?.setBox(null);
        release(e);
        const p = point(e);
        if (Math.hypot(p.x - b.start.x, p.y - b.start.y) < DRAG_PX) selectedRef.current = [];
        else if (prim) selectedRef.current = addAll(selectedRef.current, prim.idsInBox(normalizeRect(b.start, p)));
        sync();
        return;
      }
      if (dragRef.current) {
        const drag = dragRef.current;
        dragRef.current = null;
        setState(commit(getState(), drag.before), true);
        release(e);
        const p = point(e);
        const still = Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < DRAG_PX;
        if (still && drag.collapseTo) {
          selectedRef.current = only(drag.collapseTo);
          sync();
        }
        const lead = drag.items[0].id;
        if (still && hasPopup(lead)) {
          popupsRef.current.toggle(lead);
          sync();
        }
        if (touch && still) {
          const prev = lastTap;
          lastTap = { id: lead, t: e.timeStamp, p };
          const note = getState().drawings.find((x) => x.id === lead);
          if (note && TEXT_TOOLS.has(note.tool) && prev && prev.id === lead && e.timeStamp - prev.t <= DOUBLE_TAP_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < DRAG_PX * 2) {
            lastTap = null;
            openEditor(note.id, note.tool, note.anchors, note.text ?? '', note.style);
          }
        } else lastTap = null;
        return;
      }
      if (idle) {
        const p = point(e);
        if (Math.hypot(p.x - idle.p.x, p.y - idle.p.y) < DRAG_PX) {
          if (idle.pin) {
            popupsRef.current.toggle(idle.pin);
            if (idle.collapseTo) selectedRef.current = only(idle.collapseTo);
            sync();
          } else if (idle.collapseTo) {
            selectedRef.current = only(idle.collapseTo);
            sync();
          } else if (selectedRef.current.length > 0) {
            selectedRef.current = [];
            sync();
          }
        }
        idle = null;
      }
      if (swallow) release(e);
    };

    const onDblClick = (e: MouseEvent) => {
      const prim = primRef.current;
      const draft = draftRef.current;
      if (draft && isOpenEnded(getTool(draft.tool)?.anchors ?? 2)) {
        // A double-click ends an open-ended draft; its second press added a point on the first, which the end drops.
        e.stopPropagation();
        e.preventDefault();
        if (draft.phase === 'waiting') endOpen(draft);
        return;
      }
      if (performance.now() - draftEndedAt < DRAFT_END_GRACE_MS) return;
      if (!prim || toolRef.current !== CURSOR || hiddenRef.current) return;
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!inPlot(p)) return;
      const hit = prim.hit(p);
      const d = hit && getState().drawings.find((x) => x.id === hit.id);
      if (!d) return;
      e.stopPropagation();
      e.preventDefault();
      // A note is edited in place; Shift+double-click opens its settings instead.
      if (TEXT_TOOLS.has(d.tool) && !e.shiftKey) openEditor(d.id, d.tool, d.anchors, d.text ?? '', d.style);
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
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('mousedown', eat, true);
    el.addEventListener('touchstart', eat, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('dblclick', onDblClick, true);
      el.removeEventListener('pointerleave', onLeave);
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
        selectedRef.current = prune(selectedRef.current, list);
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
        hasSelection: selectedRef.current.length > 0,
        drafting: draftRef.current != null && isOpenEnded(getTool(draftRef.current.tool)?.anchors ?? 2),
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
      if (action === 'end-draft') {
        e.preventDefault();
        endDraftRef.current();
        return;
      }
      if (action === 'undo-point') {
        e.preventDefault();
        if (draftRef.current) {
          draftRef.current = undoPoint(draftRef.current);
          sync();
        }
        return;
      }
      if (action === 'undo' || action === 'redo') {
        const st = getState();
        const next = action === 'redo' ? redo(st) : undo(st);
        e.preventDefault();
        if (next === st) return;
        selectedRef.current = prune(selectedRef.current, next.drawings);
        setState(next, true);
        return;
      }
      if (action === 'copy') {
        e.preventDefault();
        actionsRef.current.copy();
        return;
      }
      if (action === 'paste') {
        if (actionsRef.current.paste()) e.preventDefault();
        return;
      }
      e.preventDefault();
      setState(removeMany(getState(), selectedRef.current), true);
      selectedRef.current = [];
      sync();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, getState, setState, setTool, sync, settingsOpenRef]);

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
    /** Lock, rename, order, clone, copy and paste, and the lookup behind the right-click menu. */
    actions,
    drawingCount,
    /** The open settings dialog's model, or null. */
    settings,
    /** Opens the settings dialog of a drawing (a no-op for one without settings). */
    openSettings,
  };
}
