// Item 1: a command validates the fields it writes, and the cross-field rules they take
// part in, not the whole object. A peer that leaves one field of an object invalid (a negative
// width, a NaN rotation, a nested style value of the wrong kind) no longer blocks every honest
// command on it: each command kind below works on such an object, leaves the invalid field as it
// is when it does not write it, and sends nothing the relay's door refuses. Supersedes the
// refusals of (`stored-invalid-object.sync.test.ts`).
import { describe, expect, it } from 'vitest';

import { boardObjectSchema, type ObjectId, type PrincipalId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA, BODY } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { judgedAtDoor } from './__fixtures__/door-judgement.js';
import { POISONS, poisonedStore, type Poison } from './__fixtures__/poisoned-board.js';
import type { AnyCommand } from './command.js';
import { COMMANDS, type CommandName } from './registry.js';
import { runCommand, type CommandOutcome } from './run-command.js';

/** One command run on the board. */
type Step = readonly [CommandName, unknown];

/** A command kind of item 2, as the steps that make it. */
interface Row {
  /** The command kind. */
  readonly kind: string;
  /** Its steps, run in order. */
  readonly steps: readonly Step[];
  /** The fields its steps write on `box`, so an invalid one there may change. */
  readonly writes: readonly string[];
  /**
   * The poisoned field that refuses the row instead: a size is judged whole, so a
   * resize of the other dimension refuses a width the door refuses rather than keep it, since the
   * hub may have repaired it meanwhile and the door would close the writer for good.
   */
  readonly refusedBy?: Poison['field'];
}

const ROWS: readonly Row[] = [
  {
    kind: 'move',
    steps: [['moveObjects', { moves: [{ id: 'box', by: { x: 40, y: -20 } }] }]],
    writes: ['x', 'y'],
  },
  {
    kind: 'nudge',
    steps: [['moveObjects', { moves: [{ id: 'box', by: { x: 1, y: 0 } }] }]],
    writes: ['x', 'y'],
  },
  {
    kind: 'resize of the other dimension',
    steps: [['resizeObjects', { resizes: [{ id: 'box', by: { width: 0, height: 10 } }] }]],
    writes: ['height'],
    refusedBy: 'width',
  },
  {
    kind: 'rotate',
    steps: [['rotateObjects', { rotations: [{ id: 'box', by: 0.25 }] }]],
    writes: ['x', 'y', 'rotation'],
  },
  {
    kind: 'restyle',
    steps: [['setStyle', { changes: [{ id: 'box', style: { fill: [1, 0, 0, 1] } }] }]],
    writes: ['fill'],
  },
  {
    kind: 'lock and unlock',
    steps: [
      ['setLocked', { ids: ['box'], locked: true }],
      ['setLocked', { ids: ['box'], locked: false }],
    ],
    writes: ['locked'],
  },
  { kind: 'reorder', steps: [['bringToFront', { ids: ['box'] }]], writes: ['z'] },
  {
    kind: 'group and ungroup',
    steps: [
      ['group', { ids: ['box'], groupId: 'g1' }],
      ['ungroup', { ids: ['g1'] }],
    ],
    writes: ['parentId', 'x', 'y', 'rotation', 'z'],
  },
  {
    kind: 'reparent',
    steps: [['moveObjects', { moves: [{ id: 'box', by: { x: 500, y: 0 }, parentId: 'frame' }] }]],
    writes: ['parentId', 'x', 'y', 'rotation', 'z'],
  },
  {
    kind: 'edit label',
    steps: [['setTextRuns', { id: 'box', text: 'Hello', runs: [{ length: 5, style: BODY }] }]],
    writes: ['label'],
  },
  { kind: 'delete', steps: [['deleteObjects', { ids: ['box'] }]], writes: [] },
];

/**
 * Runs a row's steps on a store, stopping at the first refusal.
 *
 * @param store - The store.
 * @param steps - The steps.
 * @returns Each step's outcome.
 */
function runSteps(store: YjsDocumentStore, steps: readonly Step[]): CommandOutcome<unknown>[] {
  const outcomes: CommandOutcome<unknown>[] = [];
  for (const [name, input] of steps) {
    const outcome = runCommand(store, ADA, COMMANDS[name] as AnyCommand, input, testEnvironment());
    outcomes.push(outcome);
    if (outcome.status === 'rejected') break;
  }
  return outcomes;
}

/**
 * The schema's issues of `box` as stored, as a reader that validates it would report them.
 *
 * @param store - The store.
 * @returns The issues' paths and codes.
 */
function storedIssues(store: YjsDocumentStore): string[] {
  const object = store.get('box' as ObjectId);
  if (object === undefined) return [];
  const parsed = boardObjectSchema.safeParse(object);
  return parsed.success
    ? []
    : parsed.error.issues.map(({ path, code }) => `${path.join('.')}:${code}`);
}

/**
 * The stored value of the poisoned field.
 *
 * @param store - The store.
 * @param poison - The poison.
 * @returns The field's value.
 */
function poisonedValue(store: YjsDocumentStore, poison: Poison): unknown {
  return (mustGet(store, 'box') as unknown as Readonly<Record<string, unknown>>)[poison.field];
}

describe.each(POISONS)('every command kind on a shape with $name', (poison) => {
  it.each(ROWS.filter((row) => row.refusedBy === poison.field))(
    '$kind is refused, naming the poisoned size it would keep, and writes nothing',
    (row) => {
      const store = poisonedStore(poison);
      const before = store.encodeState();
      const { result: outcomes, findings } = judgedAtDoor(store, () => runSteps(store, row.steps));
      expect(
        outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? outcome.errors : [])),
      ).toEqual([
        expect.objectContaining({ code: 'invalid-object', objectId: 'box', path: [poison.field] }),
      ]);
      expect(findings).toEqual([]);
      expect(store.encodeState()).toEqual(before);
    },
  );

  it.each(ROWS.filter((row) => row.refusedBy !== poison.field))(
    '$kind applies, keeps the field it does not write, and passes the door',
    (row) => {
      const store = poisonedStore(poison);
      const before = poisonedValue(store, poison);
      const issuesBefore = storedIssues(store);
      expect(issuesBefore).not.toEqual([]);
      const snapshotIssues = store.read().issues;
      const { result: outcomes, findings } = judgedAtDoor(store, () => runSteps(store, row.steps));
      expect(
        outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? outcome.errors : [])),
      ).toEqual([]);
      expect(outcomes).toHaveLength(row.steps.length);
      expect(findings).toEqual([]);
      expect(store.read().issues).toEqual(snapshotIssues);
      if (row.kind === 'delete') {
        expect(store.get('box' as ObjectId)).toBeUndefined();
        return;
      }
      if (!row.writes.includes(poison.field)) {
        expect(poisonedValue(store, poison)).toEqual(before);
        expect(storedIssues(store)).toEqual(issuesBefore);
      }
    },
  );

  it('refuses a duplicate: the copy would be a new object holding the invalid field', () => {
    const store = poisonedStore(poison);
    const before = store.encodeState();
    const { id, createdBy, createdAt, updatedAt, z, ...copy } = mustGet(store, 'box');
    const outcome = runCommand(
      store,
      ADA,
      COMMANDS.createObjects,
      { objects: [{ ...copy, id: 'copy' }], parentId: null },
      testEnvironment(),
    );
    expect([id, createdBy, createdAt, updatedAt, z]).toHaveLength(5);
    expect(outcome.status).toBe('rejected');
    const paths = outcome.status === 'rejected' ? outcome.errors.map(({ path }) => path) : [];
    expect(paths.some((path) => path.includes(poison.field))).toBe(true);
    expect(store.encodeState()).toEqual(before);
  });

  it('refuses a write of a new invalid value to the field, naming it', () => {
    const store = poisonedStore(poison);
    const before = store.encodeState();
    const outcome = runCommand(
      store,
      ADA,
      COMMANDS.resizeObjects,
      { resizes: [{ id: 'box', by: { width: -1_000, height: 0 } }] },
      testEnvironment(),
    );
    expect(outcome.status === 'rejected' ? outcome.errors : []).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'box', path: ['width'] }),
    ]);
    expect(store.encodeState()).toEqual(before);
  });
});

describe('a command never sends a value the relay would refuse', () => {
  /**
   * A store whose `box` a peer left with these placement and size fields.
   *
   * @param name - What the poison is.
   * @param key - The stored group.
   * @param fields - The fields the peer writes there.
   * @returns The store.
   */
  function storeWith(name: string, key: string, fields: Record<string, unknown>): YjsDocumentStore {
    return poisonedStore({
      name,
      field: 'width',
      write: (map) => {
        map.set(key, { ...(map.get(key) as Record<string, unknown>), ...fields });
      },
    });
  }

  it('refuses growing a width a peer left past 2^32, and takes a resize back into range', () => {
    const store = storeWith('a width past 2^32', 'size', { width: 2 ** 40 });
    const { result, findings } = judgedAtDoor(store, () => [
      runCommand(
        store,
        ADA,
        COMMANDS.resizeObjects,
        { resizes: [{ id: 'box', by: { width: -1, height: 0 } }] },
        testEnvironment(),
      ),
      runCommand(
        store,
        ADA,
        COMMANDS.resizeObjects,
        { resizes: [{ id: 'box', to: { width: 100, height: 60 } }] },
        testEnvironment(),
      ),
    ]);
    expect(result[0]?.status === 'rejected' ? result[0].errors : []).toEqual([
      expect.objectContaining({ code: 'invalid-object', path: ['width'] }),
    ]);
    expect(result[1]?.status).toBe('applied');
    expect(findings).toEqual([]);
  });

  it('moves, ungroups and restyles around a rotation a peer left past float32', () => {
    const store = storeWith('a rotation past float32', 'placement', { rotation: 1e300 });
    const { result, findings } = judgedAtDoor(store, () =>
      runSteps(store, [
        ['moveObjects', { moves: [{ id: 'box', by: { x: 5, y: 5 } }] }],
        ['setStyle', { changes: [{ id: 'box', style: { fill: [0, 0, 1, 1] } }] }],
        ['group', { ids: ['box', 'top'], groupId: 'g1' }],
        ['ungroup', { ids: ['g1'] }],
      ]),
    );
    expect(result.map(({ status }) => status)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
    ]);
    expect(findings).toEqual([]);
  });
});

describe('an undo of a command on a poisoned object', () => {
  // Review, concern 2, fixed by: history restores went through no rule, so
  // undoing a resize that brought a width of 2^40 back into range restored 2^40, and undoing a
  // delete re-created it; the relay's door refused either and closed the connection for good.
  // The door guard (`history/door-guard.ts`) leaves such a restore out and says why.
  const farWidth: Poison = {
    name: 'a width past 2^32',
    field: 'width',
    write: (map) => {
      map.set('size', { ...(map.get('size') as Record<string, unknown>), width: 2 ** 40 });
    },
  };

  it('never sends a value the relay would refuse, and keeps the resize', () => {
    const store = poisonedStore(farWidth);
    const history = createHistory(store, 'user:ada' as PrincipalId);
    const resize = { resizes: [{ id: 'box', to: { width: 10, height: 60 } }] };
    runCommand(store, ADA, COMMANDS.resizeObjects, resize, testEnvironment());
    const { result: isChanged, findings } = judgedAtDoor(store, () => history.undo());
    expect(findings).toEqual([]);
    expect(isChanged).toBe(true);
    expect(history.lastOmission()).toBe('out-of-range');
    expect(mustGet(store, 'box')).toMatchObject({ width: 10, height: 60 });
    history.destroy();
  });

  it('never re-creates a deleted object holding a value the relay would refuse', () => {
    const store = poisonedStore(farWidth);
    const history = createHistory(store, 'user:ada' as PrincipalId);
    runCommand(store, ADA, COMMANDS.deleteObjects, { ids: ['box'] }, testEnvironment());
    const { result: isChanged, findings } = judgedAtDoor(store, () => history.undo());
    expect(findings).toEqual([]);
    expect(isChanged).toBe(false);
    expect(history.lastOmission()).toBe('out-of-range');
    expect(store.get('box' as ObjectId)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });
});
