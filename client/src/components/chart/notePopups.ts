/**
 * Which note popups are open besides the selected one's: the hovered drawing (its popup shows while the pointer is
 * on it) and the pinned ones (a click or tap toggles). Pinned state belongs to the session: it is neither saved nor undone.
 */
export class NotePopups {
  hovered: string | null = null;
  private pinnedIds = new Set<string>();

  get pinned(): ReadonlySet<string> {
    return this.pinnedIds;
  }

  /** Sets the hovered drawing; true when it changed. */
  hover(id: string | null): boolean {
    if (this.hovered === id) return false;
    this.hovered = id;
    return true;
  }

  /** Pins an unpinned drawing's popup open, or unpins it. */
  toggle(id: string): void {
    if (!this.pinnedIds.delete(id)) this.pinnedIds.add(id);
  }

  /** Forgets drawings that are gone; true when something changed. */
  prune(existing: readonly { id: string }[]): boolean {
    const ids = new Set(existing.map((d) => d.id));
    let changed = false;
    for (const id of [...this.pinnedIds]) if (!ids.has(id)) changed = this.pinnedIds.delete(id) || changed;
    if (this.hovered && !ids.has(this.hovered)) {
      this.hovered = null;
      changed = true;
    }
    return changed;
  }

  clear(): void {
    this.hovered = null;
    this.pinnedIds = new Set();
  }
}
