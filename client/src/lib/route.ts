/** True for the Pine compare page: `/compare` and `/compare/` only (exact, case-sensitive). */
export function isComparePath(pathname: string): boolean {
  return pathname === '/compare' || pathname === '/compare/';
}
