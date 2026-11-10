import * as Y from 'yjs';

import type { BoardObject, ObjectId, PrincipalId, Segment, Vertex } from '@canvas/schema';

import {
  ADA,
  BOB,
  createFixtureStore,
  fixtureObject,
} from '../../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../../store/yjs-document-store.js';
import { stampDocument } from '../stamp-document.js';

// Boards and the updates a writer sends to them, as the relay's update gate sees them: the hub's
// document, and the bytes of one writer's change against it (part 1).

/** A board on the relay, and a writer that holds it too. */
export interface GateBoard {
  /** The relay's copy of the board: what the update is checked against. */
  readonly hub: Y.Doc;
  /** A writer's store holding the same board, stamped. */
  readonly writer: YjsDocumentStore;
}

/**
 * A note of the fixture board, moved to the root under a new id and place.
 *
 * @param index - Which note; its id is `note-<index>`.
 * @returns The note.
 */
export function noteAt(index: number): BoardObject {
  return {
    ...fixtureObject('sticky-idea', 'sticky'),
    id: `note-${String(index)}` as ObjectId,
    parentId: null,
    x: (index % 100) * 250,
    y: Math.floor(index / 100) * 250,
  };
}

/**
 * A board of `count` notes written by Ada, and a writer (Bob) that holds it.
 *
 * @param count - How many notes.
 * @returns The hub and the writer.
 */
export function noteBoard(count: number): GateBoard {
  const author = new YjsDocumentStore({ clientId: 1 });
  author.transact(ADA, (transaction) => {
    for (let index = 0; index < count; index += 1) transaction.setObject(noteAt(index));
  });
  const hub = new Y.Doc();
  Y.applyUpdate(hub, author.encodeState());
  const writer = new YjsDocumentStore({ clientId: 2 });
  writer.applyUpdate(author.encodeState(), ADA);
  author.destroy();
  return { hub, writer };
}

/**
 * Applies a change on the writer and returns its update against the hub, without applying it to
 * the hub.
 *
 * @param board - The board.
 * @param change - The writer's change.
 * @returns The update the writer sends.
 */
export function writerUpdate(
  board: GateBoard,
  change: (writer: YjsDocumentStore) => void,
): Uint8Array {
  change(board.writer);
  return board.writer.encodeState(Y.encodeStateVector(board.hub));
}

/**
 * A path of `count` vertices on a sine wave, each segment curved.
 *
 * @param count - How many vertices.
 * @returns The path.
 */
export function longPath(count: number): BoardObject {
  const vertices: Vertex[] = [...Array(count).keys()].map((index) => ({
    id: `v${String(index)}`,
    x: index * 10,
    y: Math.sin(index / 10) * 100,
    mirror: 'both',
  }));
  const segments: Segment[] = vertices.slice(1).map((vertex, index) => ({
    id: `s${String(index)}`,
    a: `v${String(index)}`,
    b: vertex.id,
    ha: { x: 3, y: 0 },
    hb: { x: -3, y: 0 },
  }));
  return {
    id: 'long-path' as ObjectId,
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:bob' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    type: 'path',
    vertices,
    segments,
    stroke: { color: [0.1, 0.1, 0.1, 1], width: 2 },
    fill: null,
  };
}

/**
 * Bob's move of one note by 10 units: the update a typical drag sends.
 *
 * @param board - The board; its writer is changed.
 * @param index - Which note.
 * @returns The update.
 */
export function moveUpdate(board: GateBoard, index: number): Uint8Array {
  return writerUpdate(board, (writer) => {
    const note = noteAt(index);
    writer.transact(BOB, (transaction) => {
      transaction.setObject({ ...note, x: note.x + 10 });
    });
  });
}

/**
 * The fixture board (every object type) written by Ada, and a writer (Bob) that holds it.
 *
 * @returns The hub and the writer.
 */
export function fixtureGateBoard(): GateBoard {
  const author = createFixtureStore();
  const hub = new Y.Doc();
  Y.applyUpdate(hub, author.encodeState());
  const writer = new YjsDocumentStore({ clientId: 2 });
  writer.applyUpdate(author.encodeState(), ADA);
  author.destroy();
  return { hub, writer };
}

/** The Yjs client id of a raw writer, which skips the command layer. */
const RAW_CLIENT_ID = 77;

/**
 * A raw write against the hub, as a client with an editor token can send one: a Yjs document of
 * its own holding the board, stamped as every build stamps, changed straight through Yjs.
 *
 * @param board - The board; nothing of it is changed.
 * @param board.hub - The relay's copy, which the update is against.
 * @param change - The change, given the writer's `objects` map and document.
 * @param isCollecting - Whether the writer's document collects deleted content (Yjs `gc`), as
 *   a document without an undo history does; one that keeps it sends deleted values whole.
 * @returns The update, against the hub.
 */
export function rawUpdate(
  board: Pick<GateBoard, 'hub'>,
  change: (objects: Y.Map<Y.Map<unknown>>, doc: Y.Doc) => void,
  isCollecting = true,
): Uint8Array {
  const peer = new Y.Doc({ gc: isCollecting });
  peer.clientID = RAW_CLIENT_ID;
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(board.hub));
  peer.transact(() => {
    stampDocument(peer);
    change(peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME), peer);
  });
  const update = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(board.hub));
  peer.destroy();
  return update;
}

/**
 * Merges fields into one stored group of an object's map.
 *
 * @param objects - The `objects` map.
 * @param objectId - The object.
 * @param group - The group's key.
 * @param fields - The fields.
 * @throws {Error} When the board holds no such object.
 */
export function mergeGroup(
  objects: Y.Map<Y.Map<unknown>>,
  objectId: string,
  group: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  const stored = objects.get(objectId);
  if (stored === undefined) throw new Error(`no object "${objectId}"`);
  const values = stored.get(group) as Readonly<Record<string, unknown>> | undefined;
  stored.set(group, { ...values, ...fields });
}

/** The content kinds a raw writer can put under a map key beside `ContentAny`. */
export type RawContentKind = 'json' | 'embed' | 'string' | 'binary';

/** JSON content written from its raw text, so it can hold what `JSON.stringify` never writes. */
class RawJsonContent extends Y.ContentJSON {
  readonly #text: string;

  /**
   * Holds the text.
   *
   * @param text - One JSON value's text, such as `{"x":1e999}`.
   */
  constructor(text: string) {
    super([null]);
    this.#text = text;
  }

  /**
   * Writes one JSON string, as `ContentJSON` writes its values.
   *
   * @param encoder - The update's encoder.
   */
  override write(encoder: Y.UpdateEncoderV1 | Y.UpdateEncoderV2): void {
    encoder.writeLen(1);
    encoder.writeString(this.#text);
  }
}

/** An embed written from its raw JSON text. */
class RawEmbedContent extends Y.ContentEmbed {
  readonly #text: string;

  /**
   * Holds the text.
   *
   * @param text - The embed's JSON text.
   */
  constructor(text: string) {
    super({});
    this.#text = text;
  }

  /**
   * Writes the JSON string, as `ContentEmbed` writes its value.
   *
   * @param encoder - The update's encoder.
   */
  override write(encoder: Y.UpdateEncoderV1 | Y.UpdateEncoderV2): void {
    encoder.writeString(this.#text);
  }
}

/**
 * Sets a map key to content no `Y.Map#set` writes, as a hostile client's own encoder can: JSON or
 * an embed from raw text (`1e999` included, which reads back as `Infinity`), a one-character
 * string, or binary. Call it inside the writer's transaction, before the update is encoded.
 *
 * @param map - The map, integrated in a document.
 * @param key - The key.
 * @param kind - The content kind.
 * @param text - The JSON text, or the string for `string`.
 * @throws {Error} When the key holds no item after the set.
 */
export function setRawContent(
  map: Y.Map<unknown>,
  key: string,
  kind: RawContentKind,
  text: string,
): void {
  map.set(key, null);
  const item = map._map.get(key);
  if (item === undefined) throw new Error(`no item under "${key}"`);
  const contents: Record<RawContentKind, () => Y.Item['content']> = {
    json: () => new RawJsonContent(text),
    embed: () => new RawEmbedContent(text),
    string: () => new Y.ContentString(text),
    binary: () => new Y.ContentBinary(new Uint8Array([1])),
  };
  item.content = contents[kind]();
}

/**
 * The fixture board, with values lets stay written into it from outside the commands: a
 * note at the root and one in a group with a rotation of 1e300, and a frame 2^33 wide. Its hub
 * and its writer (Bob) hold them as stored history would.
 *
 * @returns The hub and the writer.
 */
export function letStayBoard(): GateBoard {
  const board = fixtureGateBoard();
  const setUp = rawUpdate(board, (objects) => {
    const note = (id: string) =>
      new Y.Map<unknown>([
        ['identity', { id, type: 'frame', createdBy: 'user:ada', createdAt: 1_760_000_000_000 }],
        ['placement', { parentId: null, x: 10, y: 10, rotation: 1e300 }],
        ['size', { width: 100, height: 100 }],
        ['style', { name: id, clip: false, background: null }],
        ['z', 'a5'],
        ['locked', false],
        ['updatedAt', 1_760_000_000_000],
      ]);
    objects.set('tilted', note('tilted'));
    const wide = note('wide');
    wide.set('placement', { parentId: null, x: 0, y: 0, rotation: 0 });
    wide.set('size', { width: 2 ** 33, height: 100 });
    objects.set('wide', wide);
    objects.set('inner', note('inner'));
    objects.set(
      'g',
      new Y.Map<unknown>([
        [
          'identity',
          { id: 'g', type: 'group', createdBy: 'user:ada', createdAt: 1_760_000_000_000 },
        ],
        ['placement', { parentId: null, x: 500, y: 500, rotation: 0 }],
        ['z', 'a6'],
        ['locked', false],
        ['updatedAt', 1_760_000_000_000],
      ]),
    );
    const inner = objects.get('inner');
    inner?.set('placement', { parentId: 'g', x: 5, y: 5, rotation: 1e300 });
  });
  Y.applyUpdate(board.hub, setUp);
  board.writer.applyUpdate(setUp, ADA);
  return board;
}
