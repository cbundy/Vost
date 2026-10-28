/**
 * Pine version detection. Uses the exact marker PineTS looks for, so Vost and
 * PineTS never disagree about what version a script is.
 */
export const VERSION_MARKER = /^\s*\/\/\s*@version\s*=\s*(\d+)\s*$/im;

export interface PineVersion {
  version: number | null;
  /** True when the script is not Pine v5 or v6: no marker, or a marker below 5. */
  legacy: boolean;
}

export function detectPineVersion(source: string): PineVersion {
  const m = VERSION_MARKER.exec(source);
  const version = m ? Number(m[1]) : null;
  return { version, legacy: version === null || version < 5 };
}

/** The plain-language explanation shown instead of a parser error. */
export function legacyMessage(version: number | null): string {
  if (version === null) {
    return (
      'This script has no //@version line, so Pine reads it as version 1. Vost runs Pine v5 and v6: ' +
      'use Convert to v6, or add //@version=6 at the top if it is already v6 code.'
    );
  }
  return `This is a Pine v${version} script. Vost runs Pine v5 and v6: use Convert to v6.`;
}
