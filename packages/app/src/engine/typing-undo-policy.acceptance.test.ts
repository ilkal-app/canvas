// A store write outside the typing policy must close after history records it.
import { afterEach, expect, it, vi } from 'vitest';

import {
  createHistory,
  createObjectCommand,
  deleteObjectsCommand,
  runCommand,
  setTextRunsCommand,
  YjsDocumentStore,
} from '@canvas/document';
import type { ObjectId, PrincipalId, TextStyle } from '@canvas/schema';

import { placeThreadPin } from '../comments/comment-placement.js';

import { TYPING_CAPTURE_WINDOW_MS, TypingUndoPolicy } from './typing-undo-policy.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const PIN_ID = 'pin' as ObjectId;
const NOTE_ID = 'note' as ObjectId;
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => NOTE_ID };
const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

const stores: YjsDocumentStore[] = [];
const policies: TypingUndoPolicy[] = [];
const histories: ReturnType<typeof createHistory>[] = [];

afterEach(() => {
  for (const policy of policies.splice(0)) policy.destroy();
  for (const history of histories.splice(0)) history.destroy();
  for (const store of stores.splice(0)) store.destroy();
});

function setup() {
  const store = new YjsDocumentStore();
  const history = createHistory(store, ORIGIN.principalId, {
    captureTimeout: TYPING_CAPTURE_WINDOW_MS,
  });
  const policy = new TypingUndoPolicy(store, history);
  stores.push(store);
  histories.push(history);
  policies.push(policy);
  return { store, history, policy };
}

function createNote(store: YjsDocumentStore): void {
  const result = runCommand(
    store,
    ORIGIN,
    createObjectCommand,
    {
      object: {
        id: NOTE_ID,
        type: 'sticky',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        text: '',
        runs: [{ length: 0, style: STYLE }],
        align: 'center',
        autoWidth: false,
        verticalAlign: 'middle',
        color: [1, 0.92, 0.55, 1],
      },
    },
    ENVIRONMENT,
  );
  expect(result.status).toBe('applied');
}

it('closes a placed pin only after the history records its creation', () => {
  const { store, history } = setup();
  const events: string[] = [];
  const stopCapturing = history.stopCapturing.bind(history);
  vi.spyOn(history, 'stopCapturing').mockImplementation(() => {
    events.push('closed');
    stopCapturing();
  });
  history.subscribe(() => events.push('recorded'));
  expect(
    placeThreadPin(
      { store, origin: ORIGIN },
      { id: PIN_ID, point: { x: 40, y: 50 }, anchor: { kind: 'point' } },
      'thread',
    ),
  ).toBe(true);
  expect(events).toEqual(['recorded', 'closed']);
});

it('closes an external sticky creation only after history records it', () => {
  const { store, history } = setup();
  const events: string[] = [];
  const stopCapturing = history.stopCapturing.bind(history);
  vi.spyOn(history, 'stopCapturing').mockImplementation(() => {
    events.push('closed');
    stopCapturing();
  });
  history.subscribe(() => events.push('recorded'));
  createNote(store);
  expect(events).toEqual(['recorded', 'closed']);
});

it('restores a pin deleted after placement outside the policy, then undoes its placement', () => {
  const { store, history } = setup();
  expect(
    placeThreadPin(
      { store, origin: ORIGIN },
      { id: PIN_ID, point: { x: 40, y: 50 }, anchor: { kind: 'point' } },
      'thread',
    ),
  ).toBe(true);
  expect(store.get(PIN_ID)?.type).toBe('comment');
  const result = runCommand(store, ORIGIN, deleteObjectsCommand, { ids: [PIN_ID] }, ENVIRONMENT);
  expect(result.status).toBe('applied');
  expect(store.get(PIN_ID)).toBeUndefined();
  expect(history.undo()).toBe(true);
  expect(store.get(PIN_ID)).toMatchObject({ type: 'comment', threadId: 'thread' });
  expect(history.undo()).toBe(true);
  expect(store.get(PIN_ID)).toBeUndefined();
});

it('separates non-comment external writes to a sticky', () => {
  const { store, history } = setup();
  createNote(store);
  for (const x of [10, 20]) {
    const note = store.get(NOTE_ID);
    if (note === undefined) throw new Error('sticky was not created');
    store.transact(ORIGIN, (transaction) => {
      transaction.setObject({ ...note, x });
    });
  }
  expect(history.undo()).toBe(true);
  expect(store.get(NOTE_ID)?.x).toBe(10);
  expect(history.undo()).toBe(true);
  expect(store.get(NOTE_ID)?.x).toBe(0);
  expect(history.undo()).toBe(true);
  expect(store.get(NOTE_ID)).toBeUndefined();
});

it('still joins a word typed through the policy after an external change', () => {
  const { store, history, policy } = setup();
  createNote(store);
  for (const word of ['h', 'hi']) {
    policy.typing(
      1,
      () => {
        const result = runCommand(
          store,
          ORIGIN,
          setTextRunsCommand,
          { id: NOTE_ID, text: word, runs: [{ length: word.length, style: STYLE }] },
          ENVIRONMENT,
        );
        expect(result.status).toBe('applied');
      },
      false,
    );
  }
  expect(history.undo()).toBe(true);
  expect(store.get(NOTE_ID)).toMatchObject({ type: 'sticky', text: '' });
  expect(history.undo()).toBe(true);
  expect(store.get(NOTE_ID)).toBeUndefined();
});
