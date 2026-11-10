import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { ATLAS, createAgentBoard } from './__fixtures__/agent-board.js';
import { agentColorOf } from './agent-color.js';
import { agentNameOf } from './agent-name.js';
import { liftOffNotice } from './lift-off-notice.js';
import { placeSheets, sheetBoundsOf, traceTintOf } from './trace-sheet-bounds.js';

const ATLAS_ID = 'agent:atlas' as PrincipalId;

describe('sheetBoundsOf and placeSheets', () => {
  it('covers the union of the objects’ world bounds', () => {
    const board = createAgentBoard();
    const ids = board.agentCreates([0, 300]);
    expect(sheetBoundsOf(board.person, ids)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 60 });
    const placed = placeSheets(board.person, [{ agentId: ATLAS_ID, memberIds: ids }]);
    expect(traceTintOf(placed, [0.5, 0.5, 0.5, 1])).toEqual({
      sheets: [{ bounds: { minX: 0, minY: 0, maxX: 400, maxY: 60 }, color: [0.5, 0.5, 0.5, 1] }],
    });
  });

  it('places an object inside a group through the group’s transform, read from the board', () => {
    const base = {
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: ATLAS_ID,
      createdAt: 1,
      updatedAt: 1,
    } as const;
    const group: BoardObject = {
      ...base,
      id: 'group' as ObjectId,
      type: 'group',
      parentId: null,
      x: 100,
      y: 50,
    };
    const child: BoardObject = {
      ...base,
      id: 'child' as ObjectId,
      type: 'shape',
      parentId: group.id,
      x: 5,
      y: 5,
      width: 10,
      height: 20,
      kind: 'rectangle',
      cornerRadius: 0,
      sides: 4,
      label: null,
      stroke: null,
      fill: [1, 0, 0, 1],
    };
    const objects = new Map([group, child].map((object) => [object.id, object]));
    const board = { get: (id: ObjectId) => objects.get(id) };
    expect(sheetBoundsOf(board, [group.id, child.id])).toEqual({
      minX: 105,
      minY: 55,
      maxX: 115,
      maxY: 75,
    });
  });

  it('leaves out a sheet none of whose objects is on the board', () => {
    const board = createAgentBoard();
    expect(
      placeSheets(board.person, [{ agentId: ATLAS_ID, memberIds: ['gone' as never] }]),
    ).toEqual([]);
  });
});

describe('agentNameOf', () => {
  it('reads the agent’s presence name, else its id', () => {
    expect(agentNameOf(ATLAS_ID, [ATLAS])).toBe('Atlas');
    expect(agentNameOf(ATLAS_ID, [{ ...ATLAS, kind: 'user' }])).toBe('atlas');
    expect(agentNameOf('agent:scout' as PrincipalId, [ATLAS])).toBe('scout');
  });

  it('reads the name presence last gave a stopped agent while it is away', () => {
    expect(agentNameOf(ATLAS_ID, [], 'Atlas')).toBe('Atlas');
    expect(agentNameOf(ATLAS_ID, [{ ...ATLAS, name: 'Atlas 2' }], 'Atlas')).toBe('Atlas 2');
  });

  it('names an agent key’s agent by the key’s name its presence carries', () => {
    const keyAgent = { ...ATLAS, principalId: 'agent-key:k1', name: 'Planner' };
    const keyAgentId = 'agent:agent-key:k1' as PrincipalId;
    expect(agentNameOf(keyAgentId, [ATLAS, keyAgent])).toBe('Planner');
    expect(agentNameOf(keyAgentId, [], 'Planner')).toBe('Planner');
  });
});

describe('liftOffNotice', () => {
  const ids = (count: number) =>
    Array.from({ length: count }, (unused, index) => `o${String(index)}`);
  it('says nothing when everything went, and what stayed otherwise', () => {
    const outcome = (lifted: number, kept: number, status = 'applied') =>
      ({ status, liftedIds: ids(lifted), keptIds: ids(kept) }) as never;
    expect(liftOffNotice(outcome(3, 0), 'Atlas')).toBeUndefined();
    expect(liftOffNotice(outcome(3, 1), 'Atlas')).toBe(
      'Lifted off 3 objects. Kept 1 object someone has changed since.',
    );
    expect(liftOffNotice(outcome(1, 2), 'Atlas')).toBe(
      'Lifted off 1 object. Kept 2 objects someone has changed since.',
    );
    expect(liftOffNotice(outcome(0, 2, 'nothing'), 'Atlas')).toBe(
      'Nothing lifted off: kept 2 objects someone has changed since.',
    );
    expect(liftOffNotice(outcome(0, 0, 'rejected'), 'Atlas')).toBe(
      'Could not lift off Atlas’s sheet.',
    );
  });
});

describe('agentColorOf', () => {
  it('reads --color-hand-agent of each theme', () => {
    expect(agentColorOf('dark').map((value) => Math.round(value * 255))).toEqual([
      157, 180, 196, 255,
    ]);
    expect(agentColorOf('light').map((value) => Math.round(value * 255))).toEqual([
      78, 110, 134, 255,
    ]);
  });
});
