import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile, sanitizeFileName } from '../lib/export';
import { fmtNum } from '../lib/format';
import { exportList, filterByTag, type WatchItem } from '../lib/watchlist';
import { quoteFromBars, ROW_BARS } from '../lib/quotes';
import { quoteKey, useQuotes } from '../state/quotes';
import { useStore } from '../state/store';
import { useChart, useChartStore } from '../state/chartContext';

const TAG_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'];
type Key = { providerId: string; symbol: string };
type Menu = { x: number; y: number; item: WatchItem; sectionId: string };

/** Keys of the rows currently on screen, via one IntersectionObserver. */
function useVisibleRows() {
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const els = useRef(new Map<string, Element>());
  const keyOf = useRef(new Map<Element, string>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const obs = useRef<IntersectionObserver | null>(null);

  const observer = () => {
    if (!obs.current && typeof IntersectionObserver !== 'undefined') {
      obs.current = new IntersectionObserver((entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const k = keyOf.current.get(e.target);
            if (k === undefined) continue;
            if (e.isIntersecting) next.add(k);
            else next.delete(k);
          }
          return next.size === prev.size && [...next].every((k) => prev.has(k)) ? prev : next;
        });
      });
    }
    return obs.current;
  };

  useEffect(() => () => { obs.current?.disconnect(); obs.current = null; }, []);

  const rowRef = useCallback((key: string) => {
    let fn = refs.current.get(key);
    if (!fn) {
      fn = (el) => {
        const old = els.current.get(key);
        if (old) {
          obs.current?.unobserve(old);
          keyOf.current.delete(old);
          els.current.delete(key);
          setVisible((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
        refs.current.delete(key);
        if (!el) return;
        refs.current.set(key, fn!);
        els.current.set(key, el);
        keyOf.current.set(el, key);
        const o = observer();
        if (o) o.observe(el);
        else setVisible((prev) => new Set(prev).add(key));
      };
      refs.current.set(key, fn);
    }
    return fn;
  }, []);
  return { visible, rowRef };
}

export function Watchlist() {
  const providerId = useChart((s) => s.providerId);
  const symbol = useChart((s) => s.symbol);
  const candles = useChart((s) => s.candles);
  const timeframe = useChart((s) => s.timeframe);
  const entries = useQuotes((s) => s.entries);
  const { visible, rowRef } = useVisibleRows();
  const wls = useStore((s) => s.watchlists);
  const st = useStore.getState;
  const chartStore = useChartStore();
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<Key | null>(null);
  const [newTag, setNewTag] = useState('');
  const drag = useRef<{ kind: 'item'; key: Key } | { kind: 'section'; id: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const wanted = [...visible].map((k) => {
      const i = k.indexOf(':');
      return { providerId: k.slice(0, i), symbol: k.slice(i + 1), bars: ROW_BARS };
    });
    useQuotes.getState().setWanted('rows', wanted);
  }, [visible]);
  useEffect(() => () => useQuotes.getState().setWanted('rows', []), []);

  const list = wls.lists.find((l) => l.id === wls.activeListId) ?? wls.lists[0];
  const shown = useMemo(() => (list && filter ? filterByTag(list, filter) : list), [list, filter]);
  if (!list || !shown) return null;
  const tagOf = (id: string) => wls.tags.find((t) => t.id === id);

  const quote = (it: WatchItem) => {
    if (timeframe === '1d' && it.providerId === providerId && it.symbol === symbol) {
      const q = quoteFromBars(candles);
      if (q) return q;
    }
    return quoteFromBars(entries[quoteKey(it.providerId, it.symbol)]?.bars);
  };

  const ask = (label: string, initial = '') => window.prompt(label, initial)?.trim() || null;
  const editedItem = editing
    ? list.sections.flatMap((s) => s.items).find((i) => i.providerId === editing.providerId && i.symbol === editing.symbol)
    : undefined;

  const dropItem = (sectionId: string, index: number) => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'item') st().moveWatchItem(list.id, d.key.providerId, d.key.symbol, sectionId, index);
  };
  const dropSection = (index: number) => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'section') st().moveWatchSection(list.id, d.id, index);
  };

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    const err = st().importWatchlist(await f.text());
    if (err) st().pushToast('error', err);
    else st().pushToast('success', 'Watchlist imported.');
  };

  return (
    <div className="watchlist" onClick={() => menu && setMenu(null)}>
      <div className="sidebar-title">
        <span>Watchlist</span>
        <span className="wl-actions">
          <button
            className="ghost icon"
            title="Add current symbol"
            onClick={() => st().addSymbolToWatchlist({ symbol, label: symbol })}
          >
            +
          </button>
          <button className="ghost icon" title="Add section" onClick={() => { const n = ask('Section name'); if (n) st().addWatchSection(list.id, n); }}>
            §
          </button>
          <button
            className="ghost icon"
            title="Export list as JSON"
            onClick={() => downloadFile(`${sanitizeFileName(list.name)}.json`, exportList(list, wls.tags), 'application/json')}
          >
            ⬇
          </button>
          <button className="ghost icon" title="Import list from JSON" onClick={() => fileRef.current?.click()}>
            ⬆
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
        </span>
      </div>
      <div className="form-row">
        <select value={list.id} onChange={(e) => st().setActiveWatchlist(e.target.value)} aria-label="Watchlist">
          {wls.lists.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button className="ghost icon" title="New list" onClick={() => { const n = ask('List name'); if (n) st().createWatchlist(n); }}>＋</button>
        <button className="ghost icon" title="Rename list" onClick={() => { const n = ask('List name', list.name); if (n) st().renameWatchlist(list.id, n); }}>✎</button>
        <button className="ghost icon" title="Duplicate list" onClick={() => st().duplicateWatchlist(list.id)}>⧉</button>
        <button
          className="ghost icon"
          title="Delete list"
          disabled={wls.lists.length < 2}
          onClick={() => { if (window.confirm(`Delete list "${list.name}"?`)) st().deleteWatchlist(list.id); }}
        >
          ✕
        </button>
      </div>
      {wls.tags.length > 0 && (
        <div className="form-row mt-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by tag">
            <option value="">All tags</option>
            {wls.tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="wl-row wl-head" aria-hidden="true">
        <span>Symbol</span>
        <span>Last</span>
        <span>Chg</span>
        <span>Chg%</span>
      </div>
      {shown.sections.map((sec, si) => (
        <div
          key={sec.id}
          className="wl-section"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag.current?.kind === 'section') dropSection(si); else dropItem(sec.id, sec.items.length); }}
        >
          <div
            className="wl-section-head"
            draggable
            onDragStart={() => (drag.current = { kind: 'section', id: sec.id })}
            onClick={() => st().updateWatchlists((s) => ({
              ...s,
              lists: s.lists.map((l) => l.id !== list.id ? l : { ...l, sections: l.sections.map((x) => x.id === sec.id ? { ...x, collapsed: !x.collapsed } : x) }),
            }))}
          >
            <span>{sec.collapsed ? '▸' : '▾'} {sec.name || 'Symbols'}</span>
            <span className="wl-actions" onClick={(e) => e.stopPropagation()}>
              <button className="ghost icon" title="Rename section" onClick={() => { const n = ask('Section name', sec.name); if (n) st().renameWatchSection(list.id, sec.id, n); }}>✎</button>
              <button className="ghost icon" title="Remove section" disabled={list.sections.length < 2} onClick={() => st().removeWatchSection(list.id, sec.id)}>✕</button>
            </span>
          </div>
          {!sec.collapsed && sec.items.map((it, ii) => {
            const q = quote(it);
            const active = it.providerId === providerId && it.symbol === symbol;
            return (
              <div
                key={`${it.providerId}:${it.symbol}`}
                ref={rowRef(quoteKey(it.providerId, it.symbol))}
                className={`wl-row${active ? ' active' : ''}`}
                title={`${it.note || it.label} (${it.providerId})`}
                draggable
                onDragStart={(e) => { e.stopPropagation(); drag.current = { kind: 'item', key: it }; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag.current?.kind === 'item') dropItem(sec.id, ii); else dropSection(si); }}
                onClick={() => chartStore.getState().openWatchItem(it.providerId, it.symbol)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: it, sectionId: sec.id }); }}
              >
                <span className="wl-id">
                  <span className="wl-sym">{it.symbol}</span>
                  {it.tags.map((id) => {
                    const t = tagOf(id);
                    return t ? <span key={id} className="wl-tag" style={{ background: t.color }} title={t.name} /> : null;
                  })}
                </span>
                <span className="wl-quote">{q ? fmtNum(q.last) : '-'}</span>
                <span className={`wl-change${q ? (q.chg >= 0 ? ' pos' : ' neg') : ''}`}>
                  {q ? `${q.chg >= 0 ? '+' : ''}${fmtNum(q.chg)}` : '-'}
                </span>
                <span className={`wl-change${q ? (q.chgPct >= 0 ? ' pos' : ' neg') : ''}`}>
                  {q ? `${q.chgPct >= 0 ? '+' : ''}${q.chgPct.toFixed(2)}%` : '-'}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      {menu && (
        <div className="wl-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setEditing(menu.item); setMenu(null); }}>Edit tags / note</button>
          {list.sections.filter((s) => s.id !== menu.sectionId).map((s) => (
            <button key={s.id} onClick={() => { st().moveWatchItem(list.id, menu.item.providerId, menu.item.symbol, s.id, s.items.length); setMenu(null); }}>
              Move to {s.name || 'Symbols'}
            </button>
          ))}
          <button onClick={() => { st().removeWatchItem(list.id, menu.item.providerId, menu.item.symbol); setMenu(null); }}>Remove</button>
        </div>
      )}
      {editing && editedItem && (
        <div className="wl-pop">
          <div className="sidebar-title"><span>{editedItem.symbol}</span><button className="ghost icon" onClick={() => setEditing(null)}>✕</button></div>
          <textarea
            placeholder="Note"
            defaultValue={editedItem.note}
            onBlur={(e) => st().setWatchNote(list.id, editedItem.providerId, editedItem.symbol, e.target.value)}
          />
          <div className="chip-list">
            {wls.tags.map((t) => {
              const on = editedItem.tags.includes(t.id);
              return (
                <button
                  key={t.id}
                  className={`chip${on ? ' active' : ''}`}
                  style={{ borderColor: t.color }}
                  onClick={() => st().setWatchItemTags(list.id, editedItem.providerId, editedItem.symbol, on ? editedItem.tags.filter((x) => x !== t.id) : [...editedItem.tags, t.id])}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
          <div className="form-row mt-2">
            <input value={newTag} placeholder="New tag" onChange={(e) => setNewTag(e.target.value)} />
            <button
              className="ghost"
              disabled={!newTag.trim()}
              onClick={() => { st().createWatchTag(newTag.trim(), TAG_COLORS[wls.tags.length % TAG_COLORS.length]); setNewTag(''); }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
