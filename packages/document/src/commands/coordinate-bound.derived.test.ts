import { describe, expect, it } from 'vitest';

import { findValueLimitIssues } from '@canvas/schema';

import {
  readStoredEntry,
  writeStoredEntriesRemotely,
} from '../store/__fixtures__/remote-values.js';
import { BODY, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import {
  B,
  BEYOND,
  expectInvalidInput,
  expectPastDrawable,
  frameAt,
} from './__fixtures__/bound-fixtures.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { connectCommand } from './connect.js';
import { createObjectCommand } from './create-object.js';
import { editNetworkCommand } from './edit-network.js';
import { groupCommand } from './group.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { setStyleCommand } from './set-style.js';
import { setTextRunsCommand } from './set-text-runs.js';
import { ungroupCommand } from './ungroup.js';

// The board-wide bound: every object a command changes or carries keeps each extent of
// its box on the board within max(B, what it was), and each value that is not a position within
// its limit or no further past it. A command that would break it is refused with `invalid-input`
// and writes nothing: `expectInvalidInput` checks that the encoded state is byte-identical and
// that no change set and no update was delivered.

describe('editNetwork refuses a vertex or handle past the bound', () => {
  const vertex = (x: number, y: number) => ({ id: 'v9', x, y, mirror: 'none' as const });

  it('a vertex or a handle control point past the bound on the board', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, editNetworkCommand, {
      id: 'path-squiggle',
      setVertices: [{ ...vertex(1e308, 0), id: 'v1' }],
    });
    // path-squiggle sits at x = -300: a control point at B + 400 in its frame is B + 100 on the
    // board, one at BEYOND is inside.
    const handle = (x: number) => ({
      id: 'path-squiggle',
      setSegments: [{ id: 's1', a: 'v1', b: 'v2', ha: { x, y: 0 }, hb: { x: 0, y: 0 } }],
    });
    expectInvalidInput(store, editNetworkCommand, handle(B + 400));
    applyCommand(store, editNetworkCommand, handle(BEYOND));
  });

  it('a handle whose control point passes the bound although its vertex does not', () => {
    const store = createFixtureStore();
    // At B + 300 in the path's frame, the vertex is at B on the board.
    const joined = (handle: number) => ({
      id: 'path-squiggle',
      setVertices: [vertex(B + 300, 0)],
      setSegments: [{ id: 's3', a: 'v9', b: 'v1', ha: { x: handle, y: 0 }, hb: { x: 0, y: 0 } }],
    });
    expectInvalidInput(store, editNetworkCommand, joined(5));
    applyCommand(store, editNetworkCommand, joined(0));
  });
});

describe('connect refuses a free end past the bound', () => {
  it('a free end past the bound is refused, and so is one a frame offset takes past it', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, connectCommand, {
      from: { objectId: 'shape-box' },
      to: { point: { x: 1e308, y: 0 } },
    });
    // frame-plan sits at (-400, -300): the board point (B + 1, 0) is (B + 401, 300) in its frame,
    // and one unit past the bound on the board.
    expectInvalidInput(store, connectCommand, {
      from: { objectId: 'sticky-idea' },
      to: { point: { x: B + 1, y: 0 } },
      parentId: 'frame-plan',
    });
    applyCommand(store, connectCommand, {
      id: 'near-connector',
      from: { objectId: 'sticky-idea' },
      to: { point: { x: B - 500, y: 0 } },
      parentId: 'frame-plan',
    });
    expect(mustGet(store, 'near-connector')).toMatchObject({ to: { kind: 'point', x: B - 100 } });
  });
});

describe('setStyle and setTextRuns refuse a size past the bound', () => {
  it('a measured size past the bound', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, setStyleCommand, {
      changes: [
        {
          id: 'text-title',
          style: { textStyle: { fontSize: 30 } },
          size: { width: 2 * B, height: 10 },
        },
      ],
    });
    expectPastDrawable(store, setTextRunsCommand, {
      id: 'text-title',
      text: 'x',
      runs: [{ length: 1, style: BODY }],
      size: { width: 10, height: 1e308 },
    });
  });

  it('a text width that brings the far edge of a box to the bound is accepted, one past it is not', () => {
    const store = createFixtureStore();
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'text-title', to: { x: B - 1000, y: 0 } }],
    });
    const sized = (width: number) => ({
      id: 'text-title',
      text: 'x',
      runs: [{ length: 1, style: BODY }],
      size: { width, height: 10 },
    });
    expectInvalidInput(store, setTextRunsCommand, sized(1001));
    applyCommand(store, setTextRunsCommand, sized(1000));
    expect(mustGet(store, 'text-title')).toMatchObject({ width: 1000 });
  });
});

describe('an image crop', () => {
  it('keeps the whole source image at its scale, so a tiny crop stays within the bound', () => {
    const store = createFixtureStore();
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'image-photo', style: { crop: { x: 0.5, y: 0.5, width: 1e-9, height: 1e-9 } } },
      ],
    });
    const image = mustGet(store, 'image-photo');
    expect(findValueLimitIssues(image)).toEqual([]);
    expect(image).toMatchObject({ crop: { width: 1e-9 } });
  });

  it('leaves an image alone whose stored crop already puts the whole image past the bound', () => {
    const store = createFixtureStore();
    // A crop written on its own (a peer's, merged with another's resize) beside a box of 400 x 300.
    const style = readStoredEntry(store, 'image-photo', 'style') as Record<string, unknown>;
    writeStoredEntriesRemotely(store, 'image-photo', {
      style: { ...style, crop: { x: 0.5, y: 0.5, width: 1e-9, height: 1e-9 } },
    });
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'image-photo', to: { x: 5, y: 5 } }] });
    // The whole image is 4e11 wide: a smaller box brings it in, a bigger one would push it out.
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', to: { width: 300, height: 300 } }],
    });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 5, width: 300 });
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', to: { width: 600, height: 450 } }],
    });
  });
});

describe('group and ungroup store the coordinates they re-express as computed', () => {
  it('grouping two objects B apart on both sides of the origin puts a member at 2B', () => {
    const store = createFixtureStore();
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(-B, 0), id: 'left', width: 0, height: 0 },
    });
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(B, 0), id: 'right', width: 0, height: 0 },
    });
    applyCommand(store, groupCommand, { ids: ['left', 'right'] });
    expect(mustGet(store, 'right').x).toBe(2 * B);
  });

  it('ungrouping a group holding a child placed past the bound releases it where it is', () => {
    const store = createFixtureStore();
    applyCommand(store, createObjectCommand, {
      object: { type: 'group', id: 'far-group', x: B, y: 0 },
    });
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(0, 0), id: 'far-child', width: 0, height: 0, parentId: 'far-group' },
    });
    // A peer puts the child B further out: it lies at 2B on the board.
    const placement = readStoredEntry(store, 'far-child', 'placement') as Record<string, unknown>;
    writeStoredEntriesRemotely(store, 'far-child', { placement: { ...placement, x: B } });
    applyCommand(store, ungroupCommand, { ids: ['far-group'] });
    expect(mustGet(store, 'far-child')).toMatchObject({ parentId: null, x: 2 * B });
  });
});

describe('an object already past a derived bound stays editable', () => {
  // Reading is tolerant: a stored box whose far edge is past the bound (a peer that skips
  // validation wrote it) is on the board, and a write that leaves its geometry alone is not
  // refused for it. Changing the geometry is checked again.
  function storeWithOverlongFrame() {
    const store = createFixtureStore();
    const placement = readStoredEntry(store, 'frame-plan', 'placement') as Record<string, unknown>;
    writeStoredEntriesRemotely(store, 'frame-plan', {
      placement: { ...placement, x: 100 },
      size: { width: B, height: 900 },
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ x: 100, width: B });
    return store;
  }

  it('is restyled without a refusal', () => {
    const store = storeWithOverlongFrame();
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { background: [0, 0, 0, 1] } }],
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ background: [0, 0, 0, 1] });
  });

  it('is refused a resize that makes it reach further, and accepted one that brings it back', () => {
    const store = storeWithOverlongFrame();
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'frame-plan', by: { width: 5, height: 0 } }],
    });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'frame-plan', to: { width: B - 100, height: 900 } }],
    });
  });
});
