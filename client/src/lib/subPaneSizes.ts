/** Stretch factor of a new indicator sub pane; the price pane is 1, so one sub pane leaves it about three quarters. */
export const DEFAULT_SUB_FACTOR = 0.3;

/** Stretch factors the user's pane sizes came to, kept per indicator id across pane rebuilds. */
export type PaneFactors = Map<string, number>;

/** The kept factors after a rebuild is about to drop the panes in `current`; ids no longer in `liveIds` are dropped. */
export function recordFactors(
  kept: PaneFactors,
  current: ReadonlyArray<{ id: string; factor: number }>,
  liveIds: ReadonlySet<string>,
): PaneFactors {
  const next: PaneFactors = new Map();
  for (const [id, f] of kept) if (liveIds.has(id)) next.set(id, f);
  for (const { id, factor } of current) if (liveIds.has(id) && Number.isFinite(factor) && factor > 0) next.set(id, factor);
  return next;
}

/** The stretch factor of each sub pane in order: the kept one, else the default. */
export function paneFactors(kept: PaneFactors, ids: readonly string[]): number[] {
  return ids.map((id) => kept.get(id) ?? DEFAULT_SUB_FACTOR);
}
