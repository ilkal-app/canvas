import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
import { createFixtureStore, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import * as meta from './document-meta.js';

const { DOCUMENT_LAYOUT_VERSION, FONT_VARIATIONS_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } = meta;

describe('font variations stored layout', () => {
  it('gates the new attribute while continuing to read the preceding layout', () => {
    // A later layout may follow ('s 24).
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(FONT_VARIATIONS_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toContain(FONT_VARIATIONS_LAYOUT_VERSION - 1);
  });

  it('keeps a run attribute through a restyle of another field', () => {
    const store = createFixtureStore();
    try {
      const incoming = new Y.Doc();
      Y.applyUpdate(incoming, store.encodeState());
      const text = incoming.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('text-title')?.get('text');
      expect(text).toBeInstanceOf(Y.Text);
      (text as Y.Text).format(0, 1, { fontVariations: { wght: 650 } });
      store.applyUpdate(Y.encodeStateAsUpdate(incoming), RELAY);
      const before = store.get('text-title' as never);
      expect(before?.type).toBe('text');
      if (before?.type === 'text') {
        expect(before.runs.some((run) => run.style.fontVariations?.wght === 650)).toBe(true);
      }
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'text-title', style: { textStyle: { italic: true } } }],
      });
      const after = store.get('text-title' as never);
      expect(after?.type).toBe('text');
      if (after?.type === 'text') {
        expect(
          after.runs.some((run) => run.style.fontVariations?.wght === 650 && run.style.italic),
        ).toBe(true);
      }
      incoming.destroy();
    } finally {
      store.destroy();
    }
  });
});
