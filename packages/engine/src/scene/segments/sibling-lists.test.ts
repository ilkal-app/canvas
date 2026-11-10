import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { paintOrderOf, paintOrderOfSiblings } from './paint-order.js';
import {
  SIBLING_BATCH_THRESHOLD,
  SiblingLists,
  type SiblingChange,
  type StackedObject,
} from './sibling-lists.js';

function stacked(id: string, z: string, parentId: string | null = null): StackedObject {
  return { id: id as ObjectId, z, parentId: parentId as ObjectId | null };
}

/**
 * A deterministic pseudo-random sequence (mulberry32), so a failing run replays.
 *
 * @param seed - The seed.
 * @returns A function returning numbers in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('SiblingLists', () => {
  it('keeps each parent’s children sorted by z, then id, as objects arrive, move and leave', () => {
    const lists = new SiblingLists();
    const a = stacked('a', 'a1');
    const b = stacked('b', 'a0');
    const c = stacked('c', 'a1');
    lists.replace(undefined, a);
    lists.replace(undefined, b);
    lists.replace(undefined, c);
    expect(lists.childrenOf(null).map(({ id }) => id)).toEqual(['b', 'a', 'c']);
    const bOnTop = stacked('b', 'a2');
    lists.replace(b, bOnTop);
    expect(lists.childrenOf(null).map(({ id }) => id)).toEqual(['a', 'c', 'b']);
    const cInGroup = stacked('c', 'a0', 'a');
    lists.replace(c, cInGroup);
    expect(lists.childrenOf(null).map(({ id }) => id)).toEqual(['a', 'b']);
    expect(lists.childrenOf('a' as ObjectId)).toEqual([cInGroup]);
    lists.replace(cInGroup, undefined);
    expect([...lists.parents()]).toEqual([null]);
    expect(lists.size).toBe(2);
  });

  it('refuses to remove an object it does not hold, so a skipped change set is loud', () => {
    const lists = SiblingLists.of([stacked('a', 'a0')]);
    expect(() => {
      lists.replace(stacked('a', 'a5'), undefined);
    }).toThrow(/do not hold "a"/);
    expect(() => {
      lists.replace(stacked('x', 'a0', 'nowhere'), undefined);
    }).toThrow(/do not hold "x"/);
  });

  it('gives the same paint order as a full rebuild after any sequence of changes', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const random = seededRandom(seed);
      const pick = <Item>(items: readonly Item[]): Item =>
        items[Math.floor(random() * items.length)] as Item;
      const ids = [...Array(30).keys()].map((index) => `o${String(index)}`);
      const parents = [null, null, null, 'o1', 'o2', 'o3', 'gone'];
      const keys = ['a0', 'a1', 'a2', 'a1V', 'a0V', 'Zz'];
      const current = new Map<string, StackedObject>();
      const lists = new SiblingLists();
      for (let step = 0; step < 200; step += 1) {
        const id = pick(ids);
        const previous = current.get(id);
        const next = random() < 0.15 ? undefined : stacked(id, pick(keys), pick(parents));
        if (next === undefined) current.delete(id);
        else current.set(id, next);
        lists.replace(previous, next);
        expect(paintOrderOfSiblings(lists), `seed ${String(seed)}, step ${String(step)}`).toEqual(
          paintOrderOf([...current.values()]),
        );
      }
    }
  });

  it('applies a batch of changes as the same replaces one by one would, below and above the threshold', () => {
    for (const size of [SIBLING_BATCH_THRESHOLD - 1, SIBLING_BATCH_THRESHOLD, 400]) {
      for (let seed = 1; seed <= 10; seed += 1) {
        const random = seededRandom(seed * 1000 + size);
        const pick = <Item>(items: readonly Item[]): Item =>
          items[Math.floor(random() * items.length)] as Item;
        const keys = ['a0', 'a1', 'a2', 'a1V', 'Zz'];
        const parents = [null, null, 'o1', 'o2'];
        const start = [...Array(size).keys()].map((index) =>
          stacked(`o${String(index)}`, pick(keys), pick(parents)),
        );
        const one = SiblingLists.of(start);
        const many = SiblingLists.of(start);
        const changes: SiblingChange[] = start.map((object, index) => {
          const roll = random();
          if (roll < 0.3) return [object, undefined];
          if (roll < 0.6) return [object, stacked(object.id, pick(keys), pick(parents))];
          return [undefined, stacked(`new${String(index)}`, pick(keys), pick(parents))];
        });
        for (const [previous, next] of changes) one.replace(previous, next);
        many.replaceAll(changes);
        expect(many.size).toBe(one.size);
        for (const parentId of [null, 'o1', 'o2'] as (ObjectId | null)[]) {
          expect(many.childrenOf(parentId)).toEqual(one.childrenOf(parentId));
        }
        expect(paintOrderOfSiblings(many)).toEqual(paintOrderOfSiblings(one));
      }
    }
  });

  it('empties a parent a batch takes everything from, and stays loud about what it does not hold', () => {
    const start = [...Array(SIBLING_BATCH_THRESHOLD).keys()].map((index) =>
      stacked(`o${String(index)}`, 'a0'),
    );
    const lists = SiblingLists.of(start);
    lists.replaceAll(start.map((object): SiblingChange => [object, undefined]));
    expect([...lists.parents()]).toEqual([]);
    expect(lists.size).toBe(0);
    const again = SiblingLists.of(start);
    const stale: SiblingChange[] = start.map((object, index) => [
      index === 3 ? stacked(object.id, 'a5') : object,
      undefined,
    ]);
    expect(() => {
      again.replaceAll(stale);
    }).toThrow(/do not hold "o3"/);
  });
});

describe('SiblingLists.keepsPlace', () => {
  const lists = SiblingLists.of([
    stacked('a', 'a0'),
    stacked('b', 'a2'),
    stacked('c', 'a4'),
    stacked('child', 'a0', 'b'),
  ]);

  it('keeps an object whose new z key still sorts between the same siblings', () => {
    expect(lists.keepsPlace(stacked('b', 'a2'), stacked('b', 'a3'))).toBe(true);
    expect(lists.keepsPlace(stacked('c', 'a4'), stacked('c', '~'))).toBe(true);
    expect(lists.keepsPlace(stacked('a', 'a0'), stacked('a', 'Zz'))).toBe(true);
    expect(lists.keepsPlace(stacked('child', 'a0', 'b'), stacked('child', 'z', 'b'))).toBe(true);
  });

  it('refuses a key that passes a sibling, ties with one in the wrong order, or a new parent', () => {
    expect(lists.keepsPlace(stacked('b', 'a2'), stacked('b', 'a5'))).toBe(false);
    expect(lists.keepsPlace(stacked('b', 'a2'), stacked('b', 'Zz'))).toBe(false);
    // Tied with `c` at a4, `b` sorts before it by id: still in place; `d` would not be.
    expect(lists.keepsPlace(stacked('b', 'a2'), stacked('b', 'a4'))).toBe(true);
    expect(lists.keepsPlace(stacked('a', 'a0'), stacked('a', 'a2'))).toBe(true);
    expect(lists.keepsPlace(stacked('a', 'a0'), stacked('a', 'a3'))).toBe(false);
    expect(lists.keepsPlace(stacked('child', 'a0', 'b'), stacked('child', 'a0', 'c'))).toBe(false);
  });

  it('answers false for an object the lists do not hold where its key puts it', () => {
    expect(lists.keepsPlace(stacked('x', 'a1'), stacked('x', 'a1'))).toBe(false);
    expect(lists.keepsPlace(stacked('b', 'a9'), stacked('b', 'a9'))).toBe(false);
  });
});
