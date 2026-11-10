import { describe, expect, it } from 'vitest';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import {
  B,
  BEYOND,
  expectInvalidInput,
  expectPastDrawable,
  frameAt,
} from './__fixtures__/bound-fixtures.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { createObjectCommand } from './create-object.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { rotateObjectsCommand } from './rotate-objects.js';
import { setLinePointsCommand } from './set-line-points.js';

// The board-wide bound: every object a command changes or carries keeps each extent of
// its box on the board within max(B, what it was). A command that would break it is refused with
// `invalid-input` and writes nothing: `expectInvalidInput` checks that the encoded state is
// byte-identical and that no change set and no update was delivered.

describe('moveObjects refuses a result past the bound', () => {
  it('a displacement or target past the bound', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: 1e308, y: 0 } }],
    });
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', to: { x: 0, y: -BEYOND } }],
    });
  });

  it('an object put at the bound, moved by 1 more', () => {
    const store = createFixtureStore();
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', to: { x: B, y: B } }],
    });
    expect(mustGet(store, 'comment-free')).toMatchObject({ x: B, y: B });
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', by: { x: 1, y: 0 } }],
    });
  });

  it('a box moved to a board position is judged by its far edge', () => {
    const store = createFixtureStore();
    const { width } = mustGet(store, 'image-photo') as { readonly width: number };
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', to: { x: B, y: 0 } }],
    });
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', to: { x: B - width, y: 0 } }],
    });
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: 1, y: 0 } }],
    });
  });

  it('a whole arrangement when one of its moves is past the bound: nothing is written', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [
        { id: 'image-photo', by: { x: 10, y: 0 } },
        { id: 'video-demo', to: { x: BEYOND, y: 0 } },
        { id: 'comment-free', by: { x: 0, y: 10 } },
      ],
    });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 900 });
  });

  it('an object taken into a frame is judged by where it lands, not by its number in the frame', () => {
    const store = createFixtureStore();
    // frame-plan sits at (-400, -300): the board point (B, 0) is (B + 400, 300) in its frame.
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', to: { x: B, y: 0 }, parentId: 'frame-plan' }],
    });
    expect(mustGet(store, 'comment-free')).toMatchObject({ parentId: 'frame-plan', x: B + 400 });
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', by: { x: 1, y: 0 } }],
    });
  });
});

describe('resizeObjects refuses a result past the bound', () => {
  it('a size, a change of size or an origin past the bound', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', to: { width: BEYOND, height: 10 } }],
    });
    expectPastDrawable(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', by: { width: 1e308, height: 0 } }],
    });
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', to: { width: 10, height: 10 }, origin: { x: BEYOND, y: 0 } }],
    });
  });

  it('a change of size that lands past the bound', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', by: { width: B, height: 0 } }],
    });
  });

  it('a size of 2B from edge to edge is accepted, and one more world unit of change is not', () => {
    const store = createFixtureStore();
    applyCommand(store, resizeObjectsCommand, {
      resizes: [
        { id: 'sticky-idea', to: { width: 2 * B, height: 2 * B }, origin: { x: -B, y: -B } },
      ],
    });
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'sticky-idea', by: { width: 1, height: 0 } }],
    });
  });

  it('a group whose new origin lands past the bound in its parent frame is refused', () => {
    const store = createGroupedStore();
    // group-inner sits in the turned group-outer: the board point (B, -B) is at about -1.3 B there.
    expect(mustGet(store, 'group-inner').parentId).toBe('group-outer');
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'group-inner', by: { width: 5, height: 5 }, origin: { x: B, y: -B } }],
    });
  });

  it('a group resize by an amount past the bound is refused as it comes in', () => {
    const store = createGroupedStore();
    expectPastDrawable(store, resizeObjectsCommand, {
      resizes: [{ id: 'group-outer', by: { width: 1e300, height: 0 } }],
    });
  });

  it('a group whose scaling would carry a descendant past the bound is refused by its result', () => {
    const store = createGroupedStore();
    // The first change fits: every descendant stays inside a box of about B.
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'group-outer', by: { width: B, height: 0 } }],
    });
    // The second would carry them to 1.6 B.
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 'group-outer', by: { width: B, height: 0 } }],
    });
  });
});

describe('rotateObjects refuses a result past the bound', () => {
  it('a turn about a far pivot that swings the object out is refused; any angle is normalised', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, rotateObjectsCommand, {
      rotations: [{ id: 'image-photo', by: 1, about: { x: 1e308, y: 0 } }],
    });
    applyCommand(store, rotateObjectsCommand, { rotations: [{ id: 'image-photo', by: 1e308 }] });
    expect(Math.abs(mustGet(store, 'image-photo').rotation)).toBeLessThanOrEqual(Math.PI);
  });

  it('a turn that carries the object past the bound is refused, and one that keeps it in is not', () => {
    const store = createFixtureStore();
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', to: { x: B, y: B } }],
    });
    // (B, B) turned by 45 degrees about the origin is (0, B sqrt 2).
    expectInvalidInput(store, rotateObjectsCommand, {
      rotations: [{ id: 'comment-free', by: Math.PI / 4, about: { x: 0, y: 0 } }],
    });
    // A quarter turn about the origin keeps it on the bound: (B, B) becomes (-B, B).
    applyCommand(store, rotateObjectsCommand, {
      rotations: [{ id: 'comment-free', by: Math.PI / 2, about: { x: 0, y: 0 } }],
    });
    expect(mustGet(store, 'comment-free').x).toBeCloseTo(-B, 0);
  });
});

describe('setLinePoints refuses a result past the bound', () => {
  it('accepts 1e308 nowhere: a point at 1e308 is refused', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, setLinePointsCommand, {
      id: 'line-divider',
      end: 1,
      point: { x: 1e308, y: 0 },
    });
  });

  it('judges an end by where it lands on the board, not by its number in the line frame', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, setLinePointsCommand, {
      id: 'line-divider',
      end: 1,
      point: { x: B + 1, y: 0 },
    });
    // line-divider sits at (-400, 700): the board point (B, B) is (B + 400, B - 700) in its frame.
    applyCommand(store, setLinePointsCommand, {
      id: 'line-divider',
      end: 1,
      point: { x: B, y: B },
    });
    expect(mustGet(store, 'line-divider')).toMatchObject({ points: [{}, { x: B + 400 }] });
  });

  it('accepts two far-apart ends at the bound, whose bounds stay finite', () => {
    const store = createFixtureStore();
    applyCommand(store, createObjectCommand, {
      object: {
        type: 'line',
        id: 'far-line',
        x: 0,
        y: 0,
        points: [
          { x: -B, y: -B },
          { x: 10, y: 10 },
        ],
        route: 'straight',
        stroke: { color: [0, 0, 0, 1], width: 2 },
        startCap: 'none',
        endCap: 'none',
      },
    });
    applyCommand(store, setLinePointsCommand, { id: 'far-line', end: 1, point: { x: B, y: B } });
    const line = mustGet(store, 'far-line');
    if (line.type !== 'line') throw new Error('not a line');
    const [start, end] = line.points;
    expect(Number.isFinite(Math.hypot(end.x - start.x, end.y - start.y))).toBe(true);
    expectInvalidInput(store, setLinePointsCommand, {
      id: 'far-line',
      end: 1,
      point: { x: B, y: BEYOND },
    });
  });
});

describe('NaN and the infinities are refused as numbers', () => {
  it.each([Number.NaN, Infinity, -Infinity])('%s', (value) => {
    const store = createFixtureStore();
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: value, y: 0 } }],
    });
    expectInvalidInput(store, createObjectCommand, { object: { ...frameAt(value, 0) } });
    expectInvalidInput(store, setLinePointsCommand, {
      id: 'line-divider',
      end: 0,
      point: { x: 0, y: value },
    });
    expectInvalidInput(store, rotateObjectsCommand, {
      rotations: [{ id: 'image-photo', by: value }],
    });
  });
});
