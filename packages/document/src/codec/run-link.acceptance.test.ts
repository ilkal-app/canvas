// Written before the code. CONTRACT: Y.Text link attributes round-trip, clear, and tolerate invalid peers. Deliberately not asserted: rendering or click behaviour.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ObjectId, TextStyle } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { setTextStyleCommand } from '../commands/styles/set-named-style.js';
import { ADA, createFixtureStore, RELAY } from '../store/__fixtures__/store-fixtures.js';

import {
  ATTRIBUTE_BASE_STYLE,
  styleFromAttributes,
  stylePatchToAttributes,
  styleToAttributes,
} from './style-attributes.js';

const ID = 'text-title' as ObjectId;
const LINK = 'https://example.com/range';

describe('run link document codec', () => {
  it('maps an optional link to one Y.Text attribute and null removes it', () => {
    const style = { ...ATTRIBUTE_BASE_STYLE, link: LINK } as TextStyle;
    expect(styleToAttributes(style)).toEqual({ link: LINK });
    expect(styleFromAttributes({ link: LINK })).toEqual(style);
    expect(stylePatchToAttributes({ link: LINK })).toEqual({ link: LINK });
    expect(stylePatchToAttributes({ link: null })).toEqual({ link: null });
  });

  it.each(['javascript:alert(1)', 12, ' https://example.com/ '])(
    'drops invalid peer link %j while keeping the run',
    (link) => {
      expect(styleFromAttributes({ weight: 700, link })).toEqual({
        ...ATTRIBUTE_BASE_STYLE,
        weight: 700,
      });
    },
  );

  it('drops an invalid peer-written Y.Text link without dropping the other run style', () => {
    const store = createFixtureStore();
    const peer = new Y.Doc();
    try {
      Y.applyUpdate(peer, store.encodeState());
      const text = peer.getMap<Y.Map<unknown>>('objects').get(ID)?.get('text');
      if (!(text instanceof Y.Text)) throw new Error('Expected Y.Text');
      text.format(0, 3, { weight: 700, link: 'javascript:alert(1)' });
      store.applyUpdate(Y.encodeStateAsUpdate(peer), RELAY);
      const object = store.get(ID);
      if (object?.type !== 'text') throw new Error('Expected text');
      expect(object.runs[0]?.style).toMatchObject({ weight: 700 });
      expect(object.runs[0]?.style).not.toHaveProperty('link');
      expect(object.text).toBeTruthy();
    } finally {
      peer.destroy();
      store.destroy();
    }
  });

  it('setTextRuns clears a removed link from the Y.Text delta', () => {
    const store = createFixtureStore();
    try {
      const original = store.get(ID);
      if (original?.type !== 'text') throw new Error('Expected text fixture');
      const first = original.runs[0];
      if (first === undefined) throw new Error('Expected text run');
      const plain = first.style;
      const linked = { ...plain, link: LINK } as TextStyle;
      applyCommand(store, setTextRunsCommand, {
        id: ID,
        text: 'Hello',
        runs: [{ length: 5, style: linked }],
      });
      expect(store.get(ID)).toMatchObject({ runs: [{ style: { link: LINK } }] });
      applyCommand(store, setTextRunsCommand, {
        id: ID,
        text: 'Hello',
        runs: [{ length: 5, style: plain }],
      });
      const read = store.get(ID);
      expect(read?.type === 'text' && read.runs[0]?.style).not.toHaveProperty('link');
      const doc = new Y.Doc();
      Y.applyUpdate(doc, store.encodeState(), RELAY);
      const text = doc.getMap<Y.Map<unknown>>('objects').get(ID)?.get('text') as Y.Text;
      const delta = text.toDelta() as unknown as { attributes?: Record<string, unknown> }[];
      expect(delta.every((part) => !Object.hasOwn(part.attributes ?? {}, 'link'))).toBe(true);
      doc.destroy();
    } finally {
      store.destroy();
    }
  });

  it('keeps run links when a named style replaces the font fields', () => {
    const store = createFixtureStore();
    try {
      store.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, 3, { link: LINK });
      });
      const before = store.get(ID);
      expect(before?.type === 'text' && before.runs[0]?.style).toHaveProperty('link', LINK);
      const named = applyCommand(store, setTextStyleCommand, {
        name: 'Heading',
        value: { fontFamily: 'Inter', fontSize: 24, weight: 700, italic: false },
      }).result.id;
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { textStyleId: named } } }],
      });
      const after = store.get(ID);
      expect(after?.type === 'text' && after.runs[0]?.style).toHaveProperty('link', LINK);
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { weight: 400 } } }],
      });
      const patched = store.get(ID);
      expect(patched?.type === 'text' && patched.runs[0]?.style).toHaveProperty('link', LINK);
    } finally {
      store.destroy();
    }
  });
});
