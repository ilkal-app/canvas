// Three clients edit one path's network and run every command that can touch it, while
// their updates arrive late, split and out of order, so paths often hold members the read hides
// (a segment whose vertex has not arrived, a duplicate, a stray vertex). Whatever the state:
// no command throws; a refused command writes nothing; a command that has nothing to do with
// the network keeps every hidden member stored; and once everything is delivered the clients
// converge with the same issues. Seeded: the seed is in the test name and every failure message.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import type { BoardObjectOf } from '@canvas/schema';

import { isHiddenMemberIssue } from '../codec/decode-issue.js';
import { expectValidAndConverged } from '../repair/__fixtures__/repair-fixtures.js';
import { ADA, fixtureBoard, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createSeededRandom, type SeededRandom } from '../z-order/__fixtures__/seeded-random.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { PATH, storedIds, ZERO } from './__fixtures__/network-fixtures.js';
import type { AnyCommand } from './command.js';
import { COMMANDS, type CommandName } from './registry.js';
import { runCommand } from './run-command.js';

const SEEDS = [...Array(40).keys()].map((index) => index + 1);
const STEPS = 60;
const OTHER_COMMANDS = [
  'bringToFront',
  'sendToBack',
  'bringForward',
  'sendBackward',
  'moveObjects',
  'rotateObjects',
  'setStyle',
  'group',
  'ungroup',
  'setLocked',
] as const satisfies readonly CommandName[];

/** One client: its store and the updates its peers have sent and it has not applied yet. */
interface Client {
  readonly store: YjsDocumentStore;
  readonly inbox: Uint8Array[];
}

/** A stored segment's ends, read from the document. */
interface Ends {
  readonly a: unknown;
  readonly b: unknown;
}

/**
 * Three clients holding the fixture board, each queueing its local updates for the others.
 *
 * @returns The clients.
 */
function openClients(): Client[] {
  const first = new YjsDocumentStore({ clientId: 1 });
  first.transact(ADA, (transaction) => {
    for (const object of fixtureBoard().objects.values()) transaction.setObject(object);
  });
  const clients = [1, 2, 3].map((clientId): Client => {
    const store = clientId === 1 ? first : new YjsDocumentStore({ clientId });
    if (clientId > 1) store.applyUpdate(first.encodeState(), RELAY);
    return { store, inbox: [] };
  });
  for (const sender of clients) {
    sender.store.subscribeUpdates((update) => {
      if (!update.isLocal) return;
      for (const receiver of clients) if (receiver !== sender) receiver.inbox.push(update.update);
    });
  }
  return clients;
}

/**
 * Applies a random share of a client's waiting updates, in a random order; the rest keep waiting.
 *
 * @param client - The receiver.
 * @param random - The seeded choices.
 */
function deliverSome(client: Client, random: SeededRandom): void {
  const shuffled = random.shuffle(client.inbox);
  const count = random.below(shuffled.length + 1);
  client.inbox.splice(0, client.inbox.length, ...shuffled.slice(count));
  for (const update of shuffled.slice(0, count)) client.store.applyUpdate(update, RELAY);
}

/**
 * A random `editNetwork` input made from the members the client's read shows.
 *
 * @param path - The path as the client reads it.
 * @param random - The seeded choices.
 * @param fresh - Makes a new member id.
 * @returns The input, or `undefined` when the path shows no vertex.
 */
function networkEdit(
  path: BoardObjectOf<'path'>,
  random: SeededRandom,
  fresh: () => string,
): unknown {
  const { vertices, segments } = path;
  if (vertices.length === 0) return undefined;
  const vertex = random.pick(vertices);
  const joining = (id: string) => segments.filter(({ a, b }) => a === id || b === id);
  switch (random.below(5)) {
    case 0: {
      const created = fresh();
      return {
        id: PATH,
        setVertices: [{ id: created, x: random.below(100), y: random.below(100), mirror: 'none' }],
        setSegments: [{ id: fresh(), a: vertex.id, b: created, ha: ZERO, hb: ZERO }],
      };
    }
    case 1:
      return {
        id: PATH,
        setSegments: [
          { id: fresh(), a: vertex.id, b: random.pick(vertices).id, ha: ZERO, hb: ZERO },
        ],
      };
    case 2:
      return { id: PATH, setVertices: [{ ...vertex, x: random.below(100) }] };
    case 3:
      return segments.length === 0
        ? undefined
        : { id: PATH, deleteSegmentIds: [random.pick(segments).id] };
    default:
      return {
        id: PATH,
        deleteVertexIds: [vertex.id],
        deleteSegmentIds: joining(vertex.id).map(({ id }) => id),
      };
  }
}

/**
 * The input of a command that has nothing to do with the network, on the path.
 *
 * @param name - The command.
 * @param random - The seeded choices.
 * @param groupId - Some group on the board, for `ungroup`.
 * @returns The input.
 */
function otherInput(name: (typeof OTHER_COMMANDS)[number], random: SeededRandom, groupId: string) {
  const inputs = {
    bringToFront: { ids: [PATH] },
    sendToBack: { ids: [PATH] },
    bringForward: { ids: [PATH] },
    sendBackward: { ids: [PATH] },
    moveObjects: { moves: [{ id: PATH, by: { x: 3, y: 4 } }] },
    rotateObjects: { rotations: [{ id: PATH, by: 0.1 }] },
    setStyle: { changes: [{ id: PATH, style: { fill: [random.next(), 0, 0, 1] } }] },
    group: { ids: [PATH] },
    ungroup: { ids: [groupId] },
    setLocked: { ids: [PATH], locked: random.below(4) === 0 },
  };
  return inputs[name];
}

/**
 * The stored ends of a path's segments, by id.
 *
 * @param store - The store.
 * @returns The ends.
 */
function storedEnds(store: YjsDocumentStore): Map<string, Ends> {
  const path = internalsOf(store).doc.getMap('objects').get(PATH) as Y.Map<unknown>;
  const segments = path.get('segments') as Y.Map<unknown>;
  const ends = new Map<string, Ends>();
  for (const [id, stored] of segments.entries()) {
    ends.set(id, (stored as [number, Ends])[1]);
  }
  return ends;
}

/** What an `editNetwork` input deletes. */
interface Deletions {
  readonly deleteVertexIds?: readonly string[];
  readonly deleteSegmentIds?: readonly string[];
}

/**
 * The hidden segments an `editNetwork` may delete with its own edit (`codec/network-collection.ts`):
 * those that end at a vertex it deletes, and duplicates of a shown segment it deletes.
 *
 * @param deletions - What the `editNetwork` input deletes.
 * @param path - The path as the client read it before.
 * @param ends - The stored ends before.
 * @returns The ids it may delete.
 */
function collectable(
  deletions: Deletions,
  path: BoardObjectOf<'path'>,
  ends: ReadonlyMap<string, Ends>,
): Set<string> {
  const vertices = new Set(deletions.deleteVertexIds ?? []);
  const pairs = (deletions.deleteSegmentIds ?? []).flatMap((id) => {
    const segment = path.segments.find((candidate) => candidate.id === id);
    return segment === undefined ? [] : [[segment.a, segment.b] as const];
  });
  const isSamePair = ({ a, b }: Ends, [first, second]: readonly [string, string]) =>
    (a === first && b === second) || (a === second && b === first);
  return new Set(
    [...ends]
      .filter(
        ([, end]) =>
          vertices.has(end.a as string) ||
          vertices.has(end.b as string) ||
          pairs.some((pair) => isSamePair(end, pair)),
      )
      .map(([id]) => id),
  );
}

/** How many command runs, over all seeds, started on a path with a hidden member. */
let hiddenRuns = 0;

describe.each(SEEDS)('commands on paths with hidden members (seed %i)', (seed) => {
  it('never throw, never touch what the read hides, and converge once delivered', () => {
    const random = createSeededRandom(seed);
    const clients = openClients();
    let created = 0;
    const fresh = () => `n${String(seed)}_${String(created++)}`;
    let runsOnHiddenState = 0;
    for (let step = 0; step < STEPS; step += 1) {
      const client = random.pick(clients);
      if (random.below(10) < 4) {
        deliverSome(client, random);
        continue;
      }
      const { store } = client;
      const path = store.get(PATH as never);
      if (path?.type !== 'path') continue;
      const hidden = store.read().issues.filter(isHiddenMemberIssue);
      const isNetworkEdit = random.below(14) < 5;
      const edit = isNetworkEdit ? networkEdit(path, random, fresh) : undefined;
      const name: CommandName = isNetworkEdit ? 'editNetwork' : random.pick(OTHER_COMMANDS);
      const group = [...store.read().objects.values()].find(({ type }) => type === 'group');
      const input = isNetworkEdit ? edit : otherInput(name as never, random, group?.id ?? 'none');
      if (input === undefined) continue;
      const where = `seed ${String(seed)} step ${String(step)} ${name}`;
      const before = store.encodeState();
      const endsBefore = storedEnds(store);
      const stored = {
        vertices: storedIds(store, 'vertices'),
        segments: storedIds(store, 'segments'),
      };
      const outcome = runCommand(
        store,
        ADA,
        COMMANDS[name] as AnyCommand,
        input,
        testEnvironment(seed * 1000 + step),
      );
      if (hidden.length > 0) runsOnHiddenState += 1;
      if (outcome.status === 'rejected') {
        expect(store.encodeState(), `${where}: a refusal wrote something`).toEqual(before);
        continue;
      }
      const after = {
        vertices: storedIds(store, 'vertices'),
        segments: storedIds(store, 'segments'),
      };
      const allowed = isNetworkEdit
        ? collectable(input as Deletions, path, endsBefore)
        : new Set<string>();
      expect(
        stored.vertices.filter((id) => !after.vertices.includes(id) && !isNetworkEdit),
        `${where}: deleted a vertex`,
      ).toEqual([]);
      expect(
        stored.segments
          .filter((id) => !after.segments.includes(id) && !allowed.has(id))
          .filter((id) => hidden.some(({ member }) => member === id)),
        `${where}: deleted a hidden segment`,
      ).toEqual([]);
    }
    hiddenRuns += runsOnHiddenState;
    // Deliver everything (a delivery can make a client write a repair, which then has to travel).
    for (let round = 0; round < 6; round += 1) {
      for (const client of clients) {
        for (const update of client.inbox.splice(0)) client.store.applyUpdate(update, RELAY);
      }
    }
    const [first, second, third] = clients;
    expect(second?.store.encodeState(), `seed ${String(seed)}`).toEqual(first?.store.encodeState());
    expect(third?.store.encodeState(), `seed ${String(seed)}`).toEqual(first?.store.encodeState());
    if (first === undefined || second === undefined || third === undefined) return;
    expectValidAndConverged(first.store, second.store);
    expectValidAndConverged(first.store, third.store);
  });
});

describe('the walks', () => {
  it('ran many commands on paths with hidden members', () => {
    expect(hiddenRuns).toBeGreaterThan(100);
  });
});
