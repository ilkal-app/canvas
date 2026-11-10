import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, type BoardObject, type ObjectId } from '@canvas/schema';

import { applyCommand, testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import type { AnyCommand } from '../commands/command.js';
import { createObjectCommand } from '../commands/create-object.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { previewCommand } from '../commands/preview-command.js';
import { resizeObjectsCommand } from '../commands/resize-objects.js';
import { rotateObjectsCommand } from '../commands/rotate-objects.js';
import { runCommand } from '../commands/run-command.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { boxSourceOf, overlaySource } from './box-source.js';
import { isPastBound } from './extent-rule.js';
import { worldBoxOf } from './world-box.js';

// Rule 1 of the board's bound as a property: on random honest boards (every object's box
// inside the bound, some at its edges, some nested in turned groups and frames) under random moves,
// turns and resizes (small ones, and ones of up to 2B), no object's box ever passes the bound; a
// command is refused only when what it would write puts a box past it; and a small change of an
// object well inside the bound is never refused. Seeded, so a failure replays.

const B = BOARD_BOUND;

/**
 * A seeded random source (mulberry32).
 *
 * @param seed - The seed.
 * @returns Numbers in [0, 1).
 */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A random place along one axis: near the origin, or near an edge of the bound.
 *
 * @param random - The random source.
 * @returns The coordinate.
 */
function placeOf(random: () => number): number {
  const edge = random() < 0.3 ? (random() < 0.5 ? -B : B) * 0.999 : 0;
  return edge + (random() - 0.5) * 2000;
}

/**
 * Builds an honest board through the commands: rectangles at the root and in groups and frames,
 * some turned. What `createObject` refuses (a box past the bound) is simply left out.
 *
 * @param random - The random source.
 * @returns The store and its object ids.
 */
function honestBoard(random: () => number): { store: YjsDocumentStore; ids: ObjectId[] } {
  const store = new YjsDocumentStore();
  const ids: ObjectId[] = [];
  const environment = testEnvironment(Math.floor(random() * 1e6));
  for (let index = 0; index < 12; index += 1) {
    const container = ids.find((key) => {
      const object = store.get(key);
      return object?.type === 'group' || object?.type === 'frame';
    });
    const parentId = container !== undefined && random() < 0.4 ? container : null;
    const kind = random();
    const shared = {
      id: `o${String(index)}` as ObjectId,
      parentId,
      x: parentId === null ? placeOf(random) : (random() - 0.5) * 400,
      y: parentId === null ? placeOf(random) : (random() - 0.5) * 400,
      rotation: random() < 0.3 ? (random() - 0.5) * 6 : 0,
    };
    const object =
      kind < 0.2
        ? { ...shared, type: 'group' }
        : kind < 0.35
          ? {
              ...shared,
              type: 'frame',
              width: 300,
              height: 200,
              name: 'f',
              clip: false,
              background: null,
            }
          : {
              ...shared,
              type: 'shape',
              kind: 'rectangle',
              width: 10 + random() * 200,
              height: 10 + random() * 200,
              stroke: null,
              fill: null,
              cornerRadius: 0,
              sides: 4,
              label: null,
            };
    const outcome = runCommand(store, ADA, createObjectCommand, { object } as never, environment);
    if (outcome.status === 'applied') ids.push(shared.id);
  }
  return { store, ids };
}

/**
 * A random honest command on one object: a move by or to, a turn about a point, a resize.
 *
 * @param random - The random source.
 * @param target - The object.
 * @returns The command and its input.
 */
function randomCommand(random: () => number, target: BoardObject): [AnyCommand, unknown] {
  const reach = random() < 0.5 ? 1000 : 2 * B;
  const amount = () => (random() - 0.5) * reach;
  const choice = random();
  if (choice < 0.4) {
    const move =
      random() < 0.5
        ? { id: target.id, by: { x: amount(), y: amount() } }
        : { id: target.id, to: { x: placeOf(random), y: placeOf(random) } };
    return [moveObjectsCommand, { moves: [move] }];
  }
  if (choice < 0.7 || !('width' in target || target.type === 'group')) {
    const about = { x: placeOf(random), y: placeOf(random) };
    const by = (random() - 0.5) * 7;
    return [rotateObjectsCommand, { rotations: [{ id: target.id, by, about }] }];
  }
  const size = { width: 1 + random() * (reach / 2), height: 1 + random() * 300 };
  return [resizeObjectsCommand, { resizes: [{ id: target.id, to: size }] }];
}

/**
 * Tells whether any object of a board has its box past the bound.
 *
 * @param source - The board.
 * @param objects - Its objects.
 * @returns The first such object's id, or `undefined`.
 */
function pastBound(
  source: Parameters<typeof worldBoxOf>[0],
  objects: Iterable<BoardObject>,
): ObjectId | undefined {
  for (const object of objects) if (isPastBound(worldBoxOf(source, object))) return object.id;
  return undefined;
}

describe('rule 1 of the board bound, on random honest boards and commands', () => {
  it.each([...Array(40).keys()])('seed %i', (seed) => {
    const random = randomFrom(seed * 7919 + 187);
    const { store, ids } = honestBoard(random);
    const environment = testEnvironment(seed);
    expect(pastBound(boxSourceOf(store), store.read().objects.values())).toBeUndefined();
    for (let step = 0; step < 25; step += 1) {
      const target = store.get(ids[Math.floor(random() * ids.length)] ?? ('o0' as ObjectId));
      if (target === undefined) continue;
      const [command, input] = randomCommand(random, target);
      const preview = previewCommand(store, ADA, command, input, environment);
      const outcome = runCommand(store, ADA, command, input as never, environment);
      if (outcome.status === 'rejected') {
        // Refused only by its own validation, or because its result has a box past the bound.
        if (preview.status === 'planned') {
          const before = boxSourceOf(store);
          const after = overlaySource(before, preview.written);
          const reached: BoardObject[] = [];
          const pending = [...preview.written.keys()];
          for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
            const object = after.get(next);
            if (object === undefined) continue;
            reached.push(object);
            pending.push(...after.childrenOf(next));
          }
          expect(pastBound(after, reached), JSON.stringify(input)).toBeDefined();
        }
        continue;
      }
      expect(pastBound(boxSourceOf(store), store.read().objects.values())).toBeUndefined();
    }
  });

  it('never refuses a small move of an object well inside the bound', () => {
    const random = randomFrom(4242);
    for (let round = 0; round < 50; round += 1) {
      const store = new YjsDocumentStore();
      const x = (random() - 0.5) * B;
      const y = (random() - 0.5) * B;
      applyCommand(store, createObjectCommand, {
        object: {
          id: 's',
          type: 'shape',
          kind: 'rectangle',
          x,
          y,
          rotation: random() * 6,
          width: 100,
          height: 100,
          stroke: null,
          fill: null,
          cornerRadius: 0,
          sides: 4,
          label: null,
        },
      });
      applyCommand(store, moveObjectsCommand, {
        moves: [{ id: 's', by: { x: (random() - 0.5) * 1e6, y: (random() - 0.5) * 1e6 } }],
      });
    }
  });
});
