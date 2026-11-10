import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { createFixtureStore, RELAY } from '../store/__fixtures__/store-fixtures.js';

import { EMPTY_TEXT_STYLE_KEY } from './rich-text-codec.js';
import { ATTRIBUTE_BASE_STYLE, storedTextStyleOf } from './style-attributes.js';

const ID = 'text-title' as ObjectId;

describe('the style of empty text with a link', () => {
  it('keeps a valid link and drops an invalid one, keeping the style', () => {
    const link = 'https://example.com/range';
    expect(storedTextStyleOf({ ...ATTRIBUTE_BASE_STYLE, link })).toEqual({
      ...ATTRIBUTE_BASE_STYLE,
      link,
    });
    expect(storedTextStyleOf({ ...ATTRIBUTE_BASE_STYLE, link: 'javascript:alert(1)' })).toEqual(
      ATTRIBUTE_BASE_STYLE,
    );
    expect(storedTextStyleOf({ ...ATTRIBUTE_BASE_STYLE, link: 7 })).toEqual(ATTRIBUTE_BASE_STYLE);
    expect(storedTextStyleOf({ fontFamily: 'Inter' })).toBeUndefined();
  });

  it('reads the text when a peer stores a hostile link in the style of empty text', () => {
    const store = createFixtureStore();
    const peer = new Y.Doc();
    try {
      Y.applyUpdate(peer, store.encodeState());
      const host = peer.getMap<Y.Map<unknown>>('objects').get(ID);
      const style = host?.get(EMPTY_TEXT_STYLE_KEY);
      if (host === undefined || typeof style !== 'object' || style === null) {
        throw new Error('Expected a stored style of empty text');
      }
      host.set(EMPTY_TEXT_STYLE_KEY, { ...style, link: 'javascript:alert(1)' });
      store.applyUpdate(Y.encodeStateAsUpdate(peer), RELAY);
      const object = store.get(ID);
      if (object?.type !== 'text') throw new Error('Expected the text to still read');
      expect(object.text.length).toBeGreaterThan(0);
      expect(object.runs.every((run) => run.style.link === undefined)).toBe(true);
    } finally {
      peer.destroy();
      store.destroy();
    }
  });
});
