import { describe, expect, it } from 'vitest';

import { createFixtureStore, fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import {
  B,
  BEYOND,
  expectInvalidInput,
  expectPastDrawable,
  frameAt,
} from './__fixtures__/bound-fixtures.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';

// The board-wide bound: a new object's box on the board, resolved through its parents,
// lies within ±BOARD_BOUND, and its values that are not positions within their limits. A command
// that would leave one outside is refused with `invalid-input` and writes nothing:
// `expectInvalidInput` checks that the encoded state is byte-identical and that no change set and
// no update was delivered.

describe('createObject and createObjects refuse a coordinate or size past the bound', () => {
  it('createObject refuses a huge width as one the relay would refuse, naming it', () => {
    const store = createFixtureStore();
    const errors = expectPastDrawable(store, createObjectCommand, {
      object: { ...frameAt(0, 0), width: 1e308 },
    });
    expect(errors).toHaveLength(1);
  });

  it.each([
    ['x past the bound', { x: BEYOND }],
    ['y at -1e308', { y: -1e308 }],
    ['a height past the bound', { height: BEYOND }],
    ['a rotation past the bound', { rotation: BEYOND }],
  ])('createObject refuses %s', (label, patch) => {
    const store = createFixtureStore();
    const errors = expectInvalidInput(store, createObjectCommand, {
      object: { ...frameAt(0, 0), ...patch },
    });
    expect(errors).toHaveLength(1);
  });

  it('createObject refuses a box whose far edge passes the bound though x and width do not', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, createObjectCommand, {
      object: { ...frameAt(1, 0), width: B },
    });
  });

  it('createObject refuses a box a rotation turns past the bound', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, createObjectCommand, {
      object: { ...frameAt(0, 0), width: B, height: B, rotation: Math.PI / 4 },
    });
  });

  it('createObject accepts a box exactly at the bound', () => {
    const store = createFixtureStore();
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(-B, -B), id: 'low', width: B, height: B },
    });
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(0, 0), id: 'high', width: B, height: B },
    });
    expect(mustGet(store, 'high')).toMatchObject({ x: 0, width: B });
  });

  it('createObject refuses a line point, a free connector end and a path vertex past the bound', () => {
    const store = createFixtureStore();
    const line = {
      type: 'line',
      x: 0,
      y: 0,
      points: [
        { x: 0, y: 0 },
        { x: 1e308, y: 0 },
      ],
      route: 'straight',
      stroke: { color: [0, 0, 0, 1], width: 2 },
      startCap: 'none',
      endCap: 'none',
    };
    expectInvalidInput(store, createObjectCommand, { object: line });
    const connector = {
      type: 'connector',
      x: 0,
      y: 0,
      from: { kind: 'point', x: 0, y: -BEYOND },
      to: { kind: 'point', x: 5, y: 5 },
      route: 'straight',
      stroke: { color: [0, 0, 0, 1], width: 2 },
      startCap: 'none',
      endCap: 'none',
      label: null,
    };
    expectInvalidInput(store, createObjectCommand, { object: connector });
    const path = {
      type: 'path',
      x: 0,
      y: 0,
      vertices: [{ id: 'v1', x: BEYOND, y: 0, mirror: 'none' }],
      segments: [],
      stroke: null,
      fill: null,
    };
    expectInvalidInput(store, createObjectCommand, { object: path });
  });

  it('createObject refuses a line whose end lands past the bound in the parent frame', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, createObjectCommand, {
      object: {
        type: 'line',
        x: B,
        y: 0,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        route: 'straight',
        stroke: { color: [0, 0, 0, 1], width: 2 },
        startCap: 'none',
        endCap: 'none',
      },
    });
  });

  it('createObject refuses a comment pin offset and a shape corner radius past the bound', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, createObjectCommand, {
      object: {
        type: 'comment',
        x: 0,
        y: 0,
        threadId: 't-1',
        anchor: { kind: 'object', objectId: 'shape-box', offset: { x: BEYOND, y: 0 } },
      },
    });
    expectInvalidInput(store, createObjectCommand, {
      object: {
        type: 'shape',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        kind: 'rectangle',
        stroke: null,
        fill: null,
        cornerRadius: 1e308,
        sides: 4,
        label: null,
      },
    });
  });

  it('createObject refuses an image whose crop puts its whole source image past the bound', () => {
    const store = createFixtureStore();
    const photo = fixtureObject('image-photo', 'image');
    expectInvalidInput(store, createObjectCommand, {
      object: {
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        assetId: photo.assetId,
        crop: { x: 0.5, y: 0.5, width: 1e-9, height: 1e-9 },
        naturalSize: { width: 100, height: 100 },
        opacity: 1,
      },
    });
  });

  it('createObjects refuses one entry past the bound, naming it, and writes none of the others', () => {
    const store = createFixtureStore();
    const errors = expectInvalidInput(store, createObjectsCommand, {
      objects: [frameAt(0, 0), frameAt(-BEYOND, 0)],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('minX');
  });

  it('createObjects judges a list pasted into a frame by where it lands on the board', () => {
    const store = createFixtureStore();
    // frame-plan sits at (-400, -300): x = B + 350 in it is B - 50 on the board.
    expectInvalidInput(store, createObjectsCommand, {
      objects: [{ ...frameAt(B + 350, 0), width: 100 }],
      parentId: 'frame-plan',
    });
    applyCommand(store, createObjectsCommand, {
      objects: [{ ...frameAt(B + 300, 0), width: 100 }],
      parentId: 'frame-plan',
    });
  });
});
