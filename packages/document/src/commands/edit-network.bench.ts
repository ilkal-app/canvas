import { bench, describe } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId, Segment, Vertex } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import type { CommandContext } from './command.js';
import { editNetworkCommand } from './edit-network.js';
import { runCommand } from './run-command.js';

// A vector-edit drag of 100 selected vertices of a 1,000-vertex path: the
// tool previews the drag locally and writes one `editNetwork` on release, but an agent
// or a tool that writes per frame must stay inside a frame. `validate` checks the whole path
// (the schema parse and `findNetworkIssues`), so it is linear in the network; the whole command
// adds the Yjs transaction, which writes only the 100 moved vertices. The whole path is
// validated twice per edit (the command's `validate`, then the store's check of the object it
// writes), on release only: a drag previews without a command. Each iteration moves the vertices
// to the other of two places, so every iteration writes.

const VERTEX_COUNT = 1_000;
const MOVED_COUNT = 100;
const ZERO = { x: 0, y: 0 };

/**
 * A 1,000-vertex open chain on a sine wave, every segment curved.
 *
 * @returns The path.
 */
function longPath(): BoardObject {
  const vertices: Vertex[] = [...Array(VERTEX_COUNT).keys()].map((index) => ({
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
    hb: index % 2 === 0 ? { x: -3, y: 0 } : ZERO,
  }));
  return {
    id: 'long-path' as ObjectId,
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    type: 'path',
    vertices,
    segments,
    stroke: { color: [0.1, 0.1, 0.1, 1], width: 2 },
    fill: null,
  };
}

const PATH = longPath();
const STORE = new YjsDocumentStore();
STORE.transact(ADA, (transaction) => {
  transaction.setObject(PATH);
});
const ENVIRONMENT = testEnvironment();
const MOVED = PATH.type === 'path' ? PATH.vertices.slice(0, MOVED_COUNT) : [];
let round = 0;

/**
 * The drag's edit: the 100 vertices moved down by 5 or back.
 *
 * @param dy - The offset from where they started.
 * @returns The command's input.
 */
function dragInput(dy: number) {
  return { id: PATH.id, setVertices: MOVED.map((vertex) => ({ ...vertex, y: vertex.y + dy })) };
}

const CONTEXT: CommandContext = {
  board: STORE,
  origin: ADA,
  now: 1_770_000_000_000,
  createId: () => 'unused' as ObjectId,
};

describe('editNetwork: 100 of 1,000 vertices dragged', () => {
  bench('validate (the whole path checked)', () => {
    editNetworkCommand.validate(CONTEXT, editNetworkCommand.input.parse(dragInput(5)));
  });

  bench('the whole command (validate, one transaction, 100 members written)', () => {
    round += 1;
    const outcome = runCommand(
      STORE,
      ADA,
      editNetworkCommand,
      dragInput(round % 2 === 0 ? 0 : 5),
      ENVIRONMENT,
    );
    if (outcome.status !== 'applied') throw new Error('the drag was refused');
  });
});
