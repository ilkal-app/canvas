import { expect, it } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { isRetainedMoveCommand } from './retained-move-command.js';

it('accepts finite absolute double positions and explicitly ordered session messages', () => {
  expect(
    isRetainedMoveCommand({
      kind: 'begin',
      session: 1,
      sequence: 0,
      objects: [shapeObject('a')],
      positions: new Float64Array([1e12 + 0.125, -0]),
    }),
  ).toBe(true);
  expect(
    isRetainedMoveCommand({
      kind: 'update',
      session: 1,
      sequence: 2,
      positions: new Float64Array([1, 2]),
    }),
  ).toBe(true);
  expect(isRetainedMoveCommand({ kind: 'end', session: 1, sequence: 3 })).toBe(true);
});

it('refuses malformed sessions and positions before any mirror mutation', () => {
  const valid = { kind: 'update', session: 1, sequence: 2, positions: new Float64Array([1, 2]) };
  for (const patch of [
    { session: 0 },
    { session: 1.5 },
    { sequence: -1 },
    { sequence: Infinity },
    { positions: [1, 2] },
    { positions: new Float32Array([1, 2]) },
    { positions: new Float64Array([1]) },
    { positions: new Float64Array([NaN, 0]) },
    { positions: new Float64Array([Infinity, 0]) },
    { kind: 'other' },
  ])
    expect(isRetainedMoveCommand({ ...valid, ...patch })).toBe(false);
  expect(isRetainedMoveCommand(null)).toBe(false);
  expect(isRetainedMoveCommand({ ...valid, kind: 'begin', objects: [] })).toBe(false);
  expect(
    isRetainedMoveCommand({
      ...valid,
      kind: 'begin',
      objects: [shapeObject('a'), shapeObject('a')],
      positions: new Float64Array(4),
    }),
  ).toBe(false);
  expect(
    isRetainedMoveCommand({
      ...valid,
      kind: 'begin',
      objects: [{ ...shapeObject('a'), parentId: 'parent' }],
    }),
  ).toBe(false);
});
