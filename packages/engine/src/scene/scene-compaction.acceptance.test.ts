import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeSceneDocument } from './__fixtures__/scene-objects.js';
import type { ScenePass } from './scene-pass.js';
import { Scene } from './scene.js';
import { TEXT_PASS, textObject } from './segments/__fixtures__/note-and-text-passes.js';

interface CompactableScene extends Scene {
  compactSlots(passName: string, ids: readonly ObjectId[]): number;
}

function fixture(): CompactableScene {
  const scene = new Scene([TEXT_PASS]);
  const document = new FakeSceneDocument();
  document.create(
    textObject('c', { text: 'cc' }),
    textObject('spare', { text: 's' }),
    textObject('b', { text: 'bb' }),
    textObject('a', { text: 'aa' }),
  );
  scene.apply(document.takeChanges());
  return scene;
}

describe('Scene.compactSlots', () => {
  it('rewrites multi-record objects into requested order and leaves unlisted slots untouched', () => {
    const scene = fixture();
    const spare = scene.slotsOf('spare' as ObjectId, 'text').slice();
    const before = ['a', 'b', 'c'].map((id) => scene.slotRevisionOf(id as ObjectId, 'text'));
    const rewritten = scene.compactSlots('text', ['a', 'b', 'c'] as ObjectId[]);
    expect(rewritten).toBe(6);
    expect(scene.slotsOf('spare' as ObjectId, 'text')).toEqual(spare);
    const slots = ['a', 'b', 'c'].flatMap((id) => scene.slotsOf(id as ObjectId, 'text'));
    expect(slots).toEqual([...slots].sort((left, right) => left - right));
    expect(['a', 'b', 'c'].map((id) => scene.slotRevisionOf(id as ObjectId, 'text'))).not.toEqual(
      before,
    );
  });

  it('keeps each record’s page when re-slotting a paged pass', () => {
    const pass: ScenePass = {
      ...TEXT_PASS,
      pageOf: (target, record) => {
        expect(target.object).toBeDefined();
        return record % 2;
      },
    };
    const scene = new Scene([pass]);
    const document = new FakeSceneDocument();
    document.create(textObject('b', { text: 'abc' }), textObject('a', { text: 'abc' }));
    scene.apply(document.takeChanges());
    const before = scene.pageRevisionOf('text');
    expect(scene.compactSlots('text', ['a', 'b'] as ObjectId[])).toBe(6);
    const pages = scene.pagesOf('text');
    expect(pages).toBeDefined();
    for (const id of ['a', 'b'] as ObjectId[]) {
      scene.slotsOf(id, 'text').forEach((slot, record) => {
        expect(pages?.[slot]).toBe(record % 2);
      });
    }
    expect(scene.pageRevisionOf('text')).toBeGreaterThan(before);
  });

  it('rejects an unknown pass', () => {
    expect(() => fixture().compactSlots('missing', ['a' as ObjectId])).toThrow(RangeError);
  });
});
