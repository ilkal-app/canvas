import { describe, expect, it } from 'vitest';

import { ScannedPlacements } from './scanned-placements.js';
import { NO_CLIENT, type ScannedItem, type UpdateScan } from './update-scan.js';

/**
 * A scanned item with one client, of length 1.
 *
 * @param clock - Its clock.
 * @param neighbours - Its origin and right origin clocks (same client), when it has them.
 * @param neighbours.origin - The origin's clock.
 * @param neighbours.rightOrigin - The right origin's clock.
 * @returns The item: with no neighbour, the first entry of `objects` under `key`.
 */
function item(
  clock: number,
  neighbours: { origin?: number; rightOrigin?: number } = {},
): ScannedItem {
  const { origin, rightOrigin } = neighbours;
  const isRoot = origin === undefined && rightOrigin === undefined;
  return {
    client: 1,
    clock,
    length: 1,
    content: 'any',
    originClient: origin === undefined ? NO_CLIENT : 1,
    originClock: origin ?? 0,
    rightOriginClient: rightOrigin === undefined ? NO_CLIENT : 1,
    rightOriginClock: rightOrigin ?? 0,
    parentName: isRoot ? 'objects' : undefined,
    parentClient: NO_CLIENT,
    parentClock: 0,
    parentSub: isRoot ? 'key' : undefined,
    detail: 0,
  };
}

/**
 * A scan of one client's items.
 *
 * @param items - The items, ascending by clock.
 * @returns The scan.
 */
function scanOf(items: ScannedItem[]): UpdateScan {
  return { items: new Map([[1, items]]), deleted: new Map() };
}

/**
 * A chain of `count` items, each replacing the one before, the first carrying its key.
 *
 * @param count - How many items.
 * @returns The items.
 */
function chain(count: number): ScannedItem[] {
  const items: ScannedItem[] = [];
  for (let clock = 0; clock < count; clock += 1) {
    items.push(item(clock, clock === 0 ? {} : { origin: clock - 1 }));
  }
  return items;
}

describe('ScannedPlacements', () => {
  it('ends every item of a chain on the item that carries its key', () => {
    const items = chain(5);
    const placements = new ScannedPlacements(scanOf(items));
    for (const scanned of items) {
      expect(placements.endOf(scanned)).toEqual({ kind: 'root', root: items[0] });
    }
  });

  it('follows each neighbour once, so placing a whole chain costs one step per item', () => {
    const items = chain(20_000);
    const placements = new ScannedPlacements(scanOf(items), items.length);
    for (const scanned of [...items].reverse()) placements.endOf(scanned);
    for (const scanned of items) placements.endOf(scanned);
    expect(placements.isExhausted).toBe(false);
  });

  it('names where a chain leaves the update', () => {
    const items = [item(5, { origin: 2 })];
    expect(new ScannedPlacements(scanOf(items)).endOf(items[0] ?? item(0))).toEqual({
      kind: 'exit',
      client: 1,
      clock: 2,
    });
  });

  it('takes an item’s key from its right neighbour when it has no left one, as Yjs does', () => {
    const items = [item(0), item(1, { rightOrigin: 0 })];
    expect(new ScannedPlacements(scanOf(items)).endOf(items[1] ?? item(0))).toEqual({
      kind: 'root',
      root: items[0],
    });
  });

  it('ends a chain that loops unresolved, for every item on it', () => {
    const items = [item(0, { origin: 1 }), item(1, { origin: 0 })];
    const placements = new ScannedPlacements(scanOf(items));
    expect(placements.endOf(items[0] ?? item(0))).toEqual({ kind: 'unresolved' });
    expect(placements.endOf(items[1] ?? item(0))).toEqual({ kind: 'unresolved' });
    expect(placements.isExhausted).toBe(false);
  });

  it('stops at the work ceiling and says so', () => {
    const items = chain(100);
    const placements = new ScannedPlacements(scanOf(items), 10);
    expect(placements.endOf(items[99] ?? item(0))).toEqual({ kind: 'unresolved' });
    expect(placements.isExhausted).toBe(true);
  });
});
