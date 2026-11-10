import { expect, it } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { SceneSourceMirror } from './scene-source-mirror.js';
import type { SerializableChangeSet } from './serializable-change-set.js';

it('batches ordered translations exactly across replacements, deletion and recreation', () => {
  const a = shapeObject('a', { x: 1e16 });
  const b = shapeObject('b', { x: 9 });
  const step = (x: number): SerializableChangeSet => ({
    created: [],
    updated: [a.id, b.id],
    deleted: [],
    objects: {},
    translation: { ids: [a.id, b.id, a.id], x, y: 0.1 },
  });
  const stream: SerializableChangeSet[] = [
    { created: [a.id, b.id], updated: [], deleted: [], objects: { a, b } },
    step(1),
    step(-1e16),
    step(0.25),
    { created: [], updated: [b.id], deleted: [a.id], objects: { b: { ...b, x: 42 } } },
    step(0.3),
    { created: [a.id], updated: [], deleted: [], objects: { a } },
    step(0.4),
    step(-0.2),
  ];
  const sequential = new SceneSourceMirror();
  for (const changes of stream) sequential.apply(changes);
  const batched = new SceneSourceMirror();
  const result = batched.applyBatch(stream);
  expect(batched.get(a.id)).toEqual(sequential.get(a.id));
  expect(batched.get(b.id)).toEqual(sequential.get(b.id));
  expect(result?.get(a.id)).toBe(batched.get(a.id));
  expect(result?.created).toEqual([a.id, b.id]);
  expect(result?.deleted).toEqual([a.id]);
  expect(a.x).toBe(1e16);
  expect(b.x).toBe(9);
  expect(batched.applyBatch([])).toBeUndefined();
});
