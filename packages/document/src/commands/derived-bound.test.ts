import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '@canvas/schema';

import {
  readStoredEntry,
  writeNetworkMemberRemotely,
  writeStoredEntriesRemotely,
} from '../store/__fixtures__/remote-values.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { expectInvalidInput } from './__fixtures__/bound-fixtures.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { createObjectCommand } from './create-object.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { editNetworkCommand } from './edit-network.js';
import { groupCommand } from './group.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { rotateObjectsCommand } from './rotate-objects.js';
import { setStyleCommand } from './set-style.js';
import { ungroupCommand } from './ungroup.js';

// The board bound judges where objects are on the board. A value a command derives from
// stored data (a detached end, a re-expressed coordinate) is stored as computed when finite; a
// command that keeps every place (delete, group, ungroup) is never refused for the bound; and an
// object placed far away may stay or come in, never go further out.

const FAR = 1e300;

/**
 * Puts a stored `x` of 1e300 on an object, as a peer that skips validation would.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param x - The x to store.
 */
function placeFar(store: ReturnType<typeof createFixtureStore>, objectId: string, x = FAR): void {
  const placement = readStoredEntry(store, objectId, 'placement') as object;
  writeStoredEntriesRemotely(store, objectId, { placement: { ...placement, x } });
}

describe('deleting an object stored far away', () => {
  it('detaches a connector at a non-zero x, storing the end as computed', () => {
    const store = createFixtureStore();
    placeFar(store, 'sticky-idea');
    const placement = readStoredEntry(store, 'connector-flow', 'placement') as object;
    writeStoredEntriesRemotely(store, 'connector-flow', { placement: { ...placement, x: 100 } });
    const { result } = applyCommand(store, deleteObjectsCommand, { ids: ['sticky-idea'] });
    expect(result.updatedIds).toEqual(['connector-flow']);
    const connector = mustGet(store, 'connector-flow');
    if (connector.type !== 'connector' || connector.from.kind !== 'point') {
      throw new Error('the end was not detached');
    }
    expect(Number.isFinite(connector.from.x)).toBe(true);
    expect(connector.from.x).toBeGreaterThan(BOARD_BOUND);
  });

  it('detaches a comment pin, storing it as computed', () => {
    const store = createFixtureStore();
    placeFar(store, 'image-photo');
    const placement = readStoredEntry(store, 'comment-on-photo', 'placement') as object;
    writeStoredEntriesRemotely(store, 'comment-on-photo', {
      placement: { ...placement, x: 100 },
    });
    applyCommand(store, deleteObjectsCommand, { ids: ['image-photo'] });
    const comment = mustGet(store, 'comment-on-photo');
    expect(comment).toMatchObject({ anchor: { kind: 'point' } });
    expect(comment.x).toBeGreaterThan(BOARD_BOUND);
    expect(Number.isFinite(comment.x)).toBe(true);
  });
});

describe('an honest move or turn under an ancestor stored far away', () => {
  function storeWithFarAncestor() {
    const store = createGroupedStore();
    placeFar(store, 'group-outer');
    return store;
  }

  it('moves a child by a displacement in its own frame, not to the origin', () => {
    const store = storeWithFarAncestor();
    const before = mustGet(store, 'rect-c');
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'rect-c', by: { x: 5, y: 0 } }] });
    const after = mustGet(store, 'rect-c');
    // The child's parent chain turns by 0.4 + 0.3 rad: a step of 5 along the board's x is
    // (5 cos 0.7, -5 sin 0.7) in the child's parent frame.
    expect(after.x - before.x).toBeCloseTo(5 * Math.cos(0.7), 6);
    expect(after.y - before.y).toBeCloseTo(-5 * Math.sin(0.7), 6);
  });

  it('turns a child about its own origin without moving it', () => {
    const store = storeWithFarAncestor();
    const before = mustGet(store, 'rect-c');
    applyCommand(store, rotateObjectsCommand, { rotations: [{ id: 'rect-c', by: 0.5 }] });
    const after = mustGet(store, 'rect-c');
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(after.rotation).toBeCloseTo(0.5, 9);
  });
});

describe('an object stored far away, moved and turned by an honest command', () => {
  it('moves by a displacement and keeps its far coordinate as it is', () => {
    const store = createFixtureStore();
    placeFar(store, 'image-photo', 1e300);
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'image-photo', by: { x: 5, y: 3 } }] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 1e300, y: -297 });
  });

  it('is turned about its own origin without moving', () => {
    const store = createFixtureStore();
    placeFar(store, 'image-photo', 1e300);
    applyCommand(store, rotateObjectsCommand, { rotations: [{ id: 'image-photo', by: 0.5 }] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 1e300, y: -300 });
  });
});

describe('group and ungroup with members stored far away', () => {
  it('ungroups a group and a child that both sit at 1e308, clamping only the sum that overflows', () => {
    const store = createGroupedStore();
    placeFar(store, 'group-outer', 1e308);
    placeFar(store, 'rect-a', 1e308);
    applyCommand(store, ungroupCommand, { ids: ['group-outer'] });
    const child = mustGet(store, 'rect-a');
    expect(Number.isFinite(child.x)).toBe(true);
    expect(child.parentId).toBeNull();
  });

  it('groups two objects at opposite extremes, finite as computed', () => {
    const store = createFixtureStore();
    placeFar(store, 'image-photo', 1e308);
    placeFar(store, 'video-demo', -1e308);
    applyCommand(store, groupCommand, { ids: ['image-photo', 'video-demo'] });
    for (const id of ['image-photo', 'video-demo']) {
      expect(Number.isFinite(mustGet(store, id).x)).toBe(true);
    }
  });
});

describe('ungroup', () => {
  it('keeps a released child’s rotation in (−π, π]', () => {
    const store = createGroupedStore();
    applyCommand(store, rotateObjectsCommand, { rotations: [{ id: 'group-outer', by: 2 }] });
    applyCommand(store, rotateObjectsCommand, { rotations: [{ id: 'rect-a', by: 2 }] });
    applyCommand(store, ungroupCommand, { ids: ['group-outer'] });
    const rotation = mustGet(store, 'rect-a').rotation;
    expect(rotation).toBeGreaterThan(-Math.PI);
    expect(rotation).toBeLessThanOrEqual(Math.PI);
    // 0.4 + 2 for the group, 0 + 2 for the child: 4.4 turned back into range.
    expect(rotation).toBeCloseTo(4.4 - 2 * Math.PI, 9);
  });
});

describe('a stored vertex past the bound', () => {
  it('stays tolerated when an unrelated vertex before it is deleted', () => {
    const store = createFixtureStore();
    writeNetworkMemberRemotely(store, 'path-squiggle', 'vertices', {
      id: 'v3',
      x: FAR,
      y: 50,
      mirror: 'angle',
    } as never);
    applyCommand(store, editNetworkCommand, {
      id: 'path-squiggle',
      deleteVertexIds: ['v1'],
      deleteSegmentIds: ['s1'],
    });
    const path = mustGet(store, 'path-squiggle');
    if (path.type !== 'path') throw new Error('not a path');
    expect(path.vertices.map(({ id }) => id)).toEqual(['v2', 'v3']);
    expect(path.vertices[1]?.x).toBe(FAR);
  });
});

describe('an object placed far away', () => {
  it('takes a new segment within its box and a crop, and refuses a segment that reaches further out', () => {
    const store = createFixtureStore();
    placeFar(store, 'path-squiggle', 2 ** 31);
    const segmentTo = (x: number) => ({
      id: 'path-squiggle',
      setVertices: [{ id: 'v9', x, y: 0, mirror: 'none' as const }],
      setSegments: [{ id: 's9', a: 'v3', b: 'v9', ha: { x: -8, y: 0 }, hb: { x: 0, y: 0 } }],
    });
    // Its box runs from 2^31 to 2^31 + 200: a vertex at 300 would take it 100 further out.
    expectInvalidInput(store, editNetworkCommand, segmentTo(300));
    applyCommand(store, editNetworkCommand, segmentTo(150));
    placeFar(store, 'image-photo', 2 ** 31);
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'image-photo', style: { crop: { x: 0.1, y: 0.3, width: 0.7, height: 0.7 } } },
      ],
    });
    expect(mustGet(store, 'image-photo')).toMatchObject({ crop: { width: 0.7 } });
  });

  it('is moved back towards the bound and along, never further out; other fields are not held up', () => {
    const store = createFixtureStore();
    placeFar(store, 'image-photo', 2 ** 31);
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: -46, y: 3 } }],
    });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 2 ** 31 - 46, y: -297 });
    // Further out is what the bound stops, whatever else the command is about.
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: 47, y: 0 } }],
    });
    // Along, and in the other coordinate, is not.
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: 0, y: 20 } }],
    });
    // A wider box would carry its far edge out; a narrower, taller one brings it in.
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', by: { width: 5, height: 5 } }],
    });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', by: { width: -5, height: 5 } }],
    });
    expect(mustGet(store, 'image-photo')).toMatchObject({ width: 395, y: -277 });
  });
});

describe('a crop of an image stored with a far size', () => {
  it('refuses a crop whose box would carry an edge further out, and takes one once it is brought in', () => {
    const store = createFixtureStore();
    writeStoredEntriesRemotely(store, 'image-photo', { size: { width: 1e300, height: 300 } });
    // The image is drawn fitted in the middle of its box, near 5e299: a crop's box is the part
    // drawn, whose left edge would go from 900 to there.
    const crop = {
      changes: [
        { id: 'image-photo', style: { crop: { x: 0.1, y: 0.3, width: 0.7, height: 0.7 } } },
      ],
    };
    expectInvalidInput(store, setStyleCommand, crop);
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', to: { width: 400, height: 300 } }],
    });
    applyCommand(store, setStyleCommand, crop);
    const image = mustGet(store, 'image-photo');
    expect(image).toMatchObject({ crop: { width: 0.7 } });
    expect(Number.isFinite(image.x)).toBe(true);
  });
});

describe('a group resize with a descendant stored far away', () => {
  it('scales it down, and refuses to scale it up: no field ends further past the bound', () => {
    const store = createGroupedStore();
    writeStoredEntriesRemotely(store, 'rect-a', { size: { width: 2 ** 31, height: 50 } });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'group-outer', by: { width: -10, height: 0 } }],
    });
    const narrower = mustGet(store, 'rect-a');
    if (narrower.type !== 'shape') throw new Error('not a shape');
    expect(narrower.width).toBeLessThan(2 ** 31);
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'group-outer', by: { width: 20, height: 0 } }],
    });
  });
});

describe('a create past the bound stays refused', () => {
  it('is what the bound is for', () => {
    const store = createFixtureStore();
    const outcome = () =>
      applyCommand(store, createObjectCommand, {
        object: {
          type: 'frame',
          x: BOARD_BOUND + 1,
          y: 0,
          width: 1,
          height: 1,
          name: 'f',
          clip: false,
          background: null,
        },
      });
    expect(outcome).toThrow(/invalid-input/u);
  });
});
