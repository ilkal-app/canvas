import { expect, it } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { SceneSourceMirror } from './scene-source-mirror.js';
import { TranslationChangeEncoder } from './translation-change-set.js';

it('sends a shared translation instead of every object, including cancellation and deletion', () => {
  const document = new FakeSceneDocument();
  const mirror = new SceneSourceMirror();
  const encoder = new TranslationChangeEncoder();
  document.create(shapeObject('a'), shapeObject('b'));
  mirror.apply(encoder.encode(document.takeChanges()));
  for (const x of [10, 30, 0]) {
    document.update('a', { x });
    document.update('b', { x });
    const message = encoder.encode(document.takeChanges());
    expect(message.translation?.ids).toEqual(['a', 'b']);
    expect(message.objects).toEqual({});
    mirror.apply(message);
    expect(mirror.get(shapeObject('a').id)).toEqual(document.get(shapeObject('a').id));
    expect(mirror.get(shapeObject('b').id)).toEqual(document.get(shapeObject('b').id));
  }
  document.delete('a');
  mirror.apply(encoder.encode(document.takeChanges()));
  expect(mirror.get(shapeObject('a').id)).toBeUndefined();
});

it('keeps full objects for a concurrent restyle or unequal movement and mirrors them exactly', () => {
  const document = new FakeSceneDocument();
  const mirror = new SceneSourceMirror();
  const encoder = new TranslationChangeEncoder();
  document.create(shapeObject('a'), shapeObject('b'));
  mirror.apply(encoder.encode(document.takeChanges()));
  document.update('a', { x: 10, rotation: 1 });
  document.update('b', { x: 20 });
  const message = encoder.encode(document.takeChanges());
  expect(message.objects.a).toBeDefined();
  mirror.apply(message);
  for (const id of [shapeObject('a').id, shapeObject('b').id]) {
    expect(mirror.get(id)).toEqual(document.get(id));
  }
});

it('forgets the prior host on clear and safely handles missing and magic ids', () => {
  const document = new FakeSceneDocument();
  const mirror = new SceneSourceMirror();
  const encoder = new TranslationChangeEncoder();
  document.create(shapeObject('__proto__'), shapeObject('toString'));
  mirror.apply(encoder.encode(document.takeChanges()));
  document.update('__proto__', { x: 12 });
  encoder.clear();
  const full = encoder.encode(document.takeChanges());
  expect(full.translation).toBeUndefined();
  expect(Object.hasOwn(full.objects, '__proto__')).toBe(true);
  mirror.apply(full);
  expect(mirror.get(shapeObject('__proto__').id)?.x).toBe(12);
});

it('keeps a large preview compact and replayable after the renderer is rebuilt', () => {
  const document = new FakeSceneDocument();
  const encoder = new TranslationChangeEncoder();
  const mirror = new SceneSourceMirror();
  const objects = Array.from({ length: 1000 }, (unused, index) =>
    shapeObject(`s-${String(index)}`),
  );
  document.create(...objects);
  mirror.apply(encoder.encode(document.takeChanges()));
  for (const object of objects) document.update(object.id, { x: 100, y: 50 });
  const message = encoder.encode(document.takeChanges());
  expect(message.translation).toEqual({ ids: objects.map(({ id }) => id), x: 100, y: 50 });
  expect(message.objects).toEqual({});
  mirror.apply(message);
  const replay = mirror.everything();
  expect(replay.created).toHaveLength(1000);
  for (const object of objects) expect(replay.get(object.id)).toEqual(document.get(object.id));
});
