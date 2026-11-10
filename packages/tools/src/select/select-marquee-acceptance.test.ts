import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN } from '@canvas/document';
import { SceneSpatialIndex, type SpatialSearch, type WorldBounds } from '@canvas/engine';
import type { BoardObject, Point } from '@canvas/schema';

import { frame, group, id, indexOf, mapSource, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { beginDrag, dragIntent } from './select-drag.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectPointer } from './select-input.js';
import { EMPTY_SELECTION } from './selection-state.js';

function pointer(world: Point): SelectPointer {
  return { world, screen: world, isShiftPressed: false, isModPressed: false };
}

function random(seed: number): () => number {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function board(seed: number): BoardObject[] {
  const next = random(seed);
  const objects: BoardObject[] = [
    frame('outer', null, { x: 30, y: 20, width: 350, height: 310 }),
    frame('inner', 'outer', { x: 30, y: 25, width: 220, height: 200 }),
    group('group-a', 'inner', 15, 20),
    group('group-b', 'group-a', 15, 10),
  ];
  const parents = [null, 'outer', 'inner', 'group-a', 'group-b'];
  for (let index = 0; index < 90; index += 1) {
    objects.push(
      rect(`shape-${String(index)}`, parents[Math.floor(next() * parents.length)] ?? null, {
        x: Math.floor(next() * 350),
        y: Math.floor(next() * 300),
        width: 8 + Math.floor(next() * 40),
        height: 8 + Math.floor(next() * 40),
        rotation: next() < 0.35 ? next() * Math.PI : 0,
        isLocked: next() < 0.12,
      }),
    );
  }
  return objects;
}

function rectangle(start: Point, end: Point): WorldBounds {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

describe('incremental marquee acceptance (PR3)', () => {
  it('matches a fresh contain hit when a rounded frame has sharp pick corners beyond its indexed box', () => {
    const rounded = {
      ...frame('rounded', null, {
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: Math.PI / 4,
      }),
      cornerRadius: 50,
    };
    const objects = [rounded];
    const index = indexOf(objects);
    const source = mapSource(objects);
    const hits = createSelectHitTester(index, source);
    const tracker = hits.marquee?.();
    expect(tracker).toBeDefined();
    if (tracker === undefined) return;
    const before = { minX: 45, minY: 115, maxX: 155, maxY: 225 };
    const after = { minX: 20, minY: 90, maxX: 180, maxY: 250 };
    expect(tracker.update(before, 'contain', null, 0)).toEqual([]);
    expect(hits.hitRect(after, 'contain')).toEqual([id('rounded')]);
    expect(tracker.update(after, 'contain', null, 0)).toEqual(hits.hitRect(after, 'contain'));
  });

  it('matches fresh full hitRect after every seeded grow, shrink and mode-flip move', () => {
    for (const seed of [542, 54_201, 54_202, 54_203]) {
      const objects = board(seed);
      const index = indexOf(objects);
      const source = mapSource(objects);
      const hits = createSelectHitTester(index, source);
      const next = random(seed ^ 0xdeadbeef);
      const start = { x: 190, y: 160 };
      for (const enteredGroupId of [null, id('group-a')]) {
        const drag = beginDrag({ kind: 'empty', onClick: undefined }, false, [], enteredGroupId);
        const positions = [
          { x: 220, y: 210 },
          { x: 390, y: 330 },
          { x: 260, y: 250 },
          { x: 120, y: 130 },
          { x: 20, y: 20 },
          { x: 310, y: 60 },
        ];
        for (let move = 0; move < 30; move += 1) {
          positions.push({ x: Math.floor(next() * 450), y: Math.floor(next() * 400) });
        }
        for (const position of positions) {
          const intent = dragIntent(drag, start, pointer(position), {
            zoom: 1,
            selection: EMPTY_SELECTION,
            frame: undefined,
            canResize: false,
            isLocked: false,
            hitTester: hits,
          });
          expect(intent.type).toBe('marquee');
          if (intent.type !== 'marquee') continue;
          const mode = position.x >= start.x ? 'intersect' : 'contain';
          const fresh = createSelectHitTester(index, source).hitRect(
            rectangle(start, position),
            mode,
            enteredGroupId,
          );
          expect(
            [...intent.ids].sort(),
            `seed ${String(seed)}, move ${String(position.x)},${String(position.y)}`,
          ).toEqual([...fresh].sort());
        }
      }
    }
  });

  it('reuses the hit array when a move leaves the target set unchanged', () => {
    const objects = [rect('target', null, { x: 20, y: 20, width: 30, height: 30 })];
    const hits = createSelectHitTester(indexOf(objects), mapSource(objects));
    const drag = beginDrag({ kind: 'empty', onClick: undefined }, false, [], null);
    const context = {
      zoom: 1,
      selection: EMPTY_SELECTION,
      frame: undefined,
      canResize: false,
      isLocked: false,
      hitTester: hits,
    };
    const first = dragIntent(drag, { x: 0, y: 0 }, pointer({ x: 80, y: 80 }), context);
    const second = dragIntent(drag, { x: 0, y: 0 }, pointer({ x: 90, y: 90 }), context);
    expect(first.type).toBe('marquee');
    expect(second.type).toBe('marquee');
    if (first.type === 'marquee' && second.type === 'marquee') expect(second.ids).toBe(first.ids);
  });

  it('examines under 10% of a full pass after a small marquee growth on 5,000 objects', () => {
    const objects: BoardObject[] = [];
    for (let row = 0; row < 50; row += 1) {
      for (let column = 0; column < 100; column += 1) {
        objects.push(
          rect(`r-${String(row)}-${String(column)}`, null, {
            x: column * 12,
            y: row * 12,
            width: 10,
            height: 10,
          }),
        );
      }
    }
    const index = indexOf(objects);
    let candidates = 0;
    let searches = 0;
    const counting: SpatialSearch = {
      searchRect(bounds) {
        searches += 1;
        const found = index.searchRect(bounds);
        candidates += found.length;
        return found;
      },
    };
    const hits = createSelectHitTester(counting, mapSource(objects));
    const drag = beginDrag({ kind: 'empty', onClick: undefined }, false, [], null);
    const context = {
      zoom: 1,
      selection: EMPTY_SELECTION,
      frame: undefined,
      canResize: false,
      isLocked: false,
      hitTester: hits,
    };
    const start = { x: -20, y: -20 };
    dragIntent(drag, start, pointer({ x: 600, y: 620 }), context);
    candidates = 0;
    searches = 0;
    dragIntent(drag, start, pointer({ x: 603, y: 620 }), context);
    const fullPass = index.searchRect(rectangle(start, { x: 603, y: 620 })).length;
    expect(fullPass).toBeGreaterThan(2_000);
    expect(candidates).toBeLessThan(fullPass * 0.1);
    expect(searches).toBeLessThanOrEqual(8);
  });

  it('sees a peer move into an active marquee on the next pointer move', () => {
    const objects = [rect('target', null, { x: 300, y: 300, width: 20, height: 20 })];
    const store = createSelectStore(objects);
    const index = new SceneSpatialIndex();
    index.apply({
      created: [id('target')],
      updated: [],
      deleted: [],
      get: (key) => store.get(key),
    });
    store.subscribe((changes) => {
      index.apply({ ...changes, get: (key) => store.get(key) });
    });
    const controller = new SelectController({
      store,
      origin: ADA,
      environment: ENVIRONMENT,
      hitTester: createSelectHitTester(index, storeSource(store)),
    });
    const at = (kind: 'pointerDown' | 'pointerMove', world: Point) => {
      controller.handle({ kind, ...pointer(world) }, 1);
    };
    at('pointerDown', { x: 0, y: 0 });
    at('pointerMove', { x: 100, y: 100 });
    expect(controller.selection.ids).toEqual([]);
    const target = store.get(id('target'));
    expect(target).toBeDefined();
    if (target !== undefined) {
      store.transact(SYSTEM_ORIGIN, (transaction) => {
        transaction.setObject({ ...target, x: 50, y: 50 });
      });
    }
    at('pointerMove', { x: 101, y: 101 });
    expect(controller.selection.ids).toEqual([id('target')]);
    controller.destroy();
  });
});
