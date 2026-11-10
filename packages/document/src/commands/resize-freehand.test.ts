import { describe, expect, it } from 'vitest';

import { freehandLocalBounds, type FreehandObject } from '@canvas/schema';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { groupCommand } from './group.js';
import { resizeObjectsCommand } from './resize-objects.js';

/**
 * A straight marker stroke 100 long, 10 wide: its inked box is 110 × 10 from (-5, -5).
 *
 * @param id - The stroke's id.
 * @param overrides - Fields to change.
 * @returns The new object input.
 */
function stroke(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'freehand',
    parentId: null,
    x: 200,
    y: 300,
    tool: 'marker',
    points: [0, 0, 100, 0],
    stroke: { color: 'ink', width: 10 },
    ...overrides,
  };
}

/**
 * The stroke as the store reads it.
 *
 * @param store - The store.
 * @param id - The stroke's id.
 * @returns The stroke.
 */
function read(store: ReturnType<typeof createFixtureStore>, id: string): FreehandObject {
  return store.get(id as never) as FreehandObject;
}

describe('resizeObjects on a freehand stroke', () => {
  it('scales the points by a change of size and keeps the inked box where it was', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, createObjectCommand, { object: stroke('ink-a') } as never);
      applyCommand(store, resizeObjectsCommand, {
        resizes: [{ id: 'ink-a', by: { width: 110, height: 0 } }],
      });
      const resized = read(store, 'ink-a');
      expect(resized.points).toEqual([0, 0, 200, 0]);
      expect(resized.stroke.width).toBe(10);
      // The corner of the inked box stays at (195, 295).
      const box = freehandLocalBounds(resized);
      expect({ x: resized.x + box.x, y: resized.y + box.y }).toEqual({ x: 195, y: 295 });
    } finally {
      store.destroy();
    }
  });

  it('moves the inked box to an origin', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, createObjectCommand, { object: stroke('ink-b') } as never);
      applyCommand(store, resizeObjectsCommand, {
        resizes: [{ id: 'ink-b', to: { width: 110, height: 10 }, origin: { x: 0, y: 0 } }],
      });
      const resized = read(store, 'ink-b');
      expect(resized.points).toEqual([0, 0, 100, 0]);
      expect({ x: resized.x, y: resized.y }).toEqual({ x: 5, y: 5 });
    } finally {
      store.destroy();
    }
  });

  it('refuses to collapse a side', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, createObjectCommand, { object: stroke('ink-c') } as never);
      const errors = expectRejected(store, resizeObjectsCommand, {
        resizes: [{ id: 'ink-c', to: { width: 0, height: 10 } }],
      });
      expect(errors.map(({ code, path }) => [code, path])).toEqual([
        ['invalid-input', ['resizes', 0, 'to']],
      ]);
    } finally {
      store.destroy();
    }
  });

  it('scales a stroke inside a resized group, keeping its width', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, createObjectCommand, { object: stroke('ink-d') } as never);
      applyCommand(store, createObjectCommand, {
        object: stroke('ink-e', { y: 400, points: [0, 0, 0, 50] }),
      } as never);
      applyCommand(store, groupCommand, { ids: ['ink-d', 'ink-e'], groupId: 'drawing' });
      applyCommand(store, resizeObjectsCommand, {
        resizes: [{ id: 'drawing', by: { width: 110, height: 0 } }],
      });
      expect(read(store, 'ink-d').points).toEqual([0, 0, 200, 0]);
      expect(read(store, 'ink-d').stroke.width).toBe(10);
      expect(read(store, 'ink-e').points).toEqual([0, 0, 0, 50]);
    } finally {
      store.destroy();
    }
  });
});
