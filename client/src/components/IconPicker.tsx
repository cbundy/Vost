import { useEffect, useMemo, useRef, useState } from 'react';
import { gridStep } from '../lib/iconSets/gridNav';
import { svgDataUrl } from '../lib/iconSets/glyphImages';
import { categoriesOf, loadSet, searchGlyphs, type GlyphEntry, type GlyphKind } from '../lib/iconSets';
import { useStore } from '../state/store';
import { Modal } from './Modal';

const TITLES: Record<GlyphKind, string> = { icon: 'Icons', emoji: 'Emojis', sticker: 'Stickers' };
const ALL = 'All';

/** One entry drawn small: an icon as strokes in the current text colour, an emoji or sticker as its full-colour art. */
function Preview({ kind, entry }: { kind: GlyphKind; entry: GlyphEntry }) {
  if (kind === 'icon') {
    return (
      <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {entry.data.split('|').map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    );
  }
  return <img src={svgDataUrl(entry.data)} width={30} height={30} alt="" draggable={false} />;
}

/**
 * The picker for the Icons, Emojis and Stickers tools: a search box (focused on open), category tabs, a row of the
 * last picks and the grid. Arrow keys move through the grid, Enter picks, Escape closes. The set is loaded the first
 * time the picker opens (its own chunk).
 */
export function IconPicker({ kind, onPick, onClose }: { kind: GlyphKind; onPick: (id: string) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<readonly GlyphEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const recentIds = useStore((s) => s.glyphRecent[kind]);

  useEffect(() => {
    let live = true;
    loadSet(kind).then(
      (e) => live && setEntries(e),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [kind]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const categories = useMemo(() => (entries ? categoriesOf(entries) : []), [entries]);
  const found = useMemo(() => (entries ? searchGlyphs(entries, query, category === ALL ? undefined : category) : []), [entries, query, category]);
  const recent = useMemo(() => {
    if (!entries || query.trim()) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    return (recentIds ?? []).flatMap((id) => byId.get(id) ?? []);
  }, [entries, recentIds, query]);

  const buttons = () => Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('button[data-glyph]') ?? []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) {
      // From the search box, Down enters the grid.
      if (e.key === 'ArrowDown' && list.length > 0 && document.activeElement === searchRef.current) {
        e.preventDefault();
        list[0].focus();
      }
      return;
    }
    const boxes = list.map((b) => ({ x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight }));
    const next = gridStep(boxes, at, e.key);
    if (next !== null) {
      e.preventDefault();
      list[next].focus();
      list[next].scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'ArrowUp' && at === 0) {
      e.preventDefault();
      searchRef.current?.focus();
    }
  };

  const cell = (e: GlyphEntry, prefix: string) => (
    <button key={`${prefix}${e.id}`} type="button" className="glyph-cell" data-glyph={e.id} title={e.name} aria-label={e.name} onClick={() => onPick(e.id)}>
      <Preview kind={kind} entry={e} />
    </button>
  );

  return (
    <Modal title={TITLES[kind]} onClose={onClose} width={440}>
      <div className="glyph-picker" ref={rootRef} onKeyDown={onKeyDown} data-kind={kind}>
        <input
          ref={searchRef}
          className="glyph-search"
          type="text"
          placeholder={`Search ${TITLES[kind].toLowerCase()}`}
          aria-label={`Search ${TITLES[kind].toLowerCase()}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {failed && <div className="glyph-empty">Could not load {TITLES[kind].toLowerCase()}.</div>}
        {!failed && !entries && <div className="glyph-empty">Loading...</div>}
        {entries && (
          <>
            <div className="glyph-tabs" role="tablist" aria-label="Categories">
              {[ALL, ...categories].map((c) => (
                <button key={c} type="button" role="tab" aria-selected={category === c} className={`glyph-tab${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
                  {c}
                </button>
              ))}
            </div>
            {recent.length > 0 && (
              <>
                <div className="fly-heading">Recent</div>
                <div className="glyph-grid glyph-recent" aria-label="Recent">
                  {recent.map((e) => cell(e, 'r:'))}
                </div>
              </>
            )}
            <div className="glyph-grid" aria-label={`${TITLES[kind]} results`}>
              {found.map((e) => cell(e, ''))}
            </div>
            {found.length === 0 && <div className="glyph-empty">No match.</div>}
          </>
        )}
      </div>
    </Modal>
  );
}
