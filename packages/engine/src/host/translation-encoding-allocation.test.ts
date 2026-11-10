import { expect, it, vi } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { TranslationChangeEncoder } from './translation-change-set.js';

it('builds only the final transport record for a large compact translation', () => {
  const document = new FakeSceneDocument();
  const encoder = new TranslationChangeEncoder();
  const initial = shapeObject('a');
  document.create(initial);
  encoder.encode(document.takeChanges());
  document.update('a', { x: 1 });
  const changes = document.takeChanges();
  const records = vi.spyOn(Object, 'fromEntries');
  let calls: number;
  let result;
  try {
    result = encoder.encode(changes);
    calls = records.mock.calls.length;
  } finally {
    records.mockRestore();
  }
  expect(calls).toBe(1);
  expect(result.translation?.ids).toEqual([initial.id]);
  expect(result.objects).toEqual({});
});

it('keeps a full object when one undefined own field is replaced by a different own field', () => {
  const encoder = new TranslationChangeEncoder();
  const before = { ...shapeObject('a'), oldField: undefined };
  const after = { ...shapeObject('a'), x: before.x + 1, newField: undefined };
  encoder.encode({ created: [before.id], updated: [], deleted: [], get: () => before });
  const result = encoder.encode({
    created: [],
    updated: [after.id],
    deleted: [],
    get: () => after,
  });
  expect(result.translation).toBeUndefined();
  expect(Object.hasOwn(result.objects.a ?? {}, 'newField')).toBe(true);
  expect(Object.hasOwn(result.objects.a ?? {}, 'oldField')).toBe(false);
});
