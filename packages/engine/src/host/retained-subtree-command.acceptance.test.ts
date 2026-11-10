import { expect, it } from 'vitest';

import { frameObject, groupObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { isRetainedMoveCommand } from './retained-move-command.js';

it('accepts roots-only begin commands for non-clipping frames, groups and leaves', () => {
  const roots = [frameObject('frame'), groupObject('group'), shapeObject('leaf')];
  expect(
    isRetainedMoveCommand({
      kind: 'begin',
      session: 1,
      sequence: 0,
      objects: roots,
      positions: new Float64Array(roots.flatMap(({ x, y }) => [x, y])),
    }),
  ).toBe(true);
});

it('refuses a clipping frame in a roots-only begin command', () => {
  const root = frameObject('clip', { clip: true });
  expect(
    isRetainedMoveCommand({
      kind: 'begin',
      session: 1,
      sequence: 0,
      objects: [root],
      positions: new Float64Array([root.x, root.y]),
    }),
  ).toBe(false);
});
