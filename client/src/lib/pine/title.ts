/** The title in the first indicator(...) or strategy(...) declaration, trimmed, or '' when there is none. */
export function pineSourceTitle(source: string): string {
  const m = /^\s*(?:indicator|strategy)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/m.exec(source);
  return m ? m[2].trim() : '';
}

/** A Pine script's display name: its source title, else the last run's title, else the generic kind name. */
export function pineIndicatorName(source: string, runTitle?: string): string {
  return pineSourceTitle(source) || runTitle?.trim() || 'Pine indicator';
}
