import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  byPriority,
  isWithinView,
  LAYER_LIMIT_MARGIN,
  limitOrder,
  type LimitRanked,
} from './layer-limit.js';

const layer = (id: string, area: number, depth = 0): LimitRanked => ({
  id: id as ObjectId,
  depth,
  area,
});

/**
 * The ids in the limit's order.
 *
 * @param ranked - The candidates, sorted here by priority.
 * @param incumbents - The ids holding slots.
 * @param limit - The slots.
 * @returns The ids.
 */
function orderOf(ranked: LimitRanked[], incumbents: string[], limit: number): string[] {
  const held = new Set(incumbents);
  return limitOrder(ranked.slice().sort(byPriority), (id) => held.has(id), limit).map(
    ({ id }) => id,
  );
}

describe('the limit’s order', () => {
  it('is the priority order on a cold start', () => {
    const ranked = [layer('c', 100), layer('a', 100), layer('b', 300), layer('d', 50, 1)];
    expect(orderOf(ranked, [], 2)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('keeps the incumbents’ slots, and gives a newcomer a free one', () => {
    const ranked = [layer('a', 100), layer('b', 100), layer('c', 100), layer('d', 100)];
    expect(orderOf(ranked, ['c', 'd'], 2)).toEqual(['c', 'd', 'a', 'b']);
    expect(orderOf(ranked, ['d'], 2)).toEqual(['a', 'd', 'b', 'c']);
    // More incumbents than slots (layers back on the canvas): the first by priority keep them.
    expect(orderOf(ranked, ['b', 'c', 'd'], 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('lets a newcomer take the weakest slot only when it is clearly ahead', () => {
    const near = layer('n', 100 * LAYER_LIMIT_MARGIN - 1);
    const clear = layer('n', 100 * LAYER_LIMIT_MARGIN);
    const incumbents = [layer('i', 200), layer('j', 100)];
    expect(orderOf([...incumbents, near], ['i', 'j'], 2)).toEqual(['i', 'j', 'n']);
    expect(orderOf([...incumbents, clear], ['i', 'j'], 2)).toEqual(['i', 'n', 'j']);
    // An outer layer is ahead whatever its area; an inner one never.
    expect(orderOf([...incumbents, layer('o', 1, -1)], ['i', 'j'], 2)).toEqual(['o', 'i', 'j']);
    expect(orderOf([...incumbents, layer('x', 900, 1)], ['i', 'j'], 2)).toEqual(['i', 'j', 'x']);
  });

  it('counts a layer near the canvas, within the view’s own size of it', () => {
    const view = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    const at = (x: number, y: number) => ({ minX: x, minY: y, maxX: x + 10, maxY: y + 10 });
    expect(isWithinView(at(-105, 0), view)).toBe(true);
    expect(isWithinView(at(-111, 0), view)).toBe(false);
    expect(isWithinView(at(199, 0), view)).toBe(true);
    expect(isWithinView(at(200, 0), view)).toBe(false);
    expect(isWithinView(at(0, -59), view)).toBe(true);
    expect(isWithinView(at(0, 100), view)).toBe(false);
  });
});
