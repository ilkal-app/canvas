// CONTRACT: a thread's place resolves service pins first and preserves document pins until adoption.
import { expect, it } from 'vitest';

import {
  addPageCommand,
  createObjectCommand,
  moveObjectsToPageCommand,
  runCommand,
  YjsDocumentStore,
} from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId, type PrincipalId } from '@canvas/schema';

import { threadPinPlaceOf } from './thread-pin-place.js';

const origin = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const environment = { clock: () => 1, createId: () => 'second-page' as ObjectId };
const point = { x: 7, y: 9 };
interface Pin {
  pageId: string;
  anchor:
    { kind: 'point' } | { kind: 'object'; objectId: string; offset: { x: number; y: number } };
  point: { x: number; y: number };
}
const thread = (pin: Pin) => ({ pinId: 'pin', pin });

function boardWithTarget() {
  const store = new YjsDocumentStore();
  runCommand(
    store,
    origin,
    createObjectCommand,
    {
      object: {
        type: 'frame',
        id: 'frame',
        x: 100,
        y: 200,
        width: 300,
        height: 200,
        name: 'Frame',
        clip: false,
        background: null,
        rotation: Math.PI / 2,
      },
    },
    environment,
  );
  runCommand(
    store,
    origin,
    createObjectCommand,
    {
      object: {
        type: 'shape',
        id: 'target',
        parentId: 'frame',
        x: 20,
        y: 30,
        width: 100,
        height: 50,
        kind: 'rectangle',
        stroke: { color: [0, 0, 0, 1], width: 2 },
        fill: [1, 1, 1, 1],
        cornerRadius: 0,
        sides: 4,
        label: null,
      },
    },
    environment,
  );
  return store;
}

it('uses the service point and page even when no document comment exists', () => {
  const store = new YjsDocumentStore();
  expect(
    threadPinPlaceOf(
      store.read(),
      thread({ pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' }, point }),
    ),
  ).toEqual({ pageId: DEFAULT_PAGE_ID, point });
  store.destroy();
});

it('follows a nested target through its rotated parent and returns that target', () => {
  const store = boardWithTarget();
  const target = store.read().objects.get('target' as ObjectId);
  const place = threadPinPlaceOf(
    store.read(),
    thread({
      pageId: DEFAULT_PAGE_ID,
      anchor: { kind: 'object', objectId: 'target', offset: { x: 5, y: 6 } },
      point,
    }),
  );
  expect(place).toEqual({ pageId: DEFAULT_PAGE_ID, point: { x: 64, y: 225 }, target });
  store.destroy();
});

it('uses the stored point if an object is gone, unknown, or shown on another page', () => {
  const store = boardWithTarget();
  const objectPin = (objectId: string) =>
    thread({
      pageId: DEFAULT_PAGE_ID,
      anchor: { kind: 'object', objectId, offset: { x: 5, y: 6 } },
      point,
    });
  expect(threadPinPlaceOf(store.read(), objectPin('gone'))).toEqual({
    pageId: DEFAULT_PAGE_ID,
    point,
  });
  runCommand(store, origin, addPageCommand, { name: 'Second' }, environment);
  const second = [...store.readPages().keys()].find((id) => id !== DEFAULT_PAGE_ID);
  if (second === undefined) throw new Error('No second page');
  runCommand(
    store,
    origin,
    moveObjectsToPageCommand,
    { ids: ['frame'], pageId: second },
    environment,
  );
  expect(
    threadPinPlaceOf(
      store.read(),
      thread({
        pageId: DEFAULT_PAGE_ID,
        anchor: { kind: 'object', objectId: 'target', offset: { x: 5, y: 6 } },
        point,
      }),
    ),
  ).toEqual({ pageId: DEFAULT_PAGE_ID, point });
  store.destroy();
});

it('resolves a legacy document pin by pinId and returns undefined when it is missing', () => {
  const store = new YjsDocumentStore();
  expect(threadPinPlaceOf(store.read(), { pinId: 'missing' })).toBeUndefined();
  runCommand(
    store,
    origin,
    createObjectCommand,
    {
      object: {
        type: 'comment',
        id: 'pin',
        x: 40,
        y: 50,
        threadId: 'thread',
        anchor: { kind: 'point' },
      },
    },
    environment,
  );
  expect(threadPinPlaceOf(store.read(), { pinId: 'pin', pin: null })).toEqual({
    pageId: DEFAULT_PAGE_ID,
    point: { x: 40, y: 50 },
  });
  store.destroy();
});
