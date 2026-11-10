import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import {
  CopiedAssets,
  COPIED_ASSET_MAX_AGE_MS,
  type CopiedAssetsStorage,
} from './copied-assets.js';
import { CopyLedger, MAX_TAB_COPIED_ASSETS } from './copy-ledger.js';

/**
 * A run of distinct asset ids.
 *
 * @param count - How many.
 * @param from - The number of the first.
 * @returns The ids.
 */
function assetRun(count: number, from = 0): AssetId[] {
  const ids: AssetId[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push((from + index).toString(16).padStart(64, '0') as AssetId);
  }
  return ids;
}

const FIRST = assetRun(1)[0] ?? ('' as AssetId);

/** A storage that refuses everything, as with storage disabled. */
const BROKEN_STORAGE: CopiedAssetsStorage = {
  getItem: () => {
    throw new Error('storage is disabled');
  },
  setItem: () => {
    throw new Error('quota exceeded');
  },
};

/**
 * A ledger over a stored record and a clock the test moves.
 *
 * @param storage - The stored record's storage, or undefined for a working one of its own.
 * @param clock - The clock, ms.
 * @param clock.now - The time now.
 * @returns The ledger.
 */
function ledgerOver(storage: CopiedAssetsStorage | undefined, clock: { now: number }) {
  const items = new Map<string, string>();
  const working: CopiedAssetsStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  const stored = new CopiedAssets({ storage: () => storage ?? working, now: () => clock.now });
  return { ledger: new CopyLedger(stored), stored };
}

describe('CopyLedger', () => {
  it('trusts a pair this tab copied even when the storage throws', () => {
    const { ledger } = ledgerOver(BROKEN_STORAGE, { now: 1_000 });
    ledger.record(assetRun(3), 'board-a');
    expect(ledger.wasCopiedFrom(assetRun(3), 'board-a')).toBe(true);
    expect(ledger.wasCopiedFrom(assetRun(4), 'board-a')).toBe(false);
  });

  it('trusts a pair of the stored record that this tab did not copy, as another tab’s copy', () => {
    const items = new Map<string, string>();
    const storage: CopiedAssetsStorage = {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
    };
    const clock = { now: 1_000 };
    const other = new CopiedAssets({ storage: () => storage, now: () => clock.now });
    const ledger = new CopyLedger(
      new CopiedAssets({ storage: () => storage, now: () => clock.now }),
    );
    other.record(assetRun(2), 'board-a');
    ledger.record(assetRun(1, 10), 'board-a');
    expect(ledger.wasCopiedFrom([...assetRun(2), ...assetRun(1, 10)], 'board-a')).toBe(true);
  });

  it('trusts a pair only for the board it was copied from', () => {
    const { ledger } = ledgerOver(BROKEN_STORAGE, { now: 1_000 });
    ledger.record(assetRun(2), 'board-a');
    expect(ledger.wasCopiedFrom(assetRun(1), 'board-b')).toBe(false);
    expect(ledger.wasCopiedFrom(assetRun(1), '')).toBe(false);
  });

  it('keeps a copy for the life of the tab, past the stored record’s age limit', () => {
    const clock = { now: 1_000 };
    const { ledger, stored } = ledgerOver(undefined, clock);
    ledger.record(assetRun(2), 'board-a');
    clock.now += COPIED_ASSET_MAX_AGE_MS + 1;
    expect(stored.wasCopiedFrom(assetRun(2), 'board-a')).toBe(false);
    expect(ledger.wasCopiedFrom(assetRun(2), 'board-a')).toBe(true);
  });

  it('keeps a copy of more images than the stored record takes, whole', () => {
    const { ledger, stored } = ledgerOver(undefined, { now: 1_000 });
    const many = assetRun(2_500);
    ledger.record(many, 'board-a');
    expect(stored.wasCopiedFrom(many.slice(0, 1), 'board-a')).toBe(false);
    expect(ledger.wasCopiedFrom(many, 'board-a')).toBe(true);
  });

  it('holds up to the tab’s bound and then forgets the oldest copy, whole', () => {
    const { ledger } = ledgerOver(BROKEN_STORAGE, { now: 1_000 });
    const first = assetRun(10_000);
    const second = assetRun(10_000, 10_000);
    const third = assetRun(5_000, 20_000);
    ledger.record(first, 'board-a');
    ledger.record(second, 'board-a');
    expect(MAX_TAB_COPIED_ASSETS).toBe(20_000);
    expect(ledger.wasCopiedFrom(first, 'board-a')).toBe(true);
    ledger.record(third, 'board-a');
    expect(ledger.wasCopiedFrom(first.slice(0, 1), 'board-a')).toBe(false);
    expect(ledger.wasCopiedFrom(first.slice(-1), 'board-a')).toBe(false);
    expect(ledger.wasCopiedFrom(second, 'board-a')).toBe(true);
    expect(ledger.wasCopiedFrom(third, 'board-a')).toBe(true);
  });

  it('holds none of a copy of more than the tab’s bound', () => {
    const { ledger } = ledgerOver(BROKEN_STORAGE, { now: 1_000 });
    ledger.record(assetRun(MAX_TAB_COPIED_ASSETS + 1), 'board-a');
    expect(ledger.wasCopiedFrom(assetRun(1), 'board-a')).toBe(false);
  });

  it('does not trust the empty list differently from the stored record’s vacuous truth', () => {
    const { ledger } = ledgerOver(BROKEN_STORAGE, { now: 1_000 });
    expect(ledger.wasCopiedFrom([], 'board-a')).toBe(true);
    ledger.record([], 'board-a');
    expect(ledger.wasCopiedFrom([FIRST], 'board-a')).toBe(false);
  });
});
