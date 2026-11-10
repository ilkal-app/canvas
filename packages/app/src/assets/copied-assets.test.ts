import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import {
  COPIED_ASSET_MAX_AGE_MS,
  COPIED_ASSETS_STORAGE_KEY,
  CopiedAssets,
  MAX_ASSETS_PER_COPY,
  MAX_BOARD_ID_LENGTH,
  MAX_COPIED_ASSETS,
  MAX_STORED_CHARACTERS,
  MAX_STORED_ENTRIES,
  type CopiedAssetsStorage,
} from './copied-assets.js';

const A = 'a'.repeat(64) as AssetId;
const B = 'b'.repeat(64) as AssetId;

/**
 * A run of distinct asset ids.
 *
 * @param count - How many.
 * @param from - The number of the first.
 * @returns The ids.
 */
function assetRun(count: number, from = 0): AssetId[] {
  const ids: AssetId[] = [];
  for (let index = 0; index < count; index += 1) ids.push(assetNumber(from + index));
  return ids;
}

/**
 * The nth distinct asset id.
 *
 * @param index - Which.
 * @returns The id.
 */
function assetNumber(index: number): AssetId {
  return index.toString(16).padStart(64, '0') as AssetId;
}

/**
 * A storage over a map, shared by whichever records are given it (two tabs of one browser).
 *
 * @returns The storage and the map behind it.
 */
function memoryStorage(): { storage: CopiedAssetsStorage; items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    storage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
    },
  };
}

/**
 * A record over a storage and a clock the test moves.
 *
 * @param storage - The storage, or undefined for none.
 * @param clock - The clock, ms.
 * @param clock.now - The time now.
 * @returns The record.
 */
function recordOver(storage: CopiedAssetsStorage | undefined, clock: { now: number }) {
  return new CopiedAssets({ storage: () => storage, now: () => clock.now });
}

describe('CopiedAssets', () => {
  it('trusts a pair that was copied, and only that pair', () => {
    const { storage } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    record.record([A], 'board-a');
    expect(record.wasCopiedFrom([A], 'board-a')).toBe(true);
    expect(record.wasCopiedFrom([A], 'board-b')).toBe(false);
    expect(record.wasCopiedFrom([B], 'board-a')).toBe(false);
    expect(record.wasCopiedFrom([A, B], 'board-a')).toBe(false);
  });

  it('trusts every asset of a copy from one board, and the same asset from two boards', () => {
    const { storage } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    record.record([A, B], 'board-a');
    record.record([A], 'board-b');
    expect(record.wasCopiedFrom([A, B], 'board-a')).toBe(true);
    expect(record.wasCopiedFrom([A], 'board-b')).toBe(true);
    expect(record.wasCopiedFrom([B], 'board-b')).toBe(false);
  });

  it('is shared by two records over the same storage, as two tabs of one browser', () => {
    const { storage } = memoryStorage();
    const clock = { now: 1_000 };
    const first = recordOver(storage, clock);
    const second = recordOver(storage, clock);
    first.record([A], 'board-a');
    expect(second.wasCopiedFrom([A], 'board-a')).toBe(true);
    second.record([B], 'board-b');
    expect(first.wasCopiedFrom([A], 'board-a')).toBe(true);
    expect(first.wasCopiedFrom([B], 'board-b')).toBe(true);
  });

  it('does not trust a pair after its age, and a new copy renews it', () => {
    const { storage } = memoryStorage();
    const clock = { now: 1_000 };
    const record = recordOver(storage, clock);
    record.record([A], 'board-a');
    clock.now = 1_000 + COPIED_ASSET_MAX_AGE_MS;
    expect(record.wasCopiedFrom([A], 'board-a')).toBe(true);
    clock.now += 1;
    expect(record.wasCopiedFrom([A], 'board-a')).toBe(false);
    record.record([A], 'board-a');
    expect(record.wasCopiedFrom([A], 'board-a')).toBe(true);
  });

  it('drops expired pairs from the stored record when it writes', () => {
    const { storage, items } = memoryStorage();
    const clock = { now: 1_000 };
    const record = recordOver(storage, clock);
    record.record([A], 'board-a');
    clock.now += COPIED_ASSET_MAX_AGE_MS + 1;
    record.record([B], 'board-b');
    const stored = JSON.parse(items.get(COPIED_ASSETS_STORAGE_KEY) ?? 'null') as unknown[];
    expect(stored).toHaveLength(1);
  });

  it('keeps at most the bound in all, evicting the oldest copies first', () => {
    const { storage, items } = memoryStorage();
    const clock = { now: 1_000 };
    const record = recordOver(storage, clock);
    for (let index = 0; index < MAX_COPIED_ASSETS + 5; index += 1) {
      clock.now += 1;
      record.record([assetNumber(index)], 'board-a');
    }
    const stored = JSON.parse(items.get(COPIED_ASSETS_STORAGE_KEY) ?? 'null') as unknown[];
    expect(stored).toHaveLength(MAX_COPIED_ASSETS);
    expect(record.wasCopiedFrom([assetNumber(0)], 'board-a')).toBe(false);
    expect(record.wasCopiedFrom([assetNumber(4)], 'board-a')).toBe(false);
    expect(record.wasCopiedFrom([assetNumber(5)], 'board-a')).toBe(true);
    expect(record.wasCopiedFrom([assetNumber(MAX_COPIED_ASSETS + 4)], 'board-a')).toBe(true);
  });

  it('keeps every image of the copy just made, however many, and evicts older pairs for room', () => {
    const { storage, items } = memoryStorage();
    const clock = { now: 1_000 };
    const record = recordOver(storage, clock);
    record.record([A, B], 'board-old');
    const many = assetRun(MAX_COPIED_ASSETS - 1);
    clock.now += 1;
    record.record(many, 'board-a');
    // Room for the copy's 1,999 pairs and one older: the newest older pair stays.
    expect(record.wasCopiedFrom(many, 'board-a')).toBe(true);
    expect(record.wasCopiedFrom([A], 'board-old')).toBe(false);
    expect(record.wasCopiedFrom([B], 'board-old')).toBe(true);
    expect(JSON.parse(items.get(COPIED_ASSETS_STORAGE_KEY) ?? 'null')).toHaveLength(
      MAX_COPIED_ASSETS,
    );
    const first = assetRun(300, 10_000);
    clock.now += 1;
    record.record(first, 'board-b');
    expect(record.wasCopiedFrom(first, 'board-b')).toBe(true);
    expect(record.wasCopiedFrom(many.slice(-(MAX_COPIED_ASSETS - 300)), 'board-a')).toBe(true);
    expect(record.wasCopiedFrom(many.slice(0, 300), 'board-a')).toBe(false);
  });

  it('lets a copy of the most it takes push out every other pair, whole', () => {
    const { storage } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    record.record([A], 'board-old');
    const all = assetRun(MAX_ASSETS_PER_COPY);
    record.record(all, 'board-a');
    expect(record.wasCopiedFrom(all, 'board-a')).toBe(true);
    expect(record.wasCopiedFrom([A], 'board-old')).toBe(false);
  });

  it('records none of a copy of more images than one copy may hold, and leaves the others', () => {
    const { storage, items } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    record.record([A], 'board-old');
    const before = items.get(COPIED_ASSETS_STORAGE_KEY);
    const tooMany = assetRun(MAX_ASSETS_PER_COPY + 1);
    record.record(tooMany, 'board-a');
    expect(items.get(COPIED_ASSETS_STORAGE_KEY)).toBe(before);
    expect(record.wasCopiedFrom([tooMany[0] ?? A], 'board-a')).toBe(false);
    expect(record.wasCopiedFrom([A], 'board-old')).toBe(true);
  });

  it('counts the distinct images of a copy, not its list', () => {
    const { storage } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    record.record(
      Array.from({ length: MAX_ASSETS_PER_COPY + 5 }, () => A),
      'board-a',
    );
    expect(record.wasCopiedFrom([A], 'board-a')).toBe(true);
  });

  it('ignores stored content over the size or entry limit, and recovers on the next copy', () => {
    const entry = { assetId: A, boardId: 'board-a', copiedAt: 1_000 };
    const overEntries = JSON.stringify(Array.from({ length: MAX_STORED_ENTRIES + 1 }, () => entry));
    const atEntries = JSON.stringify(Array.from({ length: MAX_STORED_ENTRIES }, () => entry));
    const overSize = JSON.stringify([
      entry,
      { ...entry, boardId: 'x'.repeat(MAX_STORED_CHARACTERS) },
    ]);
    expect(atEntries.length).toBeLessThan(MAX_STORED_CHARACTERS);
    for (const [content, isTrusted] of [
      [overEntries, false],
      [overSize, false],
      [atEntries, true],
    ] as const) {
      const { storage, items } = memoryStorage();
      items.set(COPIED_ASSETS_STORAGE_KEY, content);
      const record = recordOver(storage, { now: 2_000 });
      expect(record.wasCopiedFrom([A], 'board-a')).toBe(isTrusted);
      record.record([B], 'board-b');
      expect(record.wasCopiedFrom([B], 'board-b')).toBe(true);
    }
  });

  it('counts a copy of a pair again as the newest, not as a second entry', () => {
    const { storage, items } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    record.record([A], 'board-a');
    record.record([A], 'board-a');
    expect(JSON.parse(items.get(COPIED_ASSETS_STORAGE_KEY) ?? 'null')).toHaveLength(1);
  });

  it('ignores stored content it cannot read, without throwing, and recovers on the next copy', () => {
    const contents = [
      'not json',
      '{"assetId":"x"}',
      '42',
      'null',
      '[1,"x",null]',
      '[{"assetId":1,"boardId":"b","copiedAt":1000}]',
      `[{"assetId":"${A}","boardId":"","copiedAt":1000}]`,
      `[{"assetId":"${A}","boardId":"board-a","copiedAt":"soon"}]`,
      `[{"assetId":"${A}","boardId":"board-a"}]`,
      `[{"assetId":"${A}","boardId":"board-a","copiedAt":null}]`,
      // Written in the future, as a clock set back would leave it.
      `[{"assetId":"${A}","boardId":"board-a","copiedAt":${String(1_000 + 3_600_000)}}]`,
    ];
    for (const content of contents) {
      const { storage, items } = memoryStorage();
      items.set(COPIED_ASSETS_STORAGE_KEY, content);
      const record = recordOver(storage, { now: 1_000 });
      expect(record.wasCopiedFrom([A], 'board-a')).toBe(false);
      record.record([B], 'board-b');
      expect(record.wasCopiedFrom([B], 'board-b')).toBe(true);
      expect(record.wasCopiedFrom([A], 'board-a')).toBe(false);
    }
  });

  it('keeps the readable entries beside unreadable ones', () => {
    const { storage, items } = memoryStorage();
    items.set(
      COPIED_ASSETS_STORAGE_KEY,
      JSON.stringify([7, { assetId: A, boardId: 'board-a', copiedAt: 1_000 }]),
    );
    expect(recordOver(storage, { now: 2_000 }).wasCopiedFrom([A], 'board-a')).toBe(true);
  });

  it('trusts nothing and does not throw when there is no storage or it throws', () => {
    const none = recordOver(undefined, { now: 1_000 });
    none.record([A], 'board-a');
    expect(none.wasCopiedFrom([A], 'board-a')).toBe(false);
    const broken: CopiedAssetsStorage = {
      getItem: () => {
        throw new Error('storage is disabled');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const refusing = recordOver(broken, { now: 1_000 });
    expect(() => {
      refusing.record([A], 'board-a');
    }).not.toThrow();
    expect(refusing.wasCopiedFrom([A], 'board-a')).toBe(false);
    const throwsOnAccess = new CopiedAssets({
      storage: () => {
        throw new Error('no storage');
      },
    });
    expect(() => {
      throwsOnAccess.record([A], 'board-a');
    }).not.toThrow();
    expect(throwsOnAccess.wasCopiedFrom([A], 'board-a')).toBe(false);
  });

  it('records nothing for a copy without assets', () => {
    const { storage, items } = memoryStorage();
    recordOver(storage, { now: 1_000 }).record([], 'board-a');
    expect(items.size).toBe(0);
  });

  it('holds only asset ids, boards and times: no token, bytes or URL', () => {
    const { storage, items } = memoryStorage();
    recordOver(storage, { now: 1_000 }).record([A], 'board-a');
    const [entry] = JSON.parse(items.get(COPIED_ASSETS_STORAGE_KEY) ?? 'null') as object[];
    expect(Object.keys(entry ?? {}).sort()).toEqual(['assetId', 'boardId', 'copiedAt']);
  });

  it('records no copy from a board whose id is longer than the limit', () => {
    const { storage, items } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    const long = 'b'.repeat(MAX_BOARD_ID_LENGTH + 1);
    record.record([A], long);
    expect(items.size).toBe(0);
    expect(record.wasCopiedFrom([A], long)).toBe(false);
    const atLimit = 'b'.repeat(MAX_BOARD_ID_LENGTH);
    record.record([A], atLimit);
    expect(record.wasCopiedFrom([A], atLimit)).toBe(true);
  });

  it('never writes more than its own read limit: a full copy on the longest board id fits', () => {
    const { storage, items } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    const atLimit = 'b'.repeat(MAX_BOARD_ID_LENGTH);
    record.record(assetRun(MAX_ASSETS_PER_COPY), atLimit);
    expect((items.get(COPIED_ASSETS_STORAGE_KEY) ?? '').length).toBeLessThanOrEqual(
      MAX_STORED_CHARACTERS,
    );
    expect(record.wasCopiedFrom(assetRun(MAX_ASSETS_PER_COPY), atLimit)).toBe(true);
  });

  it('checks the serialized size before writing, dropping older pairs, or writing nothing', () => {
    const { storage, items } = memoryStorage();
    const record = recordOver(storage, { now: 1_000 });
    const huge = (letter: string) => letter.repeat(600_000) as AssetId;
    record.record([huge('a')], 'board-a');
    // Together they would pass the limit: the older pair goes, the new copy stays whole.
    record.record([huge('b')], 'board-a');
    expect((items.get(COPIED_ASSETS_STORAGE_KEY) ?? '').length).toBeLessThanOrEqual(
      MAX_STORED_CHARACTERS,
    );
    expect(record.wasCopiedFrom([huge('b')], 'board-a')).toBe(true);
    expect(record.wasCopiedFrom([huge('a')], 'board-a')).toBe(false);
    // A copy that is over the limit alone is not written, and the record is left as it was.
    const before = items.get(COPIED_ASSETS_STORAGE_KEY);
    record.record([huge('c'), huge('d')], 'board-a');
    expect(items.get(COPIED_ASSETS_STORAGE_KEY)).toBe(before);
  });
});
