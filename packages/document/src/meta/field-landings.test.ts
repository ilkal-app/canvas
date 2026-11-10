import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ScannedItem } from '../assets/update-scan.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { FieldLandings } from './field-landings.js';
import { COLLECTED, type Landing } from './held-structs.js';

// Where a value lands in an object (part 1), on landings as the replay gives them: under
// a type the document holds, or under an item of the update with a landing of its own.

/**
 * A landing of a map value under a parent.
 *
 * @param parent - The parent, as the replay names it.
 * @param key - The value's key.
 * @returns The landing.
 */
function under(parent: unknown, key: string | undefined): Landing {
  return { isCollected: false, parentName: undefined, parentSub: key, parent };
}

/**
 * A document holding an object with a group, a network and a label map, and a map under another
 * top-level type.
 *
 * @returns The document and its nested maps.
 */
function heldBoard() {
  const doc = new Y.Doc();
  const vertices = new Y.Map<unknown>();
  const label = new Y.Map<unknown>();
  const object = new Y.Map<unknown>([
    ['vertices', vertices],
    ['label', label],
  ]);
  doc.getMap<unknown>(OBJECTS_MAP_NAME).set('o', object);
  const elsewhere = new Y.Map<unknown>();
  doc.getMap<unknown>('auxiliary').set('a', elsewhere);
  const deep = new Y.Map<unknown>();
  label.set('deep', deep);
  return { doc, object, vertices, label, elsewhere, deep };
}

/** An item of an update, as the scan records it; only its identity matters here. */
const ITEM = { client: 1, clock: 0 } as unknown as ScannedItem;

describe('FieldLandings', () => {
  it('places a value in an object the document holds, and a member of its network', () => {
    const { doc, object, vertices } = heldBoard();
    const landings = new FieldLandings(doc, new Map());
    expect(landings.resolve(under(object, 'placement'))).toEqual({
      objectId: 'o',
      key: 'placement',
    });
    expect(landings.resolve(under(vertices, 'v1'))).toEqual({
      objectId: 'o',
      key: 'vertices',
      memberId: 'v1',
    });
  });

  it('places a value under an item of the update through that item’s landing', () => {
    const doc = new Y.Doc();
    const objectItem = { client: 2, clock: 0 } as unknown as ScannedItem;
    const networkItem = { client: 2, clock: 1 } as unknown as ScannedItem;
    const landings = new FieldLandings(
      doc,
      new Map<ScannedItem, Landing>([
        [
          objectItem,
          { isCollected: false, parentName: OBJECTS_MAP_NAME, parentSub: 'new', parent: 'objects' },
        ],
        [networkItem, under(objectItem, 'segments')],
        [ITEM, COLLECTED],
      ]),
    );
    expect(landings.resolve(under(objectItem, 'size'))).toEqual({ objectId: 'new', key: 'size' });
    expect(landings.resolve(under(networkItem, 's1'))).toEqual({
      objectId: 'new',
      key: 'segments',
      memberId: 's1',
    });
    expect(landings.resolve(under(ITEM, 'size'))).toBeUndefined();
  });

  it('places nothing that is not one or two levels under an object', () => {
    const { doc, elsewhere, deep, label } = heldBoard();
    const landings = new FieldLandings(doc, new Map());
    expect(landings.resolve(COLLECTED)).toBeUndefined();
    expect(
      landings.resolve({
        isCollected: false,
        parentName: 'objects',
        parentSub: 'o',
        parent: 'objects',
      }),
    ).toBeUndefined();
    expect(landings.resolve(under(label, undefined))).toBeUndefined();
    expect(landings.resolve(under(elsewhere, 'placement'))).toBeUndefined();
    expect(landings.resolve(under(deep, 'x'))).toBeUndefined();
    expect(landings.resolve(under(doc.getMap('objects'), 'x'))).toBeUndefined();
    expect(landings.resolve(under('not a type', 'x'))).toBeUndefined();
  });
});
