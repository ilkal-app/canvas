import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FontLibrary } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';
import { FONT_FAMILIES } from './font-catalogue.js';
import {
  isLocalFamily,
  localFontPermission,
  requestLocalFonts,
  restoreLocalFonts,
  supportsLocalFonts,
} from './local-fonts.js';
import { loadPageFonts, pageFontLoader } from './page-fonts.js';

vi.mock('./page-fonts.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadPageFonts: vi.fn(),
  pageFontLoader: vi.fn(),
}));

const FONT_BYTES = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);

beforeEach(() => {
  vi.mocked(loadPageFonts).mockReset();
  vi.mocked(pageFontLoader).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function stubPermission(state: PermissionState): ReturnType<typeof vi.fn> {
  const query = vi.fn().mockResolvedValue({ state });
  vi.stubGlobal('navigator', { permissions: { query } });
  return query;
}

function stubFaces() {
  const blob = vi.fn(() => Promise.resolve(new Blob([FONT_BYTES])));
  const unsupportedBlob = vi.fn(() => Promise.resolve(new Blob([new Uint8Array([0, 1, 2, 3])])));
  const query = vi.fn(() =>
    Promise.resolve([
      { family: 'Second Private', style: 'Regular', blob },
      { family: 'Unsupported Private', style: 'Regular', blob: unsupportedBlob },
      { family: 'First Private', style: 'Regular', blob },
      { family: 'Not Requested', style: 'Regular', blob },
    ]),
  );
  vi.stubGlobal('queryLocalFonts', query);
  return { query, blob, unsupportedBlob };
}

describe('localFontPermission', () => {
  it('reports unsupported without querying permission or enumerating fonts', async () => {
    const query = stubPermission('granted');
    vi.stubGlobal('queryLocalFonts', undefined);
    expect(supportsLocalFonts()).toBe(false);
    expect(await localFontPermission()).toBe('unsupported');
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['granted', 'denied', 'prompt'] as const)(
    'returns %s without enumerating',
    async (state) => {
      const query = stubPermission(state);
      const fonts = stubFaces();
      expect(await localFontPermission()).toBe(state);
      expect(query).toHaveBeenCalledWith({ name: 'local-fonts' });
      expect(fonts.query).not.toHaveBeenCalled();
    },
  );

  it('returns prompt when permissions are absent or the query rejects', async () => {
    const fonts = stubFaces();
    vi.stubGlobal('navigator', {});
    expect(await localFontPermission()).toBe('prompt');
    const query = vi.fn().mockRejectedValue(new Error('Permission API unavailable'));
    vi.stubGlobal('navigator', { permissions: { query } });
    expect(await localFontPermission()).toBe('prompt');
    expect(fonts.query).not.toHaveBeenCalled();
    query.mockImplementation(() => {
      throw new Error('Permission API unavailable');
    });
    expect(await localFontPermission()).toBe('prompt');
  });
});

it('isLocalFamily reads false before a page loader exists without creating one', () => {
  expect(isLocalFamily('Private Mono')).toBe(false);
  expect(loadPageFonts).not.toHaveBeenCalled();
  expect(pageFontLoader).not.toHaveBeenCalled();
});

describe('restoreLocalFonts', () => {
  it('does not enumerate in an unsupported browser', async () => {
    vi.stubGlobal('queryLocalFonts', undefined);
    expect(await restoreLocalFonts(['First Private'])).toEqual([]);
  });

  it.each(['denied', 'prompt'] as const)(
    'does not enumerate when permission is %s',
    async (state) => {
      stubPermission(state);
      const { query } = stubFaces();
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      expect(await restoreLocalFonts(['First Private'])).toEqual([]);
      expect(query).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('installs only requested supported families in requested order, using no fetch', async () => {
    stubPermission('granted');
    const { query, blob, unsupportedBlob } = stubFaces();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const fonts = new FontLibrary();
    const demand = new DemandFonts(fonts, FONT_FAMILIES);
    demand.register([{ family: 'Catalogue Only', category: 'sans', faces: [] }]);
    vi.mocked(loadPageFonts).mockReturnValue({ fonts, loaded: Promise.resolve() });
    vi.mocked(pageFontLoader).mockReturnValue(demand);

    expect(demand.isLocal('First Private')).toBe(false);
    expect(demand.isLocal('Liberation Sans')).toBe(false);
    expect(demand.isLocal('Catalogue Only')).toBe(false);
    expect(isLocalFamily('First Private')).toBe(false);
    expect(
      await restoreLocalFonts([
        'First Private',
        'Absent Private',
        'Unsupported Private',
        'Second Private',
      ]),
    ).toEqual(['First Private', 'Second Private']);
    expect(query).toHaveBeenCalledOnce();
    expect(blob).toHaveBeenCalledTimes(2);
    expect(unsupportedBlob).toHaveBeenCalledOnce();
    expect(demand.status('First Private')).toBe('ready');
    expect(demand.status('Second Private')).toBe('ready');
    expect(demand.isLocal('First Private')).toBe(true);
    expect(isLocalFamily('First Private')).toBe(true);
    expect(demand.isLocal('Absent Private')).toBe(false);
    expect(demand.isLocal('Unsupported Private')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares the source with an earlier explicit enumeration', async () => {
    stubPermission('granted');
    const { query } = stubFaces();
    const fonts = new FontLibrary();
    const demand = new DemandFonts(fonts, []);
    vi.mocked(loadPageFonts).mockReturnValue({ fonts, loaded: Promise.resolve() });
    vi.mocked(pageFontLoader).mockReturnValue(demand);
    expect(await requestLocalFonts()).toContain('First Private');
    expect(await restoreLocalFonts(['First Private'])).toEqual(['First Private']);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
