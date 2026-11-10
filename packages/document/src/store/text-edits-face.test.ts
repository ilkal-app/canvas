// A face belongs to its family in formatText: a family patch without a face drops the
// stale face of the characters it moves, keeps the face of those already in the family, and
// clears an empty text's face the same way.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { ADA, createFixtureStore } from './__fixtures__/store-fixtures.js';

const ID = 'text-title' as ObjectId;
const FACE = 'Inter-CondensedBold';

/**
 * The faces of the fixture title's runs, with their lengths.
 *
 * @param store - The store.
 * @returns `[length, face]` per run.
 */
function faces(store: ReturnType<typeof createFixtureStore>): [number, string | undefined][] {
  const object = store.get(ID);
  return object?.type === 'text'
    ? object.runs.map(({ length, style }) => [length, style.postScriptName])
    : [];
}

describe('formatText and a face name', () => {
  it('drops the face where a family-only patch moves the text, and only there', () => {
    const store = createFixtureStore();
    try {
      const object = store.get(ID);
      const length = object?.type === 'text' ? object.text.length : 0;
      const family = object?.type === 'text' ? object.runs[0]?.style.fontFamily : undefined;
      store.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, length, { postScriptName: FACE });
      });
      // The same family keeps the face.
      store.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, length, { fontFamily: family ?? '' });
      });
      expect(faces(store).every(([, face]) => face === FACE)).toBe(true);
      // Another family over the first three characters drops their face only.
      store.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, 3, { fontFamily: 'Lora' });
      });
      expect(faces(store)[0]).toEqual([3, undefined]);
      expect(
        faces(store)
          .slice(1)
          .every(([, face]) => face === FACE),
      ).toBe(true);
      // A face named with the family is kept.
      store.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, 3, { fontFamily: 'Inter', postScriptName: 'Inter-Bold' });
      });
      expect(faces(store)[0]).toEqual([3, 'Inter-Bold']);
    } finally {
      store.destroy();
    }
  });

  it('applies the same rule to an empty text', () => {
    const store = createFixtureStore();
    try {
      const object = store.get(ID);
      const length = object?.type === 'text' ? object.text.length : 0;
      store.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, length, { postScriptName: FACE });
        transaction.deleteText(ID, 0, length);
      });
      store.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, 0, { fontFamily: 'Lora' });
      });
      expect(faces(store)).toEqual([[0, undefined]]);
    } finally {
      store.destroy();
    }
  });
});
