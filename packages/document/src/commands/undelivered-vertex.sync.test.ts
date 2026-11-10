// A segment arrives from a peer before the vertex it ends at (the vertex's update is
// still on its way). The read hides the segment and reports it (`hidden-segment`), and
// no command may throw on such a path, write the hidden segment back as if it were visible, or
// delete it as a side effect of an edit that has nothing to do with it: when the vertex arrives
// the segment must be whole again, on every client. Real updates, both client-id orders.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { idsOf, PATH, pathOf, storedIds, ZERO } from './__fixtures__/network-fixtures.js';
import {
  deliverEverything,
  segmentBeforeVertex,
  type SegmentBeforeVertex,
} from './__fixtures__/undelivered-fixtures.js';
import type { AnyCommand } from './command.js';
import { COMMANDS, type CommandName } from './registry.js';
import { runCommand } from './run-command.js';

/** One command run on the path Cara holds, and what must be true afterwards. */
interface Case {
  readonly name: CommandName;
  readonly label: string;
  readonly input: unknown;
  /** `applied`, or `rejected` with these error codes (and nothing written). */
  readonly outcome: 'applied' | readonly string[];
  /** The segments the path shows on every client once the vertex has been delivered. */
  readonly visibleAfter: readonly string[];
  /** The segments still hidden and reported then (kept stored, waiting for a vertex). */
  readonly hiddenAfter?: readonly string[];
}

const ALL_SEGMENTS = ['s1', 's2', 's3', 'sA'] as const;
const MOVE = { moves: [{ id: PATH, by: { x: 5, y: 5 } }] };

const CASES: readonly Case[] = [
  ...(['bringToFront', 'sendToBack', 'bringForward', 'sendBackward'] as const).map(
    (name): Case => ({
      name,
      label: name,
      input: { ids: [PATH] },
      outcome: 'applied',
      visibleAfter: ALL_SEGMENTS,
    }),
  ),
  {
    name: 'moveObjects',
    label: 'move',
    input: MOVE,
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'moveObjects',
    label: 'move into a frame',
    input: { moves: [{ id: PATH, by: { x: 5, y: 5 }, parentId: 'frame-plan' }] },
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'rotateObjects',
    label: 'rotate',
    input: { rotations: [{ id: PATH, by: 0.5 }] },
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'resizeObjects',
    label: 'resize (a path has no stored size)',
    input: { resizes: [{ id: PATH, to: { width: 500, height: 300 } }] },
    outcome: ['unsupported-type'],
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'setStyle',
    label: 'restyle',
    input: { changes: [{ id: PATH, style: { fill: [1, 0, 0, 1] } }] },
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'setLocked',
    label: 'lock',
    input: { ids: [PATH], locked: true },
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'group',
    label: 'group',
    input: { ids: [PATH] },
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'createObjects',
    label: 'duplicate (a paste of the path as it is shown)',
    input: 'DUPLICATE',
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'editNetwork',
    label: 'move a vertex',
    input: { id: PATH, setVertices: [{ id: 'v2', x: 90, y: 9, mirror: 'both' }] },
    outcome: 'applied',
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'editNetwork',
    label: 'add a vertex with its segment',
    input: {
      id: PATH,
      setVertices: [{ id: 'v9', x: 5, y: 5, mirror: 'none' }],
      setSegments: [{ id: 's9', a: 'v2', b: 'v9', ha: ZERO, hb: ZERO }],
    },
    outcome: 'applied',
    visibleAfter: [...ALL_SEGMENTS, 's9'],
  },
  {
    name: 'editNetwork',
    label: 'delete a vertex and its segment (v3, s2)',
    input: { id: PATH, deleteVertexIds: ['v3'], deleteSegmentIds: ['s2'] },
    outcome: 'applied',
    // sA ends at the deleted v3, so it stays stored and hidden; s3 is untouched.
    visibleAfter: ['s1', 's3'],
    hiddenAfter: ['sA'],
  },
  {
    name: 'editNetwork',
    label: 'delete the vertex the hidden segment also ends at (v1, s1)',
    input: { id: PATH, deleteVertexIds: ['v1'], deleteSegmentIds: ['s1'] },
    outcome: 'applied',
    // s3 ends at the deleted v1: kept stored (an undo of the delete shows it), hidden for now.
    visibleAfter: ['s2', 'sA'],
    hiddenAfter: ['s3'],
  },
  {
    name: 'editNetwork',
    label: 'delete the hidden segment by name (the path has no such segment)',
    input: { id: PATH, deleteSegmentIds: ['s3'] },
    outcome: ['invalid-input'],
    visibleAfter: ALL_SEGMENTS,
  },
  {
    name: 'editNetwork',
    label: 'join the undelivered vertex (the path has no such vertex)',
    input: { id: PATH, setSegments: [{ id: 's8', a: 'v1', b: 'v4', ha: ZERO, hb: ZERO }] },
    outcome: ['invalid-object'],
    visibleAfter: ALL_SEGMENTS,
  },
];

/**
 * The input of the duplicate case: the path as Cara's read shows it, under a new id.
 *
 * @param scenario - The scenario.
 * @returns The `createObjects` input.
 */
function duplicateInput(scenario: SegmentBeforeVertex): unknown {
  // `createObjects` sets these itself and refuses them in the input.
  const generated = new Set(['id', 'z', 'createdBy', 'createdAt', 'updatedAt']);
  const shown = Object.entries(pathOf(scenario.cara)).filter(([field]) => !generated.has(field));
  return { objects: [{ ...Object.fromEntries(shown), id: 'copy' }] };
}

describe.each(ORDERS)('a segment whose vertex is not delivered yet ($name)', (order) => {
  const build = () => segmentBeforeVertex(order.adaClientId, order.bobClientId);

  it('is stored, hidden by the read and reported', () => {
    const { cara } = build();
    expect(storedIds(cara, 'segments')).toEqual(['s1', 's2', 's3']);
    expect(storedIds(cara, 'vertices')).toEqual(['v1', 'v2', 'v3']);
    expect(idsOf(pathOf(cara).segments)).toEqual(['s1', 's2']);
    expect(cara.read().issues).toEqual([
      {
        code: 'hidden-segment',
        key: PATH,
        field: 'segments',
        member: 's3',
        message: 'segments: segment "s3" ends at missing vertex "v4"',
      },
    ]);
  });

  it.each(CASES)('$label: no throw, hidden segment kept, whole when the vertex arrives', (item) => {
    const scenario = build();
    const { cara } = scenario;
    const input = item.input === 'DUPLICATE' ? duplicateInput(scenario) : item.input;
    const before = cara.encodeState();
    const outcome = runCommand(
      cara,
      ADA,
      COMMANDS[item.name] as AnyCommand,
      input,
      testEnvironment(),
    );
    if (item.outcome === 'applied') {
      expect(outcome.status === 'rejected' ? outcome.errors : 'applied').toEqual('applied');
    } else {
      expect(outcome.status).toBe('rejected');
      expect(outcome.status === 'rejected' ? outcome.errors.map(({ code }) => code) : []).toEqual(
        item.outcome,
      );
      expect(cara.encodeState()).toEqual(before);
    }
    // The hidden segment is still stored, still hidden and still reported; nothing was invented.
    expect(storedIds(cara, 'segments')).toContain('s3');
    expect(storedIds(cara, 'vertices')).not.toContain('v4');
    expect(cara.read().issues).toContainEqual(
      expect.objectContaining({ code: 'hidden-segment', key: PATH, member: 's3' }),
    );
    // The next command works.
    const next = runCommand(
      cara,
      ADA,
      COMMANDS.bringToFront,
      { ids: ['shape-box'] },
      testEnvironment(),
    );
    expect(next.status).toBe('applied');
    // The vertex arrives: every client shows the same path, with the segment whole again.
    deliverEverything(scenario);
    for (const store of [scenario.ada, scenario.bob, scenario.cara]) {
      expect(idsOf(pathOf(store).segments)).toEqual([...item.visibleAfter].sort());
    }
    expect(scenario.cara.read().issues.map(({ member }) => member)).toEqual(item.hiddenAfter ?? []);
  });

  it('is not copied by a duplicate: the copy holds the members the read showed, no more', () => {
    const scenario = build();
    const { cara } = scenario;
    const outcome = runCommand(
      cara,
      ADA,
      COMMANDS.createObjects as AnyCommand,
      duplicateInput(scenario),
      testEnvironment(),
    );
    if (outcome.status !== 'applied') throw new Error('the duplicate was refused');
    const [copyId] = outcome.changes.created;
    const copy = internalsOf(cara)
      .doc.getMap('objects')
      .get(copyId ?? '') as Y.Map<unknown>;
    expect([...(copy.get('segments') as Y.Map<unknown>).keys()].sort()).toEqual(['s1', 's2']);
    expect([...(copy.get('vertices') as Y.Map<unknown>).keys()].sort()).toEqual(['v1', 'v2', 'v3']);
    expect(storedIds(cara, 'segments')).toContain('s3');
  });

  it('is not written back by the ungroup that follows a group', () => {
    const scenario = build();
    const { cara } = scenario;
    const grouped = runCommand(cara, ADA, COMMANDS.group, { ids: [PATH] }, testEnvironment());
    if (grouped.status !== 'applied') throw new Error('the group was refused');
    const ungrouped = runCommand(
      cara,
      ADA,
      COMMANDS.ungroup,
      { ids: [grouped.result.groupId] },
      testEnvironment(),
    );
    expect(ungrouped.status).toBe('applied');
    expect(storedIds(cara, 'segments')).toContain('s3');
    deliverEverything(scenario);
    expect(idsOf(pathOf(scenario.ada).segments)).toEqual([...ALL_SEGMENTS]);
  });

  it('is deleted with the path, and the vertex arriving later changes nothing', () => {
    const scenario = build();
    const outcome = runCommand(
      scenario.cara,
      ADA,
      COMMANDS.deleteObjects,
      { ids: [PATH] },
      testEnvironment(),
    );
    expect(outcome.status).toBe('applied');
    deliverEverything(scenario);
    for (const store of [scenario.ada, scenario.bob, scenario.cara]) {
      expect(store.get(PATH as never)).toBeUndefined();
    }
  });
});
