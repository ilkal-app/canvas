import { expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { RetainedMoveMirror } from './retained-move-mirror.js';

it('keeps absolute positions, stable geometry and lazy snapshot identity', () => {
  const mirror = new RetainedMoveMirror();
  const base = shapeObject('a');
  const begin = {
    kind: 'begin' as const,
    session: 1,
    sequence: 0,
    objects: [base],
    positions: new Float64Array([1e12 + 0.125, -0]),
  };
  expect(mirror.accepts(begin)).toBe(true);
  mirror.apply(begin);
  const first = mirror.get(base.id);
  expect(first).toMatchObject({ x: 1e12 + 0.125, y: -0 });
  expect(mirror.get(base.id)).toBe(first);
  const update = {
    kind: 'update' as const,
    session: 1,
    sequence: 1,
    positions: new Float64Array([0.1, 0.2]),
  };
  expect(mirror.accepts(update)).toBe(true);
  mirror.apply(update);
  expect(mirror.current?.objects).toBe(begin.objects);
  expect(mirror.get(base.id)).toEqual({ ...base, x: 0.1, y: 0.2 });
  expect(first?.x).toBe(1e12 + 0.125);
  expect(mirror.get('missing' as ObjectId)).toBeUndefined();
});

it('rejects delayed, wrong-size and ended updates without modifying current positions', () => {
  const mirror = new RetainedMoveMirror();
  mirror.apply({
    kind: 'begin',
    session: 2,
    sequence: 5,
    objects: [shapeObject('a')],
    positions: new Float64Array([1, 2]),
  });
  const before = mirror.current;
  for (const command of [
    { kind: 'update' as const, session: 1, sequence: 6, positions: new Float64Array([3, 4]) },
    { kind: 'update' as const, session: 2, sequence: 5, positions: new Float64Array([3, 4]) },
    { kind: 'update' as const, session: 2, sequence: 6, positions: new Float64Array(4) },
    {
      kind: 'begin' as const,
      session: 2,
      sequence: 6,
      objects: [shapeObject('a')],
      positions: new Float64Array([3, 4]),
    },
  ])
    expect(mirror.accepts(command)).toBe(false);
  expect(mirror.current).toBe(before);
  mirror.apply({ kind: 'end', session: 2, sequence: 6 });
  expect(mirror.current).toBeUndefined();
  expect(
    mirror.accepts({
      kind: 'update',
      session: 2,
      sequence: 7,
      positions: new Float64Array([3, 4]),
    }),
  ).toBe(false);
});

it('reads a materialized member directly without repeating membership and position lookup', () => {
  const mirror = new RetainedMoveMirror();
  const object = shapeObject('cached');
  mirror.apply({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [object],
    positions: new Float64Array([10, 20]),
  });
  const expected = mirror.get(object.id);
  const reads = vi.spyOn(Map.prototype, 'get');
  const values = [];
  for (let index = 0; index < 100; index++) values.push(mirror.get(object.id));
  const count = reads.mock.calls.length;
  reads.mockRestore();
  expect(count).toBe(100);
  expect(values.every((value) => value === expected)).toBe(true);
});

it('reuses membership storage across updates while returning fresh immutable snapshots', () => {
  const mirror = new RetainedMoveMirror();
  const base = shapeObject('stable');
  mirror.apply({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [base],
    positions: new Float64Array([1, 2]),
  });
  const first = mirror.get(base.id);
  const writes = vi.spyOn(Map.prototype, 'set');
  mirror.apply({ kind: 'update', session: 1, sequence: 1, positions: new Float64Array([3, 4]) });
  const second = mirror.get(base.id);
  const count = writes.mock.calls.length;
  writes.mockRestore();
  expect(count).toBe(0);
  expect(second).toEqual({ ...base, x: 3, y: 4 });
  expect(second).not.toBe(first);
  expect(first).toEqual({ ...base, x: 1, y: 2 });
  mirror.apply({
    kind: 'begin',
    session: 2,
    sequence: 1,
    objects: [base],
    positions: new Float64Array([5, 6]),
  });
  expect(mirror.get(base.id)).toEqual({ ...base, x: 5, y: 6 });
});
