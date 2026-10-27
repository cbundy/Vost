import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from '../../../../shared/providerCatalog.ts';
import { providers } from './index';

describe('provider live contract', () => {
  it('supportsLive matches startLive for every provider, and the catalog', () => {
    for (const p of providers) {
      expect(Boolean(p.supportsLive), p.id).toBe(typeof p.startLive === 'function');
    }
    for (const info of PROVIDER_CATALOG) {
      expect(typeof providers.find((p) => p.id === info.id)?.startLive === 'function', info.id).toBe(info.supportsLive);
    }
  });
});

