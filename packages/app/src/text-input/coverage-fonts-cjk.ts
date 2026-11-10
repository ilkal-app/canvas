import { cjkSliceFace } from '@canvas/text';

import { CJK_SLICE_TABLE } from './cjk-slice-table.js';
import { CJK_SLICE_URLS_HK } from './cjk-slice-urls-hk.js';
import { CJK_SLICE_URLS_JP } from './cjk-slice-urls-jp.js';
import { CJK_SLICE_URLS_KR } from './cjk-slice-urls-kr.js';
import { CJK_SLICE_URLS_SC } from './cjk-slice-urls-sc.js';
import { CJK_SLICE_URLS_TC } from './cjk-slice-urls-tc.js';
import type { FontFamilyEntry } from './font-catalogue.js';

/** Each face folder's slice file URLs, in `CJK_SLICE_TABLE` order. */
const URLS: ReadonlyMap<string, readonly string[]> = new Map([
  ['sc', CJK_SLICE_URLS_SC],
  ['tc', CJK_SLICE_URLS_TC],
  ['hk', CJK_SLICE_URLS_HK],
  ['jp', CJK_SLICE_URLS_JP],
  ['kr', CJK_SLICE_URLS_KR],
]);

/**
 * The CJK coverage families as their slices: each slice a named face
 * (`cjkSliceFace`) whose file the build writes under assets/fonts/cjk
 * (packages/app/scripts/build-cjk-slices.ts), loaded only when a text holds one of its
 * characters.
 */
export const CJK_SLICE_FONT_FAMILIES: readonly FontFamilyEntry[] = [
  ...new Set(CJK_SLICE_TABLE.map(([family]) => family)),
].map((family) => {
  const rows = CJK_SLICE_TABLE.filter(([listed]) => listed === family);
  const slices = rows.flatMap(([, folder, weight, ids]) =>
    ids.split(',').map((id) => ({ folder, weight, id })),
  );
  return {
    family,
    category: 'sans',
    faces: slices.map(({ folder, weight, id }, index) => ({
      ...cjkSliceFace({ family, weight, isItalic: false }, id),
      // A family's faces are in one folder, its URLs in the same order as its slices.
      url: URLS.get(folder)?.[index] ?? '',
    })),
  };
});
