// Updates whose origin chains are as long as the update: the worst case of an update scan that
// resolves each item's placement by following its origins ('s review measured the
// relay's stamp check quadratic on them). Two writers alternate, so no two neighbouring items
// share a client and Yjs cannot merge them into one.
import * as Y from 'yjs';

/** The two writers' Yjs client ids. */
const WRITERS = [101, 102] as const;

/**
 * A text two writers alternately type into, one character at a time, then delete: every
 * character, deleted, is the origin of the next, so the full state holds one chain of
 * `itemCount` deleted items. (Deleting as they go would build it in quadratic time: Yjs walks
 * every deleted character to find the end of the text.)
 *
 * @param itemCount - How many characters are typed (and deleted).
 * @returns The document's full state as one update (format v1).
 */
export function alternatingTextChain(itemCount: number): Uint8Array {
  const doc = new Y.Doc();
  const text = doc.getText('notes');
  for (let index = 0; index < itemCount; index += 1) {
    doc.clientID = WRITERS[index % 2] ?? WRITERS[0];
    doc.transact(() => {
      text.insert(text.length, 'x');
    });
  }
  doc.transact(() => {
    text.delete(0, text.length);
  });
  return Y.encodeStateAsUpdate(doc);
}

/**
 * A top-level list two writers alternately append a number to: every value, live, is the
 * origin of the next, so the full state holds one chain of `itemCount` live items.
 *
 * @param itemCount - How many values are appended.
 * @returns The document's full state as one update (format v1).
 */
export function alternatingListChain(itemCount: number): Uint8Array {
  const doc = new Y.Doc();
  const list = doc.getArray<number>('history');
  for (let index = 0; index < itemCount; index += 1) {
    doc.clientID = WRITERS[index % 2] ?? WRITERS[0];
    doc.transact(() => {
      list.insert(list.length, [index]);
    });
  }
  return Y.encodeStateAsUpdate(doc);
}
