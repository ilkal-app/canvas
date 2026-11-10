import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, type ObjectId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { runCommand } from '../commands/run-command.js';
import {
  readStoredEntry,
  writeStoredEntriesRemotely,
} from '../store/__fixtures__/remote-values.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

// Rule 7 of the board's bound under rounding (fix round 4): the re-review simulated moves
// into and inside turned frames and found about 15% of inward moves of a far object, and about 12%
// of moves to (B, y) into a turned frame, refused by the exact rule, for an extent that rounding
// moved one ulp further out. The rule keeps a relative slack of 2^-40 (`BOUND_SLACK`): an extent may
// end at most max(B, |before|) × (1 + 2^-40) out, a thousandth of a unit at the bound. Inward always
// works; a real step outward, a thousandth past it, is still refused.

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
 * A store with a frame turned by an angle at a point, and, for a far object, a rectangle in it.
 *
 * @param frame - The frame's place (`x`, `y`) and turn (`rotation`).
 * @returns The store.
 */
function storeWithTurnedFrame(
  frame: Readonly<Record<'x' | 'y' | 'rotation', number>>,
): YjsDocumentStore {
  const store = new YjsDocumentStore();
  const environment = testEnvironment(3);
  runCommand(
    store,
    ADA,
    createObjectCommand,
    {
      object: {
        id: 'frame',
        type: 'frame',
        ...frame,
        width: 10,
        height: 10,
        name: 'f',
        clip: false,
        background: null,
      },
    },
    environment,
  );
  runCommand(
    store,
    ADA,
    createObjectCommand,
    {
      object: {
        id: 'r',
        type: 'shape',
        kind: 'rectangle',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        stroke: null,
        fill: null,
        cornerRadius: 0,
        sides: 4,
        label: null,
      },
    },
    environment,
  );
  return store;
}

describe('the bound is exact up to rounding: inward always works', () => {
  it('moves a far object in a turned frame inward, along one axis or both, never refused', () => {
    const random = randomFrom(4_187);
    let refused = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const store = storeWithTurnedFrame({
        x: (random() - 0.5) * 2000,
        y: (random() - 0.5) * 2000,
        rotation: (random() - 0.5) * 7,
      });
      const width = random() * 500;
      const height = random() * 500;
      applyCommand(store, moveObjectsCommand, { moves: [{ id: 'r', to: { x: 0, y: 0 } }] });
      // A peer puts the rectangle past the bound on the board, in the turned frame.
      const placement = readStoredEntry(store, 'r', 'placement') as object;
      const size = readStoredEntry(store, 'r', 'size') as object;
      writeStoredEntriesRemotely(store, 'r', {
        placement: {
          ...placement,
          parentId: 'frame',
          x: (1 + random()) * B * (random() < 0.5 ? -1 : 1),
          y: (1 + random()) * B * (random() < 0.5 ? -1 : 1),
          rotation: (random() - 0.5) * 7,
        },
        size: { ...size, width, height },
      });
      const object = store.get('r' as ObjectId);
      const frame = store.get('frame' as ObjectId);
      if (object === undefined || frame === undefined) throw new Error('missing');
      // Inward on the board: towards the origin along each axis, or not at all along one.
      const cos = Math.cos(frame.rotation);
      const sin = Math.sin(frame.rotation);
      const worldX = cos * object.x - sin * object.y + frame.x;
      const worldY = sin * object.x + cos * object.y + frame.y;
      const step = (value: number) => (random() < 0.3 ? 0 : -Math.sign(value) * random() * 1000);
      const outcome = runCommand(
        store,
        ADA,
        moveObjectsCommand,
        { moves: [{ id: 'r', by: { x: step(worldX), y: step(worldY) } }] },
        testEnvironment(draw),
      );
      if (outcome.status === 'rejected') refused += 1;
    }
    expect(refused).toBe(0);
  });

  it('moves an object to (B, y) into a turned frame, never refused', () => {
    const random = randomFrom(9_187);
    let refused = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const store = storeWithTurnedFrame({
        x: (random() - 0.5) * 2 * B,
        y: (random() - 0.5) * 2 * B,
        rotation: (random() - 0.5) * 7,
      });
      const to = { x: random() < 0.5 ? B : -B, y: (random() - 0.5) * 2 * B };
      const outcome = runCommand(
        store,
        ADA,
        moveObjectsCommand,
        { moves: [{ id: 'r', to, parentId: 'frame' }] },
        testEnvironment(draw),
      );
      if (outcome.status === 'rejected') refused += 1;
    }
    expect(refused).toBe(0);
  });

  it('still refuses a step a thousandth of a unit past max(B, before)', () => {
    const store = storeWithTurnedFrame({ x: 0, y: 0, rotation: 0 });
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'r', to: { x: B, y: 0 } }] });
    const past = runCommand(
      store,
      ADA,
      moveObjectsCommand,
      { moves: [{ id: 'r', by: { x: 1e-3, y: 0 } }] },
      testEnvironment(),
    );
    expect(past.status).toBe('rejected');
    const placement = readStoredEntry(store, 'r', 'placement') as object;
    writeStoredEntriesRemotely(store, 'r', { placement: { ...placement, x: B + 400 } });
    const further = runCommand(
      store,
      ADA,
      moveObjectsCommand,
      { moves: [{ id: 'r', by: { x: 1e-3, y: 0 } }] },
      testEnvironment(),
    );
    expect(further.status).toBe('rejected');
  });
});
