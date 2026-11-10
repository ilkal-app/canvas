import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

describe('SceneSourceMirror', () => {
  it('holds the touched objects and forgets deleted ones', () => {
    const document = new FakeSceneDocument();
    const mirror = new SceneSourceMirror();
    document.create(shapeObject('a'), shapeObject('b'));
    mirror.apply(serializeChangeSet(document.takeChanges()));
    document.update('a', { x: 3 });
    document.delete('b');
    mirror.apply(serializeChangeSet(document.takeChanges()));
    expect(mirror.get(shapeObject('a').id)).toMatchObject({ x: 3 });
    expect(mirror.get(shapeObject('b').id)).toBeUndefined();
    expect(mirror.size).toBe(1);
  });

  it('returns a change set with the same ids that reads the mirror', () => {
    const document = new FakeSceneDocument();
    const mirror = new SceneSourceMirror();
    document.create(frameObject('f'), shapeObject('s', { parentId: 'f' }));
    const changes = mirror.apply(serializeChangeSet(document.takeChanges()));
    expect(changes.created).toEqual(['f', 's']);
    expect(changes.get(frameObject('f').id)).toBe(mirror.get(frameObject('f').id));
  });

  it('treats an id listed as deleted but present in the objects as present, as a change set does', () => {
    const mirror = new SceneSourceMirror();
    const object = shapeObject('a');
    const changes = mirror.apply({
      created: [],
      updated: [],
      deleted: [object.id],
      objects: { a: object },
    });
    expect(changes.get(object.id)).toBe(object);
  });

  it('feeds a SceneRenderer the same records as the document it mirrors', () => {
    const document = new FakeSceneDocument();
    const mirror = new SceneSourceMirror();
    const direct = new SceneRenderer(new FakeGpuBackend());
    const mirrored = new SceneRenderer(new FakeGpuBackend());
    document.create(frameObject('f', { x: 7, rotation: 0.5 }));
    document.create(shapeObject('s', { parentId: 'f', x: 2 }));
    let changes = document.takeChanges();
    direct.scene.apply(changes);
    mirrored.scene.apply(mirror.apply(serializeChangeSet(changes)));
    document.update('f', { x: 9 });
    changes = document.takeChanges();
    direct.scene.apply(changes);
    mirrored.scene.apply(mirror.apply(serializeChangeSet(changes)));
    const records = (renderer: SceneRenderer): number[] => [
      ...renderer.scene.instanceBufferOf('solid-rect').data,
    ];
    expect(records(mirrored)).toEqual(records(direct));
  });
});
