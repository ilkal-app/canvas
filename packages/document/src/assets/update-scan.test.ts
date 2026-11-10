import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { NO_CLIENT, scanUpdate, Y_MAP_TYPE } from './update-scan.js';

/** Every key the test documents use, so the scan keeps every map entry. */
const ALL_KEYS: ReadonlySet<string> = new Set(['plain', 'sub', 'nested', 'bytes', 'identity']);

/**
 * A document holding every kind of content update format v1 writes: plain values of every lib0
 * type, text with formatting and an embed, binary, a subdocument, XML nodes, a nested map, and a
 * replaced and a deleted map value.
 *
 * @returns The document's state.
 */
function everyContentKind(): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = 7;
  const map = doc.getMap<unknown>('objects');
  doc.transact(() => {
    map.set('plain', {
      nothing: undefined,
      empty: null,
      integer: -42,
      half: 0.5,
      tenth: 0.1,
      big: 2n ** 40n,
      no: false,
      yes: true,
      text: 'héllo 👩‍💻',
      list: [1, 'two', [3]],
      raw: Uint8Array.of(1, 2, 3),
    });
    map.set('sub', new Y.Doc({ guid: 'sub-doc' }));
    map.set('bytes', Uint8Array.of(9, 9));
    const nested = new Y.Map<unknown>();
    map.set('nested', nested);
    nested.set('identity', { type: 'image' });
  });
  const text = doc.getText('text');
  text.insert(0, 'ab😀', { bold: true });
  text.insertEmbed(1, { image: 'x' });
  doc.getArray<unknown>('array').push([Uint8Array.of(5), 'string', 3]);
  doc.getXmlFragment('xml').insert(0, [new Y.XmlElement('p')]);
  doc.getMap<unknown>('hooks').set('hook', new Y.XmlHook('hook'));
  map.set('plain', 'replaced');
  map.delete('bytes');
  return Y.encodeStateAsUpdate(doc);
}

/**
 * The items Yjs itself decodes that the scan should keep: plain, shared-type and deleted items,
 * except those whose written key is not asked for.
 *
 * @param update - The update.
 * @param keys - The keys asked for.
 * @returns `client:clock:length` of each, sorted.
 */
function expectedItems(update: Uint8Array, keys: ReadonlySet<string>): string[] {
  return Y.decodeUpdate(update)
    .structs.filter((struct): struct is Y.Item => struct instanceof Y.Item)
    .filter((item) => {
      const content = item.content;
      const isKept =
        content instanceof Y.ContentAny ||
        content instanceof Y.ContentType ||
        content instanceof Y.ContentDeleted;
      const isOtherKey =
        !(content instanceof Y.ContentType) && item.parentSub !== null && !keys.has(item.parentSub);
      return isKept && !isOtherKey;
    })
    .map((item) => `${String(item.id.client)}:${String(item.id.clock)}:${String(item.length)}`)
    .sort();
}

/**
 * The items a scan kept, in the form of {@link expectedItems}.
 *
 * @param update - The update.
 * @param keys - The keys asked for.
 * @returns `client:clock:length` of each, sorted.
 */
function scannedItems(update: Uint8Array, keys: ReadonlySet<string>): string[] {
  return [...scanUpdate(update, keys).items.values()]
    .flat()
    .map((item) => `${String(item.client)}:${String(item.clock)}:${String(item.length)}`)
    .sort();
}

describe('scanUpdate', () => {
  it('finds the same items and lengths as Yjs across every kind of content', () => {
    const update = everyContentKind();
    expect(scannedItems(update, ALL_KEYS)).toEqual(expectedItems(update, ALL_KEYS));
  });

  it('drops plain entries under keys not asked for, but keeps every shared type', () => {
    const update = everyContentKind();
    const keys = new Set(['identity']);
    const scanned = scannedItems(update, keys);
    expect(scanned).toEqual(expectedItems(update, keys));
    expect(scanned.length).toBeLessThan(scannedItems(update, ALL_KEYS).length);
  });

  it("drops the layout stamp of's meta map under the keys listAssetIds reads", () => {
    // A board the store wrote (stamped), stamped again by a peer: the first stamp is written
    // with its key, `document`, and dropped; the re-stamp carries no key (its origin is the
    // first), so the scan keeps it and listAssetIds finds its chain leaves the scan.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, createFixtureStore().encodeState());
    doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
    const update = Y.encodeStateAsUpdate(doc);
    const keys = new Set(['identity', 'style']);
    expect(scannedItems(update, keys)).toEqual(expectedItems(update, keys));
    const stamps = Y.decodeUpdate(update)
      .structs.filter((struct): struct is Y.Item => struct instanceof Y.Item)
      .filter((item) => item.parentSub === DOCUMENT_META_KEY);
    expect(stamps).toHaveLength(1);
    const scanned = [...scanUpdate(update, keys).items.values()].flat();
    expect(scanned.filter((item) => item.parentName === META_MAP_NAME)).toEqual([]);
    expect(
      scanned.some(
        (item) => item.client === stamps[0]?.id.client && item.clock === stamps[0].id.clock,
      ),
    ).toBe(false);
  });

  it('records where a first entry sits and what a replacement replaced', () => {
    const doc = new Y.Doc();
    doc.clientID = 3;
    const map = doc.getMap<unknown>('objects');
    const object = new Y.Map<unknown>();
    map.set('image-1', object);
    object.set('identity', { type: 'image' });
    object.set('identity', { type: 'video' });
    const items = scanUpdate(Y.encodeStateAsUpdate(doc), ALL_KEYS).items.get(3) ?? [];
    const [objectItem, first, second] = items;
    expect(objectItem).toMatchObject({
      content: 'type',
      detail: Y_MAP_TYPE,
      parentName: 'objects',
      parentSub: 'image-1',
    });
    expect(first).toMatchObject({
      content: 'deleted',
      parentClient: 3,
      parentClock: objectItem?.clock,
      parentSub: 'identity',
      originClient: NO_CLIENT,
    });
    expect(second).toMatchObject({ content: 'any', originClient: 3, originClock: first?.clock });
  });

  it('records the right neighbour of an item inserted before another', () => {
    const doc = new Y.Doc();
    doc.clientID = 4;
    const list = doc.getArray<Y.Map<unknown>>('list');
    list.push([new Y.Map()]);
    list.insert(0, [new Y.Map()]);
    const [last, first] = scanUpdate(Y.encodeStateAsUpdate(doc), ALL_KEYS).items.get(4) ?? [];
    expect(first).toMatchObject({ originClient: NO_CLIENT, rightOriginClient: 4 });
    expect(first?.rightOriginClock).toBe(last?.clock);
    expect(last).toMatchObject({ rightOriginClient: NO_CLIENT, parentName: 'list' });
  });

  it('keeps, when asked, every struct: deleted values of every key and content of every kind', () => {
    const doc = new Y.Doc();
    doc.clientID = 6;
    const objects = doc.getMap<unknown>('objects');
    objects.set('shape-1', new Y.Map());
    objects.delete('shape-1');
    objects.set('plain', 1);
    doc.getText('text').insert(0, 'ab');
    const update = Y.encodeStateAsUpdate(doc);
    const kinds = (options: Parameters<typeof scanUpdate>[2]): string[] =>
      (scanUpdate(update, new Set(), options).items.get(6) ?? []).map((item) => item.content);
    expect(kinds({})).toEqual([]);
    expect(kinds({ shouldKeepEveryStruct: true })).toEqual(['deleted', 'any', 'other']);
  });

  it('records, when asked, skipped and collected ranges, and a client’s last run only', () => {
    const doc = new Y.Doc();
    doc.clientID = 9;
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    const map = doc.getMap<unknown>('objects');
    for (const key of ['plain', 'sub', 'nested']) map.set(key, key);
    const merged = Y.mergeUpdates([updates[0] ?? new Uint8Array(), updates[2] ?? new Uint8Array()]);
    const every = { shouldKeepEveryStruct: true };
    expect(
      scanUpdate(merged, new Set(), every)
        .items.get(9)
        ?.map(({ content, clock }) => [content, clock]),
    ).toEqual([
      ['any', 0],
      ['skip', 1],
      ['any', 2],
    ]);
    const encoder = encoding.createEncoder();
    // Client 4 twice: a run of one plain value at clock 0, then a run of a 3-clock GC struct.
    encoding.writeVarUint(encoder, 2);
    for (const [kind, length] of [
      [8, 1],
      [0, 3],
    ] as const) {
      for (const value of [1, 4, 0]) encoding.writeVarUint(encoder, value);
      encoding.writeUint8(encoder, kind);
      if (kind === 0) {
        encoding.writeVarUint(encoder, length);
      } else {
        encoding.writeVarUint(encoder, 1);
        encoding.writeVarString(encoder, 'array');
        encoding.writeVarUint(encoder, 1);
        encoding.writeAny(encoder, 'value');
      }
    }
    encoding.writeVarUint(encoder, 0);
    const twice = encoding.toUint8Array(encoder);
    expect(scanUpdate(twice, new Set(), every).items.get(4)).toMatchObject([
      { content: 'gc', clock: 0, length: 3, originClient: NO_CLIENT },
    ]);
    expect(scanUpdate(twice, new Set(['x'])).items.get(4)).toMatchObject([{ content: 'any' }]);
  });

  it('reads the delete set, sorted per client', () => {
    const doc = new Y.Doc({ gc: false });
    doc.clientID = 5;
    const map = doc.getMap<unknown>('objects');
    map.set('a', 1);
    map.set('b', 2);
    map.delete('b');
    map.delete('a');
    expect(scanUpdate(Y.encodeStateAsUpdate(doc), ALL_KEYS).deleted.get(5)).toEqual([[0, 2]]);
  });

  it('steps over the skipped ranges of a merged update with a gap', () => {
    const doc = new Y.Doc();
    doc.clientID = 9;
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    const map = doc.getMap<unknown>('objects');
    for (const key of ['plain', 'sub', 'nested']) map.set(key, key);
    const merged = Y.mergeUpdates([updates[0] ?? new Uint8Array(), updates[2] ?? new Uint8Array()]);
    expect(scannedItems(merged, ALL_KEYS)).toEqual(expectedItems(merged, ALL_KEYS));
  });

  it('reads the JSON content older Yjs versions wrote', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1); // one client
    encoding.writeVarUint(encoder, 1); // one struct
    encoding.writeVarUint(encoder, 4); // client
    encoding.writeVarUint(encoder, 0); // first clock
    encoding.writeUint8(encoder, 2); // ContentJSON, no origins, no key
    encoding.writeVarUint(encoder, 1); // the parent is a top-level type
    encoding.writeVarString(encoder, 'array');
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarString(encoder, '1');
    encoding.writeVarString(encoder, '"two"');
    encoding.writeVarUint(encoder, 0); // an empty delete set
    const update = encoding.toUint8Array(encoder);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    expect(doc.getArray('array').toArray()).toEqual([1, 'two']);
    expect(scanUpdate(update, ALL_KEYS).items.get(4)).toEqual([]);
  });

  it('refuses a content number update format v1 does not define', () => {
    const encoder = encoding.createEncoder();
    for (const value of [1, 1, 4, 0]) encoding.writeVarUint(encoder, value);
    encoding.writeUint8(encoder, 11);
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarString(encoder, 'array');
    expect(() => scanUpdate(encoding.toUint8Array(encoder), ALL_KEYS)).toThrow(RangeError);
  });
});
