// The door guard reads a restored value whatever content a peer wrote it as, as the
// relay's door does (part 1 fix round 1): JSON and an embed are read as `Y.Map#get` reads
// them and judged by the predicate; any other content under a judged key is refused outright.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { setRawContent, type RawContentKind } from '../meta/__fixtures__/gate-boards.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { ADA_PRINCIPAL, judgedRestore, runAsAda, writeRaw } from './__fixtures__/door-fixtures.js';
import { isRefusedAtDoor, type Restore } from './door-restores.js';
import { createHistory } from './undo-manager.js';

/**
 * Leaves the fixture shape's size as content of a kind, has Ada resize it, and undoes.
 *
 * @param kind - The content kind the peer writes.
 * @param text - Its text.
 * @returns What the undo did, and the shape's width after it.
 */
function undoOverRawSize(kind: RawContentKind, text: string) {
  const store = createFixtureStore();
  const history = createHistory(store, ADA_PRINCIPAL);
  writeRaw(store, 'shape-box', (map) => {
    setRawContent(map, 'size', kind, text);
  });
  runAsAda(store, 'resizeObjects', {
    resizes: [{ id: 'shape-box', to: { width: 10, height: 100 } }],
  });
  const undone = judgedRestore(store, history, 'undo');
  const box = mustGet(store, 'shape-box');
  return { ...undone, width: 'width' in box ? box.width : undefined };
}

describe('the door guard reads a restored value as the door reads it', () => {
  it('leaves out a JSON size past 2^32', () => {
    const undone = undoOverRawSize('json', '{"width":1e20,"height":100}');
    expect(undone).toMatchObject({ omission: 'out-of-range', findings: [], width: 10 });
  });

  it('restores an embedded size the door takes', () => {
    const undone = undoOverRawSize('embed', '{"width":50,"height":100}');
    expect(undone).toMatchObject({ omission: undefined, findings: [], width: 50 });
  });

  it('refuses content that is not a plain value under a judged key, and judges no other key', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<unknown>('objects');
    const box = new Y.Map<unknown>();
    objects.set('box', box);
    doc.transact(() => {
      setRawContent(box, 'size', 'string', 's');
      setRawContent(box, 'locked', 'string', 's');
    });
    const restore = (key: string): Restore => {
      const item = box._map.get(key);
      const entry = objects._map.get('box');
      if (item === undefined || entry === undefined) throw new Error('nothing written');
      return { item, entry, field: { objectId: 'box', key } };
    };
    expect(isRefusedAtDoor(restore('size'), objects)).toBe(true);
    expect(isRefusedAtDoor(restore('locked'), objects)).toBe(false);
    doc.destroy();
  });
});
