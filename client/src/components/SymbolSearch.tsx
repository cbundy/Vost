import { useEffect, useMemo, useRef, useState } from 'react';
import { getProvider } from '../lib/providers';
import { groupSymbols } from '../lib/providers/symbolMatch';
import type { SymbolSuggestion } from '../lib/providers';
import { debounce } from '../lib/storage';
import { useStore } from '../state/store';

const ROW_H = 36;
const VIEW_H = 340;
const OVERSCAN = 6;

type Row = { kind: 'header'; title: string } | { kind: 'item'; s: SymbolSuggestion };

export function SymbolSearch() {
  const providerId = useStore((s) => s.providerId);
  const symbol = useStore((s) => s.symbol);
  const suggestions = useStore((s) => s.symbolSuggestions);
  const setSymbol = useStore((s) => s.setSymbol);
  const loadData = useStore((s) => s.loadData);
  const searchSymbols = useStore((s) => s.searchSymbols);

  const provider = getProvider(providerId);
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(symbol);
  }, [symbol]);

  useEffect(() => {
    setOpen(false);
  }, [providerId]);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const debouncedSearch = useMemo(
    () =>
      debounce((q: string) => {
        void searchSymbols(q);
      }, 250),
    [searchSymbols],
  );

  const catalog = useStore((s) => s.symbolCatalog[providerId]);
  const loadSymbolCatalog = useStore((s) => s.loadSymbolCatalog);
  const addSymbolToWatchlist = useStore((s) => s.addSymbolToWatchlist);
  const [scrollTop, setScrollTop] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDirty(false);
    setNavigated(false);
  }, [symbol, providerId]);

  /* Browse mode: nothing typed (or the untouched current symbol) shows the full list. */
  const browsing = !dirty || query.trim() === '';

  const rows = useMemo<Row[]>(() => {
    if (!browsing) return suggestions.map((s) => ({ kind: 'item', s }));
    const full = catalog ?? (provider.listSymbols ? undefined : provider.popularSymbols);
    if (!full) return provider.popularSymbols.map((s) => ({ kind: 'item', s }));
    if (!provider.listSymbols) {
      return [{ kind: 'header', title: 'Popular' }, ...full.map((s): Row => ({ kind: 'item', s }))];
    }
    const out: Row[] = [];
    for (const g of groupSymbols(full, providerId === 'binance' ? 'quote' : 'type')) {
      out.push({ kind: 'header', title: g.title });
      for (const s of g.items) out.push({ kind: 'item', s });
    }
    return out;
  }, [browsing, suggestions, catalog, provider, providerId]);

  /* The list element remounts on open and its content changes with the rows: start from the top. */
  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open, rows]);

  const itemIdx = useMemo(() => rows.flatMap((r, i) => (r.kind === 'item' ? [i] : [])), [rows]);
  const picked = itemIdx.length > 0 ? rows[itemIdx[Math.min(activeIdx, itemIdx.length - 1)]] : undefined;

  const scrollToRow = (rowIdx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = rowIdx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };

  const move = (next: number) => {
    const n = Math.max(0, Math.min(next, itemIdx.length - 1));
    setActiveIdx(n);
    setNavigated(true);
    if (itemIdx.length > 0) scrollToRow(itemIdx[n]);
  };

  const commit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setSymbol(v, { load: true });
    setOpen(false);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (!open) setOpen(true);
      move(activeIdx + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      move(activeIdx - 1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      commit(open && picked?.kind === 'item' && (dirty || navigated) ? picked.s.symbol : query);
    } else if (ev.key === 'Escape') {
      setOpen(false);
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + VIEW_H) / ROW_H) + OVERSCAN);

  return (
    <div className="symbol-search" ref={wrapRef}>
      <input
        type="text"
        value={query}
        spellCheck={false}
        placeholder="Symbol…"
        title="Type a symbol and press Enter to load"
        onChange={(ev) => {
          setQuery(ev.target.value);
          setDirty(true);
          setOpen(true);
          setActiveIdx(0);
          debouncedSearch(ev.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          void loadSymbolCatalog();
          void searchSymbols(query);
        }}
        onKeyDown={onKeyDown}
      />
      {open && rows.length > 0 && (
        <div
          className="symbol-suggestions"
          role="listbox"
          ref={scrollRef}
          onScroll={(ev) => setScrollTop(ev.currentTarget.scrollTop)}
        >
          <div className="symbol-suggestions-inner" style={{ height: rows.length * ROW_H }}>
            {rows.slice(first, last).map((r, k) => {
              const i = first + k;
              const style = { top: i * ROW_H, height: ROW_H };
              if (r.kind === 'header') {
                return (
                  <div key={`h_${r.title}`} className="symbol-group" style={style}>
                    {r.title}
                  </div>
                );
              }
              const n = itemIdx.indexOf(i);
              const s = r.s;
              return (
                <div
                  key={`${s.symbol}_${i}`}
                  role="option"
                  aria-selected={n === activeIdx}
                  className={`symbol-suggestion${n === activeIdx ? ' active' : ''}`}
                  style={style}
                  onMouseEnter={() => setActiveIdx(n)}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    commit(s.symbol);
                  }}
                >
                  <span className="sym">{s.symbol}</span>
                  {s.label && <span className="lbl">{s.label}</span>}
                  {s.exchange && <span className="exch">{s.exchange}</span>}
                  {s.type && <span className="typ">{s.type}</span>}
                  <button
                    type="button"
                    className="symbol-add"
                    title="Add to watchlist"
                    aria-label={`Add ${s.symbol} to watchlist`}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      addSymbolToWatchlist(s);
                    }}
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
