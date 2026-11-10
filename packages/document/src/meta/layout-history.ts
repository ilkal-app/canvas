import type * as Y from 'yjs';

import {
  DOCUMENT_META_KEY,
  META_MAP_NAME,
  DOCUMENT_LAYOUT_VERSION,
  type DocumentMeta,
} from './document-meta.js';

/** The origin of a corrective stamp, which uses the existing metadata representation. */
const LAYOUT_REPAIR = Symbol('layout-repair');

/**
 * Reads valid metadata, including layouts newer than this build can interpret.
 *
 * @param value - A metadata value.
 * @returns A copied stamp, or undefined for malformed metadata.
 */
function validStamp(value: unknown): DocumentMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { schemaVersion, layoutVersion } = value as Record<string, unknown>;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 1 ||
    typeof layoutVersion !== 'number' ||
    !Number.isSafeInteger(layoutVersion) ||
    layoutVersion < 1
  )
    return undefined;
  return { schemaVersion, layoutVersion };
}

/**
 * Chooses the higher layout, then higher schema for equal layouts.
 *
 * @param first - The previous maximum.
 * @param second - Another valid stamp.
 * @returns The maximum of the two.
 */
function higher(first: DocumentMeta | undefined, second: DocumentMeta): DocumentMeta {
  if (
    first === undefined ||
    second.layoutVersion > first.layoutVersion ||
    (second.layoutVersion === first.layoutVersion && second.schemaVersion > first.schemaVersion)
  )
    return second;
  return first;
}

/**
 * Finds the highest valid stamp whose content the document still holds, deleted items included.
 * Already garbage-collected stamp values cannot be recovered from the item chain.
 *
 * @param doc - The document to inspect; not changed.
 * @param maxLayout - Highest supported layout; pass Infinity for a diagnostic raw-history read.
 * @returns Its highest remaining supported stamp.
 */
export function highestLayoutStamp(
  doc: Y.Doc,
  maxLayout = DOCUMENT_LAYOUT_VERSION,
): DocumentMeta | undefined {
  let highest: DocumentMeta | undefined;
  for (
    let item = doc.getMap(META_MAP_NAME)._map.get(DOCUMENT_META_KEY) ?? null;
    item !== null;
    item = item.left
  ) {
    for (const value of item.content.getContent()) {
      const stamp = validStamp(value);
      if (stamp !== undefined && stamp.layoutVersion <= maxLayout) highest = higher(highest, stamp);
    }
  }
  return highest;
}

/**
 * Keeps a relay or persistence document's visible stamp at its highest observed layout.
 * Install before applying any stored or live updates. Yjs 13.6.33 emits `afterTransaction`
 * before collecting deleted content (`utils/Transaction.js`); a correction writes the same
 * metadata key and shape before that content disappears. No object or version is migrated.
 * A malformed new stamp remains the update gate's responsibility. Already collected history
 * cannot be recovered. Main thread of the document's owner.
 *
 * @param doc - The document whose stamps are maintained.
 * @param onUnsupported - Reports an ignored future layout; never receives board content.
 * @returns Removes the observer; does not undo stamps already written.
 */
export function preserveHighestLayout(
  doc: Y.Doc,
  onUnsupported?: (layout: number) => void,
): () => void {
  const meta = doc.getMap<unknown>(META_MAP_NAME);
  let highest: DocumentMeta | undefined;
  const restore = () => {
    const raw = highestLayoutStamp(doc, Infinity);
    if (raw !== undefined && raw.layoutVersion > DOCUMENT_LAYOUT_VERSION) {
      onUnsupported?.(raw.layoutVersion);
    }
    const found = highestLayoutStamp(doc);
    if (found !== undefined) highest = higher(highest, found);
    if (highest === undefined) return;
    const current = validStamp(meta.get(DOCUMENT_META_KEY));
    if (
      current?.layoutVersion === highest.layoutVersion &&
      current.schemaVersion === highest.schemaVersion
    )
      return;
    const stamp = highest;
    doc.transact(() => meta.set(DOCUMENT_META_KEY, stamp), LAYOUT_REPAIR);
  };
  const afterTransaction = (transaction: Y.Transaction) => {
    const changed: ReadonlyMap<unknown, unknown> = transaction.changed;
    if (changed.has(meta)) restore();
  };
  doc.on('afterTransaction', afterTransaction);
  restore();
  return () => {
    doc.off('afterTransaction', afterTransaction);
  };
}
