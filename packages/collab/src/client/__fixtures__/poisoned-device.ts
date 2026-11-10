// Acceptance fixtures: a poisoned cache record (an unstamped object entry whose earlier
// clock never arrived), the filler that releases it, a transport that withholds a tab's document
// frames, and a scan of everything a fake-indexeddb device holds, whatever database or store a
// fix keeps it in. The real-relay twin is `tooling/e2e-sync/src/sync/__fixtures__/poisoned-cache.ts`.
import type { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME } from '@canvas/document';

import type { CollabSocketFactory } from '../collab-socket.js';

import { EDITOR_CLAIMS } from './unsigned-token.js';

const BOARD = EDITOR_CLAIMS.boardId;

/** The Yjs client id of the writer that never stamps (a build from before). */
export const UNSTAMPED_WRITER = 2470;

/** A poisoned record and the filler that releases it. */
export interface PoisonedHistory {
  /** The cached record: an object entry by an unstamped writer, missing its earlier clock. */
  readonly fragment: Uint8Array;
  /** The missing earlier clock: text only, which the relay accepts from any writer. */
  readonly filler: Uint8Array;
  /** The id of the unstamped object the fragment holds. */
  readonly ghostId: string;
  /** The writer's Yjs client id. */
  readonly writer: number;
  /** The clock of the fragment's first struct (the object entry). */
  readonly fragmentClock: number;
}

/**
 * Builds the ticket's poisoned history: the writer inserts text (the filler, clock 0), then
 * writes an object entry without a stamp (the fragment). A store holding only the fragment keeps
 * it pending; once the filler arrives the entry integrates and the store's version guard finds
 * an unversioned writer.
 *
 * @param writer - The unstamped writer's Yjs client id.
 * @param ghostId - The object id of its entry.
 * @returns The fragment, the filler and where the fragment starts.
 */
export function poisonedHistory(writer = UNSTAMPED_WRITER, ghostId = 'ghost-247'): PoisonedHistory {
  const doc = new Y.Doc();
  doc.clientID = writer;
  doc.getText('note').insert(0, 'a');
  const filler = Y.encodeStateAsUpdate(doc);
  const vector = Y.encodeStateVector(doc);
  const fragmentClock = Y.getState(doc.store, writer);
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    doc.getMap<unknown>(OBJECTS_MAP_NAME).set(ghostId, entry);
    entry.set('id', ghostId);
    entry.set('type', 'sticky');
  });
  const fragment = Y.encodeStateAsUpdate(doc, vector);
  doc.destroy();
  return { fragment, filler, ghostId, writer, fragmentClock };
}

const BOARD_PREFIX = [BOARD.length, ...new TextEncoder().encode(BOARD), 0];

/**
 * Tells whether an outgoing frame carries document content: a Hocuspocus Sync message (0) for
 * the board whose Yjs type is step 2 (1) or update (2). Step 1 still goes, so the relay answers
 * with its own state.
 *
 * @param data - The frame.
 * @returns `true` for a step 2 or an update.
 */
function isDocumentFrame(data: Uint8Array): boolean {
  if (!BOARD_PREFIX.every((value, index) => data[index] === value)) return false;
  const kind = data[BOARD_PREFIX.length];
  return kind === 1 || kind === 2;
}

/**
 * A transport that loses the tab's document frames while `isWithholding` is set, so an offline
 * edit is still unsent when the relay's answer poisons the tab (the network lost the tab's step
 * 2). Everything else goes through the base transport.
 */
export class WithheldDocumentFrames {
  /** Whether document frames are dropped now. */
  isWithholding = false;
  /** How many frames were dropped. */
  withheld = 0;
  readonly #base: CollabSocketFactory;

  /**
   * Wraps a transport.
   *
   * @param base - The transport frames go through.
   */
  constructor(base: CollabSocketFactory) {
    this.#base = base;
  }

  /**
   * The socket factory.
   *
   * @param url - The relay URL.
   * @param handlers - The client's handlers.
   * @returns The socket.
   */
  readonly socketFactory: CollabSocketFactory = (url, handlers) => {
    const socket = this.#base(url, handlers);
    return {
      send: (data) => {
        if (this.isWithholding && isDocumentFrame(data)) {
          this.withheld += 1;
          return;
        }
        socket.send(data);
      },
      close: () => {
        socket.close();
      },
    };
  };
}

/**
 * Collects every byte array inside a stored value (records may wrap their bytes in objects).
 *
 * @param value - A value read from IndexedDB.
 * @param into - Where the byte arrays go.
 */
function collectBytes(value: unknown, into: Uint8Array[]): void {
  if (value instanceof Uint8Array) into.push(value);
  else if (value instanceof ArrayBuffer) into.push(new Uint8Array(value));
  else if (Array.isArray(value)) for (const item of value) collectBytes(item, into);
  else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectBytes(item, into);
  }
}

/**
 * Wraps an IndexedDB request.
 *
 * @param request - The request.
 * @returns Its result.
 */
function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/**
 * Reads every byte array the device holds: every record of every object store of every
 * database the factory lists. Opens each database at its current version and closes it again.
 *
 * @param factory - The device's IndexedDB.
 * @returns The byte arrays, in no particular order.
 */
export async function deviceBytes(factory: IDBFactory): Promise<Uint8Array[]> {
  const found: Uint8Array[] = [];
  for (const { name } of await factory.databases()) {
    if (name === undefined) continue;
    const database = await settle(factory.open(name));
    try {
      for (const storeName of Array.from(database.objectStoreNames)) {
        const transaction = database.transaction(storeName, 'readonly');
        collectBytes(await settle(transaction.objectStore(storeName).getAll()), found);
      }
    } finally {
      database.close();
    }
  }
  return found;
}

/**
 * Decodes the byte arrays that are Yjs updates; others are skipped.
 *
 * @param bytes - The byte arrays.
 * @returns The decodable ones.
 */
function updatesOf(bytes: readonly Uint8Array[]): Uint8Array[] {
  return bytes.filter((update) => {
    try {
      Y.decodeUpdate(update);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * What the device holds, merged: the live object ids of every Yjs update on it, applied to one
 * plain document (no version guard, so poisoned content shows too).
 *
 * @param factory - The device's IndexedDB.
 * @returns The object ids, sorted.
 */
export async function deviceObjectIds(factory: IDBFactory): Promise<string[]> {
  const doc = new Y.Doc();
  for (const update of updatesOf(await deviceBytes(factory))) Y.applyUpdate(doc, update);
  const ids = [...doc.getMap<unknown>(OBJECTS_MAP_NAME).keys()].sort();
  doc.destroy();
  return ids;
}

/**
 * Tells whether any update on the device holds an item (content, not a gap or a collected
 * struct) covering one Yjs id.
 *
 * @param factory - The device's IndexedDB.
 * @param client - The struct's client id.
 * @param clock - A clock the struct covers.
 * @returns `true` when some stored update carries it.
 */
export async function deviceHoldsStruct(
  factory: IDBFactory,
  client: number,
  clock: number,
): Promise<boolean> {
  return updatesOf(await deviceBytes(factory)).some((update) =>
    Y.decodeUpdate(update).structs.some(
      (struct) =>
        struct instanceof Y.Item &&
        struct.id.client === client &&
        struct.id.clock <= clock &&
        clock < struct.id.clock + struct.length,
    ),
  );
}
