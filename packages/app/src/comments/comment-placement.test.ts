import { describe, expect, it } from 'vitest';

import {
  addPageCommand,
  createObjectCommand,
  deletePageCommand,
  moveObjectsToPageCommand,
  runCommand,
  YjsDocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import {
  createBoard,
  DEFAULT_PAGE_ID,
  shownPageIdOf,
  type BoardObject,
  type ObjectId,
  type PageId,
  type PrincipalId,
  type Rgba,
  type TokenId,
} from '@canvas/schema';

import { commentPlacement, placeThreadPin } from './comment-placement.js';

const ORIGIN: TransactionOrigin = { kind: 'user', principalId: 'user:comments' as PrincipalId };
const ENVIRONMENT = {
  clock: () => 1_790_000_000_000,
  createId: () => 'note' as ObjectId,
};

/**
 * A 100 × 100 rectangle at the origin.
 *
 * @param id - Its id.
 * @param z - Its z key.
 * @param fill - Its fill.
 * @returns The object.
 */
function square(id: string, z: string, fill: unknown): BoardObject {
  return {
    id: id as ObjectId,
    parentId: null,
    rotation: 0,
    locked: false,
    createdBy: 'user:comments',
    createdAt: 1,
    updatedAt: 1,
    x: 0,
    y: 0,
    z,
    type: 'shape',
    kind: 'rectangle',
    width: 100,
    height: 100,
    stroke: null,
    fill,
    cornerRadius: 0,
    sides: 4,
    label: null,
  } as BoardObject;
}

/**
 * A store with two pages, each holding a square at the origin; the first page's sits higher in
 * z, so a hit test over the whole board finds it first.
 *
 * @returns The store and the second page, "Whiteboard".
 * @throws {Error} When the page was not added.
 */
function twoPageStore(): { store: YjsDocumentStore; whiteboard: PageId } {
  const store = new YjsDocumentStore();
  const added = runCommand(store, ORIGIN, addPageCommand, { name: 'Whiteboard' }, ENVIRONMENT);
  expect(added.status).toBe('applied');
  const whiteboard = [...store.readPages().values()].find(({ name }) => name === 'Whiteboard');
  if (whiteboard === undefined) throw new Error('no Whiteboard page');
  for (const [id, pageId, z] of [
    ['overview-frame', DEFAULT_PAGE_ID, 'a5'],
    ['whiteboard-frame', whiteboard.id, 'a0'],
  ] as const) {
    const object = {
      type: 'shape' as const,
      id,
      x: 0,
      y: 0,
      z,
      pageId,
      kind: 'rectangle' as const,
      width: 100,
      height: 100,
      fill: [1, 1, 1, 1] as Rgba,
      stroke: null,
      cornerRadius: 0,
      sides: 4,
      label: null,
    };
    const created = runCommand(store, ORIGIN, createObjectCommand, { object }, ENVIRONMENT);
    expect(created, JSON.stringify(created)).toMatchObject({ status: 'applied' });
  }
  return { store, whiteboard: whiteboard.id };
}

describe('comment placement', () => {
  it('reaches through a token fill transparent in the viewer theme', () => {
    const ghost = {
      id: 'ghost' as TokenId,
      name: 'Ghost',
      light: [0, 0, 0, 0] as Rgba,
      dark: [0, 0, 1, 1] as Rgba,
      builtin: false,
      createdBy: null,
      createdAt: 0,
    };
    const board = createBoard(
      [square('below', 'a0', [1, 0, 0, 1]), square('ghost', 'a1', { token: 'ghost' })],
      undefined,
      [ghost],
    );
    const anchorOf = (theme: 'light' | 'dark') => {
      const { anchor } = commentPlacement(board, { x: 50, y: 50 }, 1, theme);
      return anchor.kind === 'object' ? anchor.objectId : undefined;
    };
    expect(anchorOf('light')).toBe('below');
    expect(anchorOf('dark')).toBe('ghost');
  });

  it('anchors in a rotated object local frame and leaves the document untouched until posting', () => {
    const store = new YjsDocumentStore();
    const created = runCommand(
      store,
      ORIGIN,
      createObjectCommand,
      {
        object: {
          type: 'sticky',
          x: 100,
          y: 100,
          rotation: Math.PI / 2,
          width: 160,
          height: 160,
          text: '',
          runs: [
            {
              length: 0,
              style: {
                fontFamily: 'Inter',
                fontSize: 16,
                color: [0, 0, 0, 1],
                weight: 400,
                italic: false,
              },
            },
          ],
          align: 'center',
          autoWidth: false,
          verticalAlign: 'middle',
          color: [1, 0.92, 0.55, 1],
        },
      },
      ENVIRONMENT,
    );
    expect(created, JSON.stringify(created)).toMatchObject({ status: 'applied' });
    const before = store.read();
    const placement = commentPlacement(before, { x: 80, y: 130 });
    expect(placement.anchor.kind).toBe('object');
    if (placement.anchor.kind === 'object') {
      expect(placement.anchor.offset.x).toBeCloseTo(30);
      expect(placement.anchor.offset.y).toBeCloseTo(20);
    }
    expect(store.read()).toBe(before);
    expect(placeThreadPin({ store, origin: ORIGIN }, placement, 'thread')).toBe(true);
    expect(store.read().objects.get(placement.id)).toMatchObject({
      type: 'comment',
      threadId: 'thread',
    });
    store.destroy();
  });
  it('anchors and places a pin on the page shown, not the first page', () => {
    const { store, whiteboard } = twoPageStore();
    const placement = commentPlacement(store.read(), { x: 50, y: 50 }, 1, 'light', whiteboard);
    expect(placement.anchor).toMatchObject({ kind: 'object', objectId: 'whiteboard-frame' });
    expect(placeThreadPin({ store, origin: ORIGIN }, placement, 'thread')).toBe(true);
    const pin = store.read().objects.get(placement.id);
    expect(pin).toMatchObject({ type: 'comment', parentId: null, pageId: whiteboard });
    if (pin !== undefined) expect(shownPageIdOf(store.read(), pin)).toBe(whiteboard);
    store.destroy();
  });
  it('keeps the page but not an anchor moved to another page while composing', () => {
    const { store, whiteboard } = twoPageStore();
    const placement = commentPlacement(store.read(), { x: 50, y: 50 }, 1, 'light', whiteboard);
    const moved = runCommand(
      store,
      ORIGIN,
      moveObjectsToPageCommand,
      { ids: ['whiteboard-frame'], pageId: DEFAULT_PAGE_ID },
      ENVIRONMENT,
    );
    expect(moved.status).toBe('applied');
    expect(placeThreadPin({ store, origin: ORIGIN }, placement, 'thread')).toBe(true);
    expect(store.read().objects.get(placement.id)).toMatchObject({
      pageId: whiteboard,
      anchor: { kind: 'point' },
    });
    store.destroy();
  });
  it('still places the pin when its page was deleted while composing', () => {
    const { store, whiteboard } = twoPageStore();
    const placement = commentPlacement(store.read(), { x: 50, y: 50 }, 1, 'light', whiteboard);
    const deleted = runCommand(
      store,
      ORIGIN,
      deletePageCommand,
      { pageId: whiteboard },
      ENVIRONMENT,
    );
    expect(deleted.status).toBe('applied');
    expect(placeThreadPin({ store, origin: ORIGIN }, placement, 'thread')).toBe(true);
    expect(store.read().objects.get(placement.id)).toMatchObject({
      pageId: DEFAULT_PAGE_ID,
      anchor: { kind: 'point' },
    });
    store.destroy();
  });
  it('anchors to a point when nothing on the page shown is under the click', () => {
    const page = 'page-2' as PageId;
    const board = createBoard(
      [{ ...square('overview-frame', 'a0', [1, 1, 1, 1]), pageId: DEFAULT_PAGE_ID }],
      [
        { id: DEFAULT_PAGE_ID, name: 'Overview', order: 'a0' },
        { id: page, name: 'Whiteboard', order: 'a1' },
      ],
    );
    const placement = commentPlacement(board, { x: 50, y: 50 }, 1, 'light', page);
    expect(placement.anchor).toEqual({ kind: 'point' });
    expect(placement.pageId).toBe(page);
  });
  it('places on empty board and refuses a duplicate pin without changing its thread', () => {
    const store = new YjsDocumentStore();
    const placement = commentPlacement(store.read(), { x: 50, y: 70 });
    expect(placement.anchor).toEqual({ kind: 'point' });
    const connection = { store, origin: ORIGIN };
    expect(placeThreadPin(connection, placement, 'first')).toBe(true);
    expect(placeThreadPin(connection, placement, 'second')).toBe(false);
    expect(store.read().objects.get(placement.id)).toMatchObject({ threadId: 'first' });
    store.destroy();
  });
});
