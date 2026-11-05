import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { legendValueText, paneLegendHtml } from '../lib/paneLegend';
import { paneFactors, recordFactors, type PaneFactors } from '../lib/subPaneSizes';

type ValueSeries = ISeriesApi<'Line'> | ISeriesApi<'Baseline'> | ISeriesApi<'Histogram'>;

/** One indicator sub pane as the legend and the size keeping see it. */
export interface PaneReg {
  id: string;
  /** Which code built it: a rebuild of one path drops only its own panes. */
  source: 'builtin' | 'pine';
  paneIndex: number;
  name: string;
  params: string[];
  entries: Array<{ title: string; color: string; series: ValueSeries }>;
}

/**
 * The plots of one indicator drawn on the price pane, for the value spans of its legend row there. Kept apart from
 * `panes`: the size keeping reads `panes` only, and the price pane has no stretch factor of an indicator's.
 */
export interface OverlayReg {
  id: string;
  source: 'builtin' | 'pine';
  entries: Array<{ title: string; color: string; series: ValueSeries; compact?: boolean }>;
}

/** Shared by the built-in and Pine pane builders: the panes now built and the sizes the user left them at. */
export interface PaneState {
  panes: Map<string, PaneReg>;
  overlays: Map<string, OverlayReg>;
  factors: PaneFactors;
}

export const newPaneState = (): PaneState => ({ panes: new Map(), overlays: new Map(), factors: new Map() });

/** Before a rebuild drops panes: keep their stretch factors per indicator id and forget their registrations. */
export function releasePanes(chart: IChartApi, state: PaneState, source: PaneReg['source'] | 'all', liveIds: ReadonlySet<string>) {
  const panes = chart.panes();
  const mine = [...state.panes.values()].filter((p) => source === 'all' || p.source === source);
  state.factors = recordFactors(
    state.factors,
    mine.flatMap((p) => {
      const pane = panes[p.paneIndex];
      return pane ? [{ id: p.id, factor: pane.getStretchFactor() }] : [];
    }),
    liveIds,
  );
  for (const p of mine) state.panes.delete(p.id);
}

/** Give the sub panes just added their kept (else default) stretch factor. */
export function sizePanes(chart: IChartApi, state: PaneState, panes: ReadonlyArray<{ id: string; paneIndex: number }>) {
  const factors = paneFactors(state.factors, panes.map((p) => p.id));
  const all = chart.panes();
  panes.forEach((p, i) => all[p.paneIndex]?.setStretchFactor(factors[i]));
}

const PAD_TOP = 4;
const PAD_LEFT = 12;
/** Clears the right price scale. */
const PAD_RIGHT = 70;

function valueAt(series: ValueSeries, param: MouseEventParams<Time> | null): number | null {
  if (param?.time != null) {
    const d = param.seriesData.get(series) as { value?: number } | undefined;
    return d?.value ?? null;
  }
  const data = series.data() as ReadonlyArray<{ value?: number }>;
  return data.length > 0 ? (data[data.length - 1].value ?? null) : null;
}

/**
 * A small legend at the top-left of each indicator sub pane: its name and parameters, then each plot's value at the
 * crosshair bar (the last bar with the crosshair away). The divs are overlaid in `hostRef` and placed from each pane's box.
 * `deps` change whenever panes or data are rebuilt.
 */
export function usePaneLegends(
  chart: IChartApi | null,
  stateRef: MutableRefObject<PaneState>,
  hostRef: RefObject<HTMLDivElement | null>,
  /** The element holding the price pane's legend rows: their value spans (`data-ov="<id>:<plot>"`) are written here. */
  rowsRef: RefObject<HTMLDivElement | null>,
  /** Called when the name of a pane's legend is double-clicked. */
  onNameDoubleClick: (id: string) => void,
  deps: readonly unknown[],
): { /** Changes whenever the panes or the price pane's plots change: what the React side of the legends renders from. */ sig: string; /** The element of each pane legend that holds its buttons. */ actionHosts: ReadonlyMap<string, HTMLElement> } {
  const [shape, setShape] = useState<{ sig: string; actionHosts: ReadonlyMap<string, HTMLElement> }>({ sig: '', actionHosts: new Map() });
  const dblRef = useRef(onNameDoubleClick);
  dblRef.current = onNameDoubleClick;
  const api = useRef<{ sync: () => void; position: () => void; refresh: () => void } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!chart || !host) return;
    const divs = new Map<string, HTMLDivElement>();
    const texts = new Map<string, HTMLElement>();
    const actions = new Map<string, HTMLElement>();
    const html = new Map<string, string>();
    let param: MouseEventParams<Time> | null = null;
    let raf = 0;
    let dead = false;
    let shownSig = '';

    const ro = new ResizeObserver(() => position());
    ro.observe(host);

    const refresh = () => {
      for (const reg of stateRef.current.panes.values()) {
        const div = divs.get(reg.id);
        if (!div) continue;
        const next = paneLegendHtml({
          name: reg.name,
          params: reg.params,
          entries: reg.entries.map((e) => ({ title: e.title, color: e.color, value: valueAt(e.series, param) })),
        });
        if (html.get(reg.id) !== next) {
          html.set(reg.id, next);
          const text = texts.get(reg.id);
          if (text) text.innerHTML = next;
        }
      }
      const rows = rowsRef.current;
      if (!rows) return;
      for (const ov of stateRef.current.overlays.values()) {
        ov.entries.forEach((e, i) => {
          const el = rows.querySelector(`[data-ov="${ov.id}:${i}"]`);
          if (el) el.textContent = legendValueText(valueAt(e.series, param), e.compact);
        });
      }
    };

    function position() {
      const box = host!.getBoundingClientRect();
      const panes = chart!.panes();
      for (const reg of stateRef.current.panes.values()) {
        const div = divs.get(reg.id);
        const el = panes[reg.paneIndex]?.getHTMLElement();
        if (!div) continue;
        if (!el) {
          div.style.display = 'none';
          continue;
        }
        const r = el.getBoundingClientRect();
        div.style.display = '';
        div.style.top = `${r.top - box.top + PAD_TOP}px`;
        div.style.left = `${r.left - box.left + PAD_LEFT}px`;
        div.style.right = `${box.right - r.right + PAD_RIGHT}px`;
      }
    }

    const sync = () => {
      const regs = stateRef.current.panes;
      for (const [id, div] of divs) {
        if (!regs.has(id)) {
          div.remove();
          divs.delete(id);
          texts.delete(id);
          actions.delete(id);
          html.delete(id);
        }
      }
      for (const reg of regs.values()) {
        if (divs.has(reg.id)) continue;
        const div = document.createElement('div');
        div.className = 'pane-legend';
        div.dataset.paneId = reg.id;
        // The text is rewritten on every crosshair move; the buttons next to it are React's and never touched.
        const text = document.createElement('span');
        text.className = 'pane-legend-text';
        const act = document.createElement('span');
        act.className = 'legend-actions-host';
        div.append(text, act);
        host.appendChild(div);
        divs.set(reg.id, div);
        texts.set(reg.id, text);
        actions.set(reg.id, act);
      }
      const sig = JSON.stringify([
        [...regs.keys()],
        [...stateRef.current.overlays.values()].map((o) => [o.id, o.entries.map((e) => [e.title, e.color])]),
      ]);
      if (sig !== shownSig) {
        shownSig = sig;
        setShape({ sig, actionHosts: new Map(actions) });
      }
      refresh();
      position();
      ro.disconnect();
      ro.observe(host);
      for (const reg of regs.values()) {
        const el = chart.panes()[reg.paneIndex]?.getHTMLElement();
        if (el) ro.observe(el);
      }
    };
    api.current = { sync, position, refresh };
    const onDouble = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t?.closest('.pane-legend-title')) return;
      const id = t.closest<HTMLElement>('.pane-legend')?.dataset.paneId;
      if (id) dblRef.current(id);
    };
    host.addEventListener('dblclick', onDouble);

    const onMove = (p: MouseEventParams<Time>) => {
      param = p.time != null ? p : null;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => !dead && refresh());
    };
    chart.subscribeCrosshairMove(onMove);
    const onUp = () => requestAnimationFrame(() => !dead && position());
    window.addEventListener('pointerup', onUp);

    return () => {
      dead = true;
      api.current = null;
      cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(onMove);
      window.removeEventListener('pointerup', onUp);
      ro.disconnect();
      host.removeEventListener('dblclick', onDouble);
      for (const div of divs.values()) div.remove();
    };
  }, [chart, stateRef, hostRef, rowsRef]);

  /* The row spans React just rendered start empty: fill them. */
  useEffect(() => {
    api.current?.refresh();
  }, [shape.sig]);

  /* After every rebuild of panes or data: register the divs, then place them once the chart has laid out. */
  useEffect(() => {
    api.current?.sync();
    let second = 0;
    const first = requestAnimationFrame(() => {
      api.current?.sync();
      second = requestAnimationFrame(() => api.current?.sync());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, ...deps]);

  return shape;
}
