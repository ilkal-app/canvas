import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { newFakeRecord } from './__fixtures__/fake-asset-records.js';
import { isNews, isSettledRecord } from './record-news.js';

const PROCESSING = newFakeRecord('a'.repeat(64) as AssetId, new Uint8Array(3), 'processing');

describe('isNews and isSettledRecord', () => {
  it('call a first record, a new status, progress or level news, and the same record not', () => {
    expect(isNews(undefined, PROCESSING)).toBe(true);
    expect(isNews(PROCESSING, { ...PROCESSING })).toBe(false);
    expect(isNews(PROCESSING, { ...PROCESSING, status: 'ready' })).toBe(true);
    expect(isNews(PROCESSING, { ...PROCESSING, progress: 0.5 })).toBe(true);
    const leveled = { ...PROCESSING, levels: [{ longEdgePx: 128, format: 'webp' as const }] };
    expect(isNews(PROCESSING, leveled)).toBe(true);
  });

  it('settle a ready or failed record only', () => {
    expect(isSettledRecord(PROCESSING)).toBe(false);
    expect(isSettledRecord({ ...PROCESSING, status: 'ready' })).toBe(true);
    expect(isSettledRecord({ ...PROCESSING, status: 'failed' })).toBe(true);
  });
});
