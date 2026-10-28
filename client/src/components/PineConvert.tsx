import { useState } from 'react';
import { conversionSummary, convertToV6 } from '../lib/pine/convert';
import { detectPineVersion, legacyMessage } from '../lib/pine/version';

interface Props {
  source: string;
  error: { message: string; line?: number } | null | undefined;
  onChange: (code: string) => void;
  /** Show only the old-Pine notice (for editors that report other errors elsewhere). */
  legacyOnly?: boolean;
}

/**
 * The error line under a Pine editor. For an old (v1 to v4) script it explains
 * that and offers Convert to v6; afterwards it says what the conversion did
 * until the next edit.
 */
export function PineConvert({ source, error, onChange, legacyOnly = false }: Props) {
  const [done, setDone] = useState<{ code: string; text: string } | null>(null);
  const { version, legacy } = detectPineVersion(source);
  const isLegacy = legacy && source.trim() !== '';

  const convert = () => {
    const r = convertToV6(source);
    setDone({ code: r.code, text: conversionSummary(r.from, r.notes) });
    onChange(r.code);
  };

  return (
    <>
      {isLegacy ? (
        <div className="pine-error pine-legacy" role="alert">
          <span>{legacyMessage(version)}</span>
          <button className="primary" onClick={convert}>
            Convert to v6
          </button>
        </div>
      ) : (
        !legacyOnly &&
        error && (
          <div className="pine-error" role="alert">
            {error.line !== undefined ? `Line ${error.line}: ` : ''}
            {error.message}
          </div>
        )
      )}
      {done && done.code === source && (
        <div className="pine-convert-note" role="status">
          {done.text}
        </div>
      )}
    </>
  );
}
