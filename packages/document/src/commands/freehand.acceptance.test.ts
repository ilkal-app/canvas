// Freehand creation, edits, rejection and grouped undo.
import { describe, expect, it } from 'vitest';

import { freehandLocalBounds, type FreehandObject } from '@canvas/schema';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected, NOW } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { setStyleCommand } from './set-style.js';

function freehand(id = 'drawn-one', points = [0, 0, 100, 0, 100, 20]): Record<string, unknown> {
  return {
    id,
    type: 'freehand',
    parentId: null,
    x: 30,
    y: 40,
    tool: 'marker',
    points,
    pressures: [0.2, 0.5, 0.8],
    stroke: { color: 'ink', width: 10 },
  };
}

describe('freehand commands', () => {
  it('creates and reads a freehand with command-assigned fields', () => {
    const store = createFixtureStore();
    try {
      const input = freehand();
      const { result } = applyCommand(store, createObjectCommand, { object: input } as never);
      expect(store.get(result.id)).toMatchObject({
        ...input,
        createdBy: ADA_ID,
        createdAt: NOW,
        updatedAt: NOW,
        locked: false,
        rotation: 0,
      });
    } finally {
      store.destroy();
    }
  });

  it('creates two split pieces in one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    try {
      const first = freehand('piece-one');
      const second = { ...freehand('piece-two', [100, 20, 150, 30]), pressures: [0.8, 0.6] };
      const { result } = applyCommand(store, createObjectsCommand, {
        objects: [first, second],
      } as never);
      expect(result.ids).toHaveLength(2);
      expect(
        result.ids.every(
          (id) => (store.get(id) as { type?: string } | undefined)?.type === 'freehand',
        ),
      ).toBe(true);
      expect(history.undo()).toBe(true);
      expect(result.ids.map((id) => store.get(id))).toEqual([undefined, undefined]);
    } finally {
      history.destroy();
      store.destroy();
    }
  });

  it('moves a freehand without changing its local points', () => {
    const store = createFixtureStore();
    try {
      const { result } = applyCommand(store, createObjectCommand, { object: freehand() } as never);
      applyCommand(store, moveObjectsCommand, {
        moves: [{ id: result.id, by: { x: 20, y: -10 } }],
      });
      expect(store.get(result.id)).toMatchObject({ x: 50, y: 30, points: [0, 0, 100, 0, 100, 20] });
    } finally {
      store.destroy();
    }
  });

  it('doubles local x coordinates on a width resize and keeps stroke width', () => {
    const store = createFixtureStore();
    try {
      const { result } = applyCommand(store, createObjectCommand, { object: freehand() } as never);
      // The inked box is the curve's (which swings past the corner point) grown by the width.
      const box = freehandLocalBounds(store.get(result.id) as FreehandObject);
      applyCommand(store, resizeObjectsCommand, {
        resizes: [{ id: result.id, to: { width: 2 * box.width, height: box.height } }],
      });
      expect(store.get(result.id)).toMatchObject({
        points: [0, 0, 200, 0, 200, 20],
        stroke: { width: 10 },
      });
    } finally {
      store.destroy();
    }
  });

  it('sets stroke, opacity, tool and visibility on a freehand', () => {
    const store = createFixtureStore();
    try {
      const { result } = applyCommand(store, createObjectCommand, { object: freehand() } as never);
      applyCommand(store, setStyleCommand, {
        changes: [
          {
            id: result.id,
            style: {
              stroke: { color: [1, 0, 0, 1], width: 6 },
              opacity: 0.4,
              tool: 'highlighter',
              isHidden: true,
            },
          },
        ],
      } as never);
      expect(store.get(result.id)).toMatchObject({
        stroke: { color: [1, 0, 0, 1], width: 6 },
        opacity: 0.4,
        tool: 'highlighter',
        isHidden: true,
      });
    } finally {
      store.destroy();
    }
  });

  it('rejects an odd-length point array without writing', () => {
    const store = createFixtureStore();
    try {
      expect(
        expectRejected(store, createObjectCommand, {
          object: { ...freehand(), points: [0, 0, 1] },
        }).map((error) => error.path),
      ).toContainEqual(['object', 'points']);
    } finally {
      store.destroy();
    }
  });
});
