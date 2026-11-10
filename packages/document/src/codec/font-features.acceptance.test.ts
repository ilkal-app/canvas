import { describe, expect, it } from 'vitest';

import type { ObjectId, TextStyle } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setTextStyleCommand } from '../commands/styles/set-named-style.js';
import { createFixtureStore, ADA, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  ATTRIBUTE_BASE_STYLE,
  isStoredTextStyle,
  styleFromAttributes,
  stylePatchToAttributes,
  styleToAttributes,
} from './style-attributes.js';

const ID = 'text-title' as ObjectId;
const FEATURES = { liga: 0, tnum: 1 };

/**
 * Reads the first run's feature record from the fixture document.
 *
 * @param store - The document to inspect.
 * @returns The first run's features, if any.
 */
function firstFeatures(store: ReturnType<typeof createFixtureStore>): unknown {
  const object = store.get(ID);
  return object?.type === 'text'
    ? (object.runs[0]?.style as unknown as Record<string, unknown>).fontFeatures
    : undefined;
}

describe('font features document storage', () => {
  it('stores one copied Y.Text attribute, never empty, and drops malformed reads', () => {
    const style = { ...ATTRIBUTE_BASE_STYLE, fontFeatures: FEATURES } as TextStyle;
    const attributes = styleToAttributes(style);
    expect(attributes).toEqual({ fontFeatures: FEATURES });
    expect((attributes as Record<string, unknown>).fontFeatures).not.toBe(FEATURES);
    expect(styleFromAttributes(attributes)).toEqual(style);
    expect(styleToAttributes({ ...ATTRIBUTE_BASE_STYLE, fontFeatures: {} })).toEqual({});
    expect(stylePatchToAttributes({ fontFeatures: FEATURES })).toEqual({
      fontFeatures: FEATURES,
    });
    expect(stylePatchToAttributes({ fontFeatures: null })).toEqual({ fontFeatures: null });
    expect(stylePatchToAttributes({ fontFeatures: {} })).toEqual({ fontFeatures: null });
    expect(styleFromAttributes({ fontFeatures: { liga: 65536 } })).toEqual(ATTRIBUTE_BASE_STYLE);
    expect(isStoredTextStyle({ ...ATTRIBUTE_BASE_STYLE, fontFeatures: { liga: 65536 } })).toBe(
      false,
    );
  });

  it('formatText splits runs and synchronizes the record', () => {
    const first = createFixtureStore();
    const second = new YjsDocumentStore();
    try {
      first.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, 3, { fontFeatures: FEATURES });
      });
      const object = first.get(ID);
      expect(object?.type === 'text' && object.runs[0]?.length).toBe(3);
      expect(firstFeatures(first)).toEqual(FEATURES);
      second.applyUpdate(first.encodeState(), RELAY);
      const synced = second.get(ID);
      expect(
        synced?.type === 'text' &&
          (synced.runs[0]?.style as unknown as Record<string, unknown>).fontFeatures,
      ).toEqual(FEATURES);
    } finally {
      first.destroy();
      second.destroy();
    }
  });

  it('setStyle patches and removes features, and a named style without them clears them', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { fontFeatures: FEATURES } } }],
      });
      expect(firstFeatures(store)).toEqual(FEATURES);
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { fontFeatures: null } } }],
      });
      expect(firstFeatures(store)).toBeUndefined();
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { fontFeatures: FEATURES } } }],
      });
      const named = applyCommand(store, setTextStyleCommand, {
        name: 'Plain',
        value: { fontFamily: 'Inter', fontSize: 16, weight: 400, italic: false },
      }).result.id;
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { textStyleId: named } } }],
      });
      expect(firstFeatures(store)).toBeUndefined();
    } finally {
      store.destroy();
    }
  });
});
