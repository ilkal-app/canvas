// The engine's document side tells the person when an undo is refused because it would delete
// an object another client has edited since, with the notice of. The document
// package tests the rule itself (`packages/document/src/history/creation-guard.sync.test.ts`);
// in Chrome, with two pages: tooling/scenario/specs/app/undo-creation-guard.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import {
  createHistory,
  createObjectCommand,
  runCommand,
  setStyleCommand,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { ObjectId, PrincipalId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { runHistoryCommand } from './engine-document-commands.js';
import type { EditHistory } from './engine-document-types.js';
import { EngineDocument } from './engine-document.js';

/** Another person, on another client. */
const OTHER: TransactionOrigin = { kind: 'user', principalId: 'user:other' as PrincipalId };

/** The command environment of both clients. */
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId };

/** The shape the local person creates, clear of the demo board. */
const SHAPE_ID = 'shape-new' as ObjectId;
/** The demo board's first rectangle. */
const DEMO_MARKER = 'section-0-rect-0-0' as ObjectId;

/**
 * Sends each store what the other lacks, as the relay would.
 *
 * @param first - One store.
 * @param second - The other.
 */
function sync(first: YjsDocumentStore, second: YjsDocumentStore): void {
  second.applyUpdate(first.encodeState(second.encodeStateVector()), SYSTEM_ORIGIN);
  first.applyUpdate(second.encodeState(first.encodeStateVector()), SYSTEM_ORIGIN);
}

describe('EngineDocument undo of a creation', () => {
  it('says so when the object was edited by someone else since, and keeps it', async () => {
    const store = createDemoDocument();
    const peer = new YjsDocumentStore();
    const notices: string[] = [];
    const document = new EngineDocument({
      store,
      history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
      origin: LOCAL_USER_ORIGIN,
      environment: ENVIRONMENT,
      onChange: vi.fn(),
      release: vi.fn(),
      onNotice: (message) => notices.push(message),
    });
    const object = {
      type: 'shape' as const,
      id: SHAPE_ID,
      x: 5_000,
      y: 5_000,
      width: 100,
      height: 60,
      kind: 'rectangle' as const,
      cornerRadius: 0,
      sides: 4,
      fill: [1, 0, 0, 1] as [number, number, number, number],
      stroke: null,
      label: null,
    };
    runCommand(store, LOCAL_USER_ORIGIN, createObjectCommand, { object }, ENVIRONMENT);
    sync(store, peer);
    const fill: [number, number, number, number] = [0, 0, 1, 1];
    const changes = [{ id: SHAPE_ID, style: { fill } }];
    runCommand(peer, OTHER, setStyleCommand, { changes }, ENVIRONMENT);
    sync(store, peer);

    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    expect(store.get(SHAPE_ID)).toMatchObject({ fill });
    await vi.waitFor(() => {
      expect(notices).toEqual(['Nothing to undo here: this has changed since.']);
    });
    document.destroy();
  });
});

describe('EngineDocument undo kept by another person (X2)', () => {
  it('tells the shell who kept it (their Yjs client id) and which object, with the notice', async () => {
    const store = createDemoDocument();
    const peer = new YjsDocumentStore({ clientId: 77 });
    const notices: unknown[][] = [];
    const document = new EngineDocument({
      store,
      history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
      origin: LOCAL_USER_ORIGIN,
      environment: ENVIRONMENT,
      onChange: vi.fn(),
      release: vi.fn(),
      onNotice: (...notice) => notices.push(notice),
    });
    const object = {
      type: 'shape' as const,
      id: SHAPE_ID,
      x: 5_000,
      y: 5_000,
      width: 100,
      height: 60,
      kind: 'rectangle' as const,
      cornerRadius: 0,
      sides: 4,
      fill: [1, 0, 0, 1] as [number, number, number, number],
      stroke: null,
      label: null,
    };
    runCommand(store, LOCAL_USER_ORIGIN, createObjectCommand, { object }, ENVIRONMENT);
    sync(store, peer);
    // A second later, so the peer's command stamps the shape's `updatedAt`, as every edit does.
    const later = { ...ENVIRONMENT, clock: () => ENVIRONMENT.clock() + 1_000 };
    const fill: [number, number, number, number] = [0, 0, 1, 1];
    runCommand(
      peer,
      OTHER,
      setStyleCommand,
      { changes: [{ id: SHAPE_ID, style: { fill } }] },
      later,
    );
    sync(store, peer);

    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    await vi.waitFor(() => {
      expect(notices).toEqual([
        [
          'Nothing to undo here: this has changed since.',
          { isUndo: true, protection: { objectIds: [SHAPE_ID], writers: [77] } },
        ],
      ]);
    });
    document.destroy();
  });

  it('gives no one for a step used up with nothing kept by anyone', () => {
    const notices: unknown[][] = [];
    const history: EditHistory = {
      undo: () => false,
      redo: () => false,
      canUndo: () => true,
      canRedo: () => true,
      lastProtection: () => undefined,
    };
    runHistoryCommand(history, 'redo', (...notice) => notices.push(notice));
    expect(notices).toEqual([['Nothing to redo here: this has changed since.', undefined]]);
  });
});

describe('runHistoryCommand over a value out of range', () => {
  /**
   * A history whose step applies but leaves part of itself out (the rule itself is
   * `packages/document/src/history/door-guard.test.ts`).
   *
   * @param isChanged - What the undo and redo return.
   * @param omittedObjects - How many whole objects it did not bring back.
   * @returns The history.
   */
  function omittingHistory(isChanged: boolean, omittedObjects = 0): EditHistory {
    return {
      undo: () => isChanged,
      redo: () => isChanged,
      canUndo: () => true,
      canRedo: () => true,
      lastOmission: () => 'out-of-range',
      lastOmittedObjects: () => omittedObjects,
    };
  }

  it('says part of the step was left out, whether or not the rest changed anything', () => {
    for (const isChanged of [true, false]) {
      const notices: string[] = [];
      runHistoryCommand(omittingHistory(isChanged), 'undo', (message) => notices.push(message));
      runHistoryCommand(omittingHistory(isChanged), 'redo', (message) => notices.push(message));
      expect(notices).toEqual([
        'Part of this could not be undone: it holds a value out of range.',
        'Part of this could not be redone: it holds a value out of range.',
      ]);
    }
  });

  it('says how many whole objects it could not bring back, with no object content', () => {
    const notices: string[] = [];
    const notice = (message: string): void => {
      notices.push(message);
    };
    runHistoryCommand(omittingHistory(true, 1), 'undo', notice);
    runHistoryCommand(omittingHistory(true, 1200), 'redo', notice);
    expect(notices).toEqual([
      'Undo could not bring back 1 object because its stored values are out of range.',
      'Redo could not bring back 1200 objects because their stored values are out of range.',
    ]);
  });
});

describe('EngineDocument undo of a step changed since', () => {
  it('says so when an undo or redo uses up a step that has changed since', async () => {
    const store = createDemoDocument();
    const notices: string[] = [];
    const document = new EngineDocument({
      store,
      history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
      origin: LOCAL_USER_ORIGIN,
      environment: ENVIRONMENT,
      onChange: vi.fn(),
      release: vi.fn(),
      onNotice: (message) => notices.push(message),
    });
    const other = { kind: 'user', principalId: 'user:other' as PrincipalId } as const;
    const move = (origin: TransactionOrigin, x: number) => {
      store.transact(origin, (transaction) => {
        transaction.patchObject(DEMO_MARKER, { x });
      });
    };
    // A notice comes once the restore settles; the last check's exact list shows that
    // the undos with nothing to say said nothing.
    const run = (command: 'undo' | 'redo') => {
      document.runCanvasAction({ type: 'history', command }, 1);
    };
    run('undo');
    move(LOCAL_USER_ORIGIN, 20);
    move(other, 77);
    run('undo');
    expect(store.get(DEMO_MARKER)).toMatchObject({ x: 77 });
    await vi.waitFor(() => {
      expect(notices).toEqual(['Nothing to undo here: this has changed since.']);
    });
    move(LOCAL_USER_ORIGIN, 30);
    run('undo');
    expect(store.get(DEMO_MARKER)).toMatchObject({ x: 77 });
    move(other, 88);
    run('redo');
    expect(store.get(DEMO_MARKER)).toMatchObject({ x: 88 });
    await vi.waitFor(() => {
      expect(notices).toEqual([
        'Nothing to undo here: this has changed since.',
        'Nothing to redo here: this has changed since.',
      ]);
    });
    document.destroy();
  });
});
