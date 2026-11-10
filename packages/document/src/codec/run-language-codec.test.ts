// A run's language is written, kept and removed through the rich-text writer, and
// on empty text's stored style.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { TextStyle } from '@canvas/schema';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { readRichText, writeRichText } from './rich-text-codec.js';

const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

/**
 * A host map integrated in a fresh document, as an object's map would be.
 *
 * @returns The host map.
 */
function createHost(): Y.Map<unknown> {
  const host = new Y.Map<unknown>();
  new Y.Doc().getMap('objects').set('host', host);
  return host;
}

describe('run language in rich text', () => {
  it('removes a language the new content no longer has', () => {
    const host = createHost();
    writeRichText(host, { text: 'ab', runs: [{ length: 2, style: { ...BODY, lang: 'ja' } }] });
    writeRichText(host, { text: 'ab', runs: [{ length: 2, style: BODY }] });
    const read = readRichText(host);
    expect(typeof read === 'string' ? read : read.runs).toEqual([{ length: 2, style: BODY }]);
  });

  it('sets and removes the language of empty text', () => {
    const store = createFixtureStore();
    try {
      const object = store.get('text-title' as never) as unknown as {
        createdBy: never;
        text: string;
      };
      const origin = { kind: 'user', principalId: object.createdBy } as const;
      store.transact(origin, (transaction) => {
        transaction.deleteText('text-title' as never, 0, object.text.length);
      });
      store.transact(origin, (transaction) => {
        transaction.formatText('text-title' as never, 0, 0, { lang: 'ja' });
      });
      expect(store.get('text-title' as never)).toMatchObject({
        runs: [{ length: 0, style: { lang: 'ja' } }],
      });
      store.transact(origin, (transaction) => {
        transaction.formatText('text-title' as never, 0, 0, { lang: null });
      });
      expect(store.get('text-title' as never)).not.toHaveProperty('runs.0.style.lang');
    } finally {
      store.destroy();
    }
  });
});
