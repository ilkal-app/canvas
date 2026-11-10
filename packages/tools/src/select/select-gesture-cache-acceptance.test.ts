import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, Point } from '@canvas/schema';

import { id, indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

const NATIVE_SET = Set;
afterEach(() => vi.unstubAllGlobals());

describe('gesture moved-id cache acceptance', () => {
  it('builds the thousand-object moved-id set at most once over twenty pointer moves', () => {
    const objects: BoardObject[] = Array.from({ length: 1000 }, (unused, index) =>
      rect(`leaf-${String(index)}`, null, {
        x: (index % 40) * 12,
        y: Math.floor(index / 40) * 12,
        width: 8,
        height: 8,
      }),
    );
    const store = createSelectStore(objects);
    const index = indexOf(objects);
    const controller = new SelectController({
      store,
      origin: ADA,
      environment: ENVIRONMENT,
      hitTester: createSelectHitTester(index, storeSource(store)),
      onChange: () => undefined,
    });
    controller.select(objects.map((object) => object.id));
    const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
      controller.handle(
        { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false },
        1,
      );
    };
    let movedSetCount = 0;
    class CountingSet<T> extends NATIVE_SET<T> {
      constructor(values?: Iterable<T> | null) {
        super(values);
        if (
          Array.isArray(values) &&
          values.length === 1000 &&
          typeof values[0] === 'string' &&
          values[0].startsWith('leaf-') &&
          /dropTargetBox|stackDropOf|MovedIds/.test(new Error().stack?.split('\n')[2] ?? '')
        ) {
          movedSetCount += 1;
        }
      }
    }
    vi.stubGlobal('Set', CountingSet);
    at('pointerDown', { x: 40, y: 40 });
    for (let step = 1; step <= 20; step += 1) {
      at('pointerMove', { x: 40 + step, y: 40 });
    }
    expect(movedSetCount).toBeLessThanOrEqual(1);
    vi.unstubAllGlobals();
    at('pointerUp', { x: 60, y: 40 });
    expect(store.get(id('leaf-0'))?.x).toBe(20);
  });
});
