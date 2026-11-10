import { describe, expect, it, vi } from 'vitest';

import type { DocumentTransaction, TextStylePatch } from '@canvas/document';
import type {
  BoardObject,
  ObjectId,
  Page,
  PageId,
  PrincipalId,
  Segment,
  TextStyle,
  Vertex,
} from '@canvas/schema';

import { PageTransaction } from './page-transaction.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ID = 'box' as ObjectId;

/**
 * A transaction that records every call, holding one object a test names.
 *
 * @param held - The object it holds, if any.
 * @returns The transaction.
 */
function fakeTransaction(held?: BoardObject) {
  const pages = new Map<PageId, Page>();
  return {
    origin: ORIGIN,
    markRestore: vi.fn(),
    get: vi.fn((id: ObjectId) => (id === held?.id ? held : undefined)),
    setObject: vi.fn<(object: BoardObject) => void>(),
    patchObject: vi.fn(),
    pages: vi.fn(() => pages),
    setPage: vi.fn(),
    deletePage: vi.fn(() => true),
    tokens: vi.fn(() => new Map()),
    setToken: vi.fn(),
    deleteToken: vi.fn(() => true),
    deleteObject: vi.fn(() => true),
    insertText: vi.fn(),
    deleteText: vi.fn(),
    formatText: vi.fn(),
    setVertex: vi.fn(),
    deleteVertex: vi.fn(() => true),
    setSegment: vi.fn(),
    deleteSegment: vi.fn(() => false),
    namedStyles: vi.fn(() => new Map()),
    setNamedStyle: vi.fn(),
    deleteNamedStyle: vi.fn(() => false),
    setBoardTimer: vi.fn(),
    setStickyAuthors: vi.fn(),
  } satisfies DocumentTransaction;
}

/**
 * A root object.
 *
 * @param pageId - Its page: a page, null, or none at all.
 * @returns The object.
 */
function root(pageId: string | null | undefined): BoardObject {
  return {
    id: ID,
    parentId: null,
    ...(pageId === undefined ? {} : { pageId }),
  } as unknown as BoardObject;
}

describe('PageTransaction', () => {
  it('puts a new root object with no page or a null page on the page shown', () => {
    const inner = fakeTransaction();
    const transaction = new PageTransaction(inner, 'p2' as PageId);
    transaction.setObject(root(undefined));
    transaction.setObject(root(null));
    transaction.setObject(root('page-1'));
    expect(inner.setObject.mock.calls.map(([written]) => written.pageId)).toEqual([
      'p2',
      'p2',
      'page-1',
    ]);
  });

  it('leaves an object the board holds where it is', () => {
    const held = root(undefined);
    const inner = fakeTransaction(held);
    new PageTransaction(inner, 'p2' as PageId).setObject(held);
    expect(inner.setObject).toHaveBeenCalledWith(held);
  });

  it('passes every other read and write to the whole board as it is', () => {
    const inner = fakeTransaction();
    const transaction = new PageTransaction(inner, 'p2' as PageId);
    const style = {} as TextStyle;
    const vertex = { id: 'v' } as unknown as Vertex;
    const segment = { id: 's' } as unknown as Segment;
    const page = { id: 'p3' } as unknown as Page;
    expect(transaction.origin).toBe(ORIGIN);
    const marker = {} as Parameters<DocumentTransaction['markRestore']>[0];
    const creation = { createdBy: ORIGIN.principalId, createdAt: 1 };
    transaction.markRestore(marker);
    expect(transaction.pages()).toBe(inner.pages.mock.results[0]?.value);
    transaction.setPage(page, creation);
    expect(transaction.deletePage('p3' as PageId)).toBe(true);
    transaction.patchObject(ID, { x: 1 });
    expect(transaction.deleteObject(ID)).toBe(true);
    transaction.insertText(ID, 0, 'hi', style);
    transaction.deleteText(ID, 0, 1);
    transaction.formatText(ID, 0, 1, { bold: true } as TextStylePatch);
    transaction.setVertex(ID, vertex);
    expect(transaction.deleteVertex(ID, 'v')).toBe(true);
    transaction.setSegment(ID, segment);
    expect(transaction.deleteSegment(ID, 's')).toBe(false);
    expect(inner.markRestore).toHaveBeenCalledWith(marker);
    expect(inner.setPage).toHaveBeenCalledWith(page, creation);
    expect(inner.patchObject).toHaveBeenCalledWith(ID, { x: 1 });
    expect(inner.insertText).toHaveBeenCalledWith(ID, 0, 'hi', style);
    expect(inner.deleteText).toHaveBeenCalledWith(ID, 0, 1);
    expect(inner.formatText).toHaveBeenCalledWith(ID, 0, 1, { bold: true });
    expect(inner.setVertex).toHaveBeenCalledWith(ID, vertex);
    expect(inner.deleteVertex).toHaveBeenCalledWith(ID, 'v');
    expect(inner.setSegment).toHaveBeenCalledWith(ID, segment);
    expect(inner.deleteSegment).toHaveBeenCalledWith(ID, 's');
  });
});
