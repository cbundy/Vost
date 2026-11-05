/** True for the Pine compare page: `/compare` and `/compare/` only (exact, case-sensitive). */
export function isComparePath(pathname: string): boolean {
  return pathname === '/compare' || pathname === '/compare/';
}

/** True for the strategy maker page: `/strategy-maker` and `/strategy-maker/` only (exact, case-sensitive). */
export function isStrategyMakerPath(pathname: string): boolean {
  return pathname === '/strategy-maker' || pathname === '/strategy-maker/';
}
