import * as Y from 'yjs';

import type { BoardObject } from '@canvas/schema';

import { BODY, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../../store/document-store.js';
import { OBJECTS_MAP_NAME, type YjsDocumentStore } from '../../store/yjs-document-store.js';
import type { SeededRandom } from '../../z-order/__fixtures__/seeded-random.js';
import type { CommandName } from '../registry.js';

// Boards a peer left with invalid fields, written raw (as before the relay's door existed or
// past it), and random honest commands on their objects: shared by the door-consistency property
// of item 1 (`invalid-untouched-field.property.test.ts`) and the history's door guard
// property of (`history/door-guard.property.sync.test.ts`).

/** A raw write into a stored group: its key and the fields it merges in. */
export type RawPoison = readonly [key: string, fields: Readonly<Record<string, unknown>>];

/** Invalid values a peer can leave in any object's groups. */
const SHARED_POISONS: readonly RawPoison[] = [
  ['placement', { rotation: Number.NaN }],
  ['placement', { rotation: 1e300 }],
  ['placement', { x: Number.NaN }],
  ['placement', { y: 1e308 }],
  ['size', { width: -5 }],
  ['size', { height: Number.POSITIVE_INFINITY }],
  ['size', { width: 2 ** 40 }],
];

/** Invalid values a peer can leave in a type's style group. */
const STYLE_POISONS: Readonly<Record<string, readonly RawPoison[]>> = {
  shape: [
    ['style', { stroke: { color: 'ink', width: 2 } }],
    ['style', { cornerRadius: -3 }],
    ['style', { fill: [2, 0, 0, 1] }],
  ],
  image: [
    ['style', { opacity: 7 }],
    ['style', { crop: { x: -1, y: 0, width: 0.5, height: 1 } }],
    ['style', { naturalSize: { width: 0.5, height: 10 } }],
  ],
  line: [['style', { stroke: { color: [0, 0, 0, 1], width: -2 } }]],
  path: [['style', { fill: [0, 'x', 0, 1] }]],
  sticky: [['style', { color: [0, 0, 0, 5] }]],
  frame: [['style', { background: [0, 0, 0, -1] }]],
};

/**
 * A peer's raw update that leaves random objects of a store with invalid values, each merged into
 * one of the object's stored groups (or, with `extra`, own keys such as a line end).
 *
 * @param store - The store; read, not changed.
 * @param random - The random source.
 * @param extra - More poisons per object type, beside the shared and style ones.
 * @param isStamped - Whether the peer also stamps `updatedAt`, as a person's command does (the
 *   history's guards tell a person's write of a reference key from a repair by that stamp).
 * @returns The update and the ids it poisons.
 */
export function poisonUpdate(
  store: DocumentStore,
  random: SeededRandom,
  extra: Readonly<Record<string, readonly RawPoison[]>> = {},
  isStamped = false,
): { readonly update: Uint8Array; readonly ids: string[] } {
  const objects = [...store.read().objects.values()];
  const chosen = random.shuffle(objects).slice(0, 1 + random.below(3));
  const peer = new Y.Doc();
  Y.applyUpdate(peer, store.encodeState());
  peer.transact(() => {
    const maps = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME);
    for (const object of chosen) {
      const map = maps.get(object.id);
      const poisons = [
        ...SHARED_POISONS,
        ...(STYLE_POISONS[object.type] ?? []),
        ...(extra[object.type] ?? []),
      ].filter(([key]) => map?.has(key) === true);
      const [key, fields] = random.pick(poisons);
      map?.set(key, { ...(map.get(key) as Record<string, unknown>), ...fields });
      if (isStamped) map?.set('updatedAt', (map.get('updatedAt') as number) + 1);
    }
  });
  const update = Y.encodeStateAsUpdate(peer, store.encodeStateVector());
  peer.destroy();
  return { update, ids: chosen.map(({ id }) => id) };
}

/**
 * Poisons random objects of the store with a peer's raw update.
 *
 * @param store - The store.
 * @param random - The random source.
 * @returns The ids poisoned.
 */
export function poison(store: YjsDocumentStore, random: SeededRandom): string[] {
  const { update, ids } = poisonUpdate(store, random);
  store.applyUpdate(update, RELAY);
  return ids;
}

/**
 * A small random number.
 *
 * @param random - The random source.
 * @param span - The largest magnitude.
 * @returns A number in (-span, span).
 */
function small(random: SeededRandom, span: number): number {
  return (random.next() * 2 - 1) * span;
}

/**
 * A random honest command on an object, of a kind its type takes.
 *
 * @param random - The random source.
 * @param object - The object.
 * @returns The command's name and input.
 */
export function commandOn(
  random: SeededRandom,
  object: BoardObject,
): readonly [CommandName, unknown] {
  const { id } = object;
  const by = { x: small(random, 50), y: small(random, 50) };
  const choices: (readonly [CommandName, unknown])[] = [
    ['moveObjects', { moves: [{ id, by }] }],
    ['moveObjects', { moves: [{ id, to: { x: small(random, 1_000), y: small(random, 1_000) } }] }],
    ['rotateObjects', { rotations: [{ id, by: small(random, 3) }] }],
    ['setLocked', { ids: [id], locked: !object.locked }],
    ['bringToFront', { ids: [id] }],
    ['sendBackward', { ids: [id] }],
    ['group', { ids: [id] }],
    ['deleteObjects', { ids: [id] }],
  ];
  if ('width' in object) {
    choices.push([
      'resizeObjects',
      { resizes: [{ id, by: { width: small(random, 20), height: small(random, 20) } }] },
    ]);
  }
  if (object.type === 'group') choices.push(['ungroup', { ids: [id] }]);
  if (object.type === 'shape' || object.type === 'path') {
    choices.push(['setStyle', { changes: [{ id, style: { fill: [0.5, 0.5, 0.5, 1] } }] }]);
  }
  if (object.type === 'image') {
    choices.push(['setStyle', { changes: [{ id, style: { opacity: random.next() } }] }]);
  }
  if (object.type === 'text' || object.type === 'sticky' || object.type === 'shape') {
    const runs = [{ length: 2, style: BODY }];
    choices.push(['setTextRuns', { id, text: 'Hi', runs }]);
  }
  if (object.type === 'line') {
    choices.push(['setLinePoints', { id, end: random.below(2), point: by }]);
  }
  if (object.type === 'path' && object.vertices.length > 0) {
    const vertex = random.pick(object.vertices);
    choices.push(['editNetwork', { id, setVertices: [{ ...vertex, x: small(random, 300) }] }]);
  }
  return random.pick(choices);
}
