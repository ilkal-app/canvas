// A hostile writer for the relay's stamp check fuzz (fix round 2): an editor token and
// raw Yjs, or raw bytes. It writes objects with and without stamps, stamps late, reuses clocks
// the relay already holds, merges its updates with gaps, and hand-writes structs whose
// neighbours are missing or collected.
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME } from '../../store/yjs-document-store.js';
import type { SeededRandom } from '../../z-order/__fixtures__/seeded-random.js';
import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../document-meta.js';
import { stampDocument } from '../stamp-document.js';

import {
  encodeHandUpdate,
  type HandBlock,
  type HandContent,
  type HandItem,
  type HandStruct,
} from './hand-encoded-update.js';

/** The keys hostile writers use under `objects`, some shared with honest tabs' objects. */
const HOSTILE_KEYS = ['h-0', 'h-1', 'h-2', 'tab-a-1', 'tab-b-1'] as const;

/**
 * One hostile writer: a raw Yjs document under a fixed client id, the updates it made, and a
 * stale copy of the board it can write from again under the same id.
 */
export class HostileWriter {
  readonly clientId: number;
  #doc: Y.Doc;
  readonly #made: Uint8Array[] = [];
  #stale: Uint8Array = Y.encodeStateAsUpdate(new Y.Doc());

  /**
   * Creates the writer.
   *
   * @param clientId - Its Yjs client id.
   */
  constructor(clientId: number) {
    this.clientId = clientId;
    this.#doc = this.#docHolding([]);
  }

  /**
   * Takes in the hub's state, remembering the one before as the stale copy.
   *
   * @param hub - The relay's copy of the board.
   */
  receive(hub: Y.Doc): void {
    this.#stale = Y.encodeStateAsUpdate(this.#doc);
    this.#doc = this.#docHolding([
      this.#stale,
      Y.encodeStateAsUpdate(hub, Y.encodeStateVector(this.#doc)),
    ]);
  }

  /**
   * Makes one hostile update.
   *
   * @param random - The seeded choices.
   * @param hub - The relay's copy of the board, for hand-written neighbours.
   * @returns The update and what it is, for failure reports.
   */
  attack(random: SeededRandom, hub: Y.Doc): { update: Uint8Array; kind: string } {
    const kinds = ['write', 'stamped', 'late', 'overlap', 'gaps', 'hand', 'bad-stamp'] as const;
    const kind = random.pick(kinds);
    if (kind === 'write')
      return {
        kind,
        update: this.#write(() => {
          this.#edit(random);
        }),
      };
    if (kind === 'stamped') {
      return {
        kind,
        update: this.#write(() => {
          stampDocument(this.#doc);
          this.#edit(random);
        }),
      };
    }
    if (kind === 'late') return { kind, update: this.#late(random) };
    if (kind === 'overlap') return { kind, update: this.#overlap(random) };
    if (kind === 'gaps') return { kind, update: this.#gaps(random) };
    if (kind === 'bad-stamp') {
      const value = random.pick([{ schemaVersion: 1, layoutVersion: 0 }, 'one', 7]);
      return {
        kind,
        update: this.#write(() => {
          this.#doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, value);
          this.#edit(random);
        }),
      };
    }
    return { kind, update: handWrittenUpdate(random, hub, this.clientId) };
  }

  /**
   * One raw edit: a map or a plain value under a key of `objects`, a nested value inside an
   * object, or a deleted entry.
   *
   * @param random - The seeded choices.
   */
  #edit(random: SeededRandom): void {
    const objects = this.#doc.getMap<unknown>(OBJECTS_MAP_NAME);
    const key = random.pick([...HOSTILE_KEYS, ...objects.keys()]);
    const choice = random.below(4);
    const existing = objects.get(key);
    if (choice === 0) objects.set(key, new Y.Map([['z', 'a0']]));
    else if (choice === 1) objects.set(key, random.below(100));
    else if (choice === 2 && existing instanceof Y.Map) existing.set('locked', true);
    else objects.delete(key);
  }

  /**
   * Objects first, then a stamp: in one merged update, or the stamp alone later.
   *
   * @param random - The seeded choices.
   * @returns The update.
   */
  #late(random: SeededRandom): Uint8Array {
    const objects = this.#write(() => {
      this.#edit(random);
    });
    const stamp = this.#write(() => {
      stampDocument(this.#doc);
    });
    return random.below(2) === 0 ? Y.mergeUpdates([objects, stamp]) : objects;
  }

  /**
   * A stamp and objects written from the stale copy under the same client id, so their clocks
   * overlap what the relay may already hold of this writer.
   *
   * @param random - The seeded choices.
   * @returns The update.
   */
  #overlap(random: SeededRandom): Uint8Array {
    const forged = this.#docHolding([this.#stale]);
    const before = Y.encodeStateVector(forged);
    forged.transact(() => {
      if (random.below(2) === 0) stampDocument(forged);
    });
    forged.transact(() => {
      forged.getMap(OBJECTS_MAP_NAME).set(random.pick(HOSTILE_KEYS), new Y.Map());
    });
    return Y.encodeStateAsUpdate(forged, before);
  }

  /**
   * Some of the writer's updates merged, with the ones between left out.
   *
   * @param random - The seeded choices.
   * @returns The update.
   */
  #gaps(random: SeededRandom): Uint8Array {
    this.#write(() => {
      this.#edit(random);
    });
    this.#write(() => {
      stampDocument(this.#doc);
    });
    this.#write(() => {
      this.#edit(random);
    });
    const kept = this.#made.filter(() => random.below(2) === 0);
    return Y.mergeUpdates(kept.length > 0 ? kept : this.#made.slice(-1));
  }

  /**
   * Runs a write on the writer's document and keeps the update it made.
   *
   * @param write - The write.
   * @returns The update.
   */
  #write(write: () => void): Uint8Array {
    const before = Y.encodeStateVector(this.#doc);
    this.#doc.transact(write);
    const update = Y.encodeStateAsUpdate(this.#doc, before);
    this.#made.push(update);
    return update;
  }

  /**
   * A new document holding some updates, then taking the writer's client id: taken first, Yjs
   * would change it (with a console warning) on finding structs of that id arrive, which the
   * hub holds whenever it accepted what the writer forged.
   *
   * @param updates - What the document holds.
   * @returns The document.
   */
  #docHolding(updates: readonly Uint8Array[]): Y.Doc {
    const doc = new Y.Doc();
    for (const update of updates) Y.applyUpdate(doc, update);
    doc.clientID = this.clientId;
    return doc;
  }
}

/**
 * Ids a hand-written item may name as a neighbour or parent: items and collected structs the
 * hub holds, its current stamp and object entries, and ids nobody holds.
 *
 * @param random - The seeded choices.
 * @param hub - The relay's copy of the board.
 * @param client - The writer's client id.
 * @returns The candidate ids.
 */
function candidateIds(random: SeededRandom, hub: Y.Doc, client: number): Y.ID[] {
  const ids: Y.ID[] = [Y.createID(999, random.below(4)), Y.createID(client, random.below(8))];
  for (const structs of hub.store.clients.values()) {
    for (let count = 0; count < 3 && structs.length > 0; count += 1) {
      const struct = random.pick(structs);
      ids.push(Y.createID(struct.id.client, struct.id.clock + random.below(struct.length)));
    }
  }
  const stamp = hub.getMap(META_MAP_NAME)._map.get(DOCUMENT_META_KEY);
  if (stamp !== undefined) ids.push(stamp.id);
  for (const entry of hub.getMap(OBJECTS_MAP_NAME)._map.values()) ids.push(entry.id);
  return ids;
}

/**
 * A random hand-written item: neighbours from the candidates, or a parent it names.
 *
 * @param random - The seeded choices.
 * @param ids - The candidate ids.
 * @returns The item.
 */
function handItem(random: SeededRandom, ids: readonly Y.ID[]): HandItem {
  const place = random.pick(['objects', 'stamp', 'nested', 'list'] as const);
  const content: HandContent = random.pick<HandContent>([
    { kind: 'map' },
    { kind: 'any', values: [place === 'stamp' ? createDocumentMeta() : random.below(9)] },
    { kind: 'deleted', length: 1 },
    { kind: 'string', text: 'ab' },
  ]);
  const neighbours = random.below(4);
  const origin = neighbours % 2 === 1 ? random.pick(ids) : undefined;
  const rightOrigin = neighbours >= 2 ? random.pick(ids) : undefined;
  // A shared type inside an object's field breaks an honest store that reads it (its decoded
  // values are frozen, the type's document with them): a store fault outside the stamp check,
  // so types are placed only where a parent is named, never inside an object.
  const placed = content.kind === 'map' ? { kind: 'any' as const, values: [1] } : content;
  if (origin !== undefined && rightOrigin !== undefined) {
    return { origin, rightOrigin, content: placed };
  }
  if (origin !== undefined) return { origin, content: placed };
  if (rightOrigin !== undefined) return { rightOrigin, content: placed };
  if (place === 'stamp') return { parent: META_MAP_NAME, parentSub: DOCUMENT_META_KEY, content };
  if (place === 'nested') {
    return { parent: random.pick(ids), parentSub: 'locked', content: placed };
  }
  if (place === 'list') return { parent: 'notes', content };
  return { parent: OBJECTS_MAP_NAME, parentSub: random.pick(HOSTILE_KEYS), content };
}

/**
 * A random hand-written update from one writer: items with missing, collected or ordinary
 * neighbours, skipped and collected ranges, clocks at, below or above what the hub holds, a
 * client listed twice, and deletes.
 *
 * @param random - The seeded choices.
 * @param hub - The relay's copy of the board.
 * @param client - The writer's client id.
 * @returns The update.
 */
export function handWrittenUpdate(random: SeededRandom, hub: Y.Doc, client: number): Uint8Array {
  const ids = candidateIds(random, hub, client);
  const state = Y.getState(hub.store, client);
  const block = (): HandBlock => {
    const structs: HandStruct[] = [];
    for (let count = 1 + random.below(4); count > 0; count -= 1) {
      const roll = random.below(10);
      if (roll === 0) structs.push({ skip: 1 + random.below(2) });
      else if (roll === 1) structs.push({ gc: 1 });
      else structs.push(handItem(random, ids));
    }
    const shift = random.pick([0, 0, 0, -1, 1]);
    return { client, clock: Math.max(0, state + shift), structs };
  };
  const blocks = random.below(10) === 0 ? [block(), block()] : [block()];
  const deleted = random.pick(ids);
  const deletes =
    random.below(4) === 0
      ? [{ client: deleted.client, ranges: [[deleted.clock, 1] as const] }]
      : [];
  return encodeHandUpdate(blocks, deletes);
}
