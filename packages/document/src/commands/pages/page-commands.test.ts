import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MAX_PAGES, validateBoard, type PageId } from '@canvas/schema';

import { createFixtureStore } from '../../store/__fixtures__/store-fixtures.js';
import type { ChangeSet } from '../../store/document-store.js';
import type { YjsDocumentStore } from '../../store/yjs-document-store.js';
import {
  applyCommand,
  expectRejected,
  mustGet,
  testEnvironment,
} from '../__fixtures__/command-fixtures.js';
import { connectCommand } from '../connect.js';
import { createObjectCommand } from '../create-object.js';
import { createObjectsCommand } from '../create-objects.js';
import { groupCommand } from '../group.js';
import { moveObjectsCommand } from '../move-objects.js';
import type { newObjectSchema } from '../new-object-schema.js';

import { addPageCommand } from './add-page.js';
import { deletePageCommand } from './delete-page.js';
import { duplicatePageCommand } from './duplicate-page.js';
import { moveObjectsToPageCommand } from './move-to-page.js';
import { renamePageCommand } from './rename-page.js';
import { reorderPageCommand } from './reorder-page.js';

const names = (store: YjsDocumentStore): string[] =>
  [...store.read().pages.values()].map(({ name }) => name);

const add = (store: YjsDocumentStore, input = {}, seed = 11): PageId =>
  applyCommand(store, addPageCommand, input, undefined, testEnvironment(seed)).result.pageId;

const codes = (errors: readonly { readonly code: string }[]): string[] =>
  errors.map(({ code }) => code);

describe('addPage', () => {
  it('names a page by the smallest free number and places it after the given page', () => {
    const store = createFixtureStore();
    const second = add(store, {}, 1);
    add(store, { name: 'Notes' }, 2);
    applyCommand(store, renamePageCommand, { pageId: second, name: 'Two' });
    const after = add(store, { after: 'page-1' }, 3);
    expect(names(store)).toEqual(['Page 1', 'Page 2', 'Two', 'Notes']);
    expect([...store.read().pages.keys()][1]).toBe(after);
    store.destroy();
  });

  it('delivers a change set naming the pages it wrote, and no objects', () => {
    const store = createFixtureStore();
    const seen: ChangeSet[] = [];
    store.subscribe((changes) => seen.push(changes));
    const pageId = add(store);
    expect(seen).toEqual([
      expect.objectContaining({
        created: [],
        updated: [],
        deleted: [],
        pages: ['page-1', pageId].sort(),
      }),
    ]);
    store.destroy();
  });

  it('refuses a missing neighbour, a long name, and a board at the page limit', () => {
    const store = createFixtureStore();
    expect(codes(expectRejected(store, addPageCommand, { after: 'nowhere' }))).toEqual([
      'missing-page',
    ]);
    expect(codes(expectRejected(store, addPageCommand, { name: 'x'.repeat(201) }))).toEqual([
      'invalid-input',
    ]);
    for (let index = 1; index < MAX_PAGES; index += 1) add(store, {}, 100 + index);
    expect(codes(expectRejected(store, addPageCommand, {}))).toEqual(['too-many-pages']);
    expect(codes(expectRejected(store, duplicatePageCommand, { pageId: 'page-1' }))).toEqual([
      'too-many-pages',
    ]);
    store.destroy();
  });
});

describe('renamePage and reorderPage', () => {
  it('write nothing when nothing changes', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    const before = store.encodeState();
    expect(
      applyCommand(store, renamePageCommand, { pageId, name: 'Page 2' }).result.isChanged,
    ).toBe(false);
    expect(
      applyCommand(store, reorderPageCommand, { pageId, after: 'page-1' }).result.isChanged,
    ).toBe(false);
    expect(applyCommand(store, reorderPageCommand, { pageId, before: pageId }).result).toEqual({
      isChanged: false,
    });
    expect(store.encodeState()).toEqual(before);
    store.destroy();
  });

  it('moves a page to the front and refuses an input naming both or no neighbours', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    applyCommand(store, reorderPageCommand, { pageId, before: 'page-1' });
    expect(names(store)).toEqual(['Page 2', 'Page 1']);
    applyCommand(store, reorderPageCommand, { pageId, after: 'page-1' });
    expect(names(store)).toEqual(['Page 1', 'Page 2']);
    const both = { pageId, after: 'page-1', before: 'page-1' };
    expect(codes(expectRejected(store, reorderPageCommand, both))).toEqual(['invalid-input']);
    expect(codes(expectRejected(store, reorderPageCommand, { pageId }))).toEqual(['invalid-input']);
    expect(
      codes(expectRejected(store, reorderPageCommand, { pageId: 'gone', after: 'page-1' })),
    ).toEqual(['missing-page']);
    expect(codes(expectRejected(store, renamePageCommand, { pageId: 'gone', name: 'x' }))).toEqual([
      'missing-page',
    ]);
    store.destroy();
  });
});

describe('duplicatePage and deletePage', () => {
  it('copies an empty page, cutting a long copy name to 200 characters', () => {
    const store = createFixtureStore();
    const pageId = add(store, { name: 'n'.repeat(200) });
    const copy = applyCommand(store, duplicatePageCommand, { pageId }).result.pageId;
    expect(store.read().pages.get(copy)?.name).toBe(`${'n'.repeat(195)} copy`);
    expect([...store.read().pages.keys()]).toEqual(['page-1', pageId, copy]);
    store.destroy();
  });

  it('names the object each copy copies', () => {
    const store = createFixtureStore();
    const before = [...store.read().objects.keys()].sort();
    const { result } = applyCommand(store, duplicatePageCommand, { pageId: 'page-1' });
    const copiedFrom = new Map(Object.entries(result.copiedFrom));
    expect([...copiedFrom.values()].sort()).toEqual(before);
    for (const [copy, source] of copiedFrom) {
      const object = store.get(copy as never);
      const original = store.get(source);
      expect(object?.type).toBe(original?.type);
      // A copy's parent is the copy of its source's parent.
      const parent = original?.parentId ?? null;
      expect(object?.parentId ?? null).toBe(
        parent === null ? null : [...copiedFrom].find(([, from]) => from === parent)?.[0],
      );
    }
    store.destroy();
  });

  it('deletes a page and its objects but no other, and refuses the last page', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    applyCommand(store, moveObjectsToPageCommand, { ids: ['image-photo'], pageId });
    const result = applyCommand(store, deletePageCommand, { pageId }).result;
    expect(result.deletedIds).toEqual(['comment-on-photo', 'image-photo']);
    expect(store.read().pages.has(pageId)).toBe(false);
    expect(store.get('frame-plan' as never)).toBeDefined();
    expect(codes(expectRejected(store, deletePageCommand, { pageId: 'page-1' }))).toEqual([
      'last-page',
    ]);
    expect(codes(expectRejected(store, deletePageCommand, { pageId: 'gone' }))).toEqual([
      'missing-page',
    ]);
    store.destroy();
  });
});

describe('moveObjectsToPage', () => {
  it('writes nothing for objects already on the page and moves children with their parents', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    const before = store.encodeState();
    const same = applyCommand(store, moveObjectsToPageCommand, {
      ids: ['image-photo'],
      pageId: 'page-1',
    });
    expect(same.result.movedIds).toEqual([]);
    expect(store.encodeState()).toEqual(before);
    const moved = applyCommand(store, moveObjectsToPageCommand, {
      ids: ['frame-plan', 'shape-box'],
      pageId,
    });
    expect(moved.result.movedIds).toEqual(['connector-flow', 'frame-plan']);
    expect(mustGet(store, 'shape-box')).toMatchObject({ parentId: 'group-diagram', pageId: null });
    expect(mustGet(store, 'connector-flow')).toMatchObject({ pageId });
    expect(validateBoard(store.read())).toEqual([]);
    store.destroy();
  });

  it('deletes a connector left behind under the delete policy', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    const { result } = applyCommand(store, moveObjectsToPageCommand, {
      ids: ['shape-box'],
      pageId,
      connectorPolicy: 'delete',
    });
    expect(result).toMatchObject({ deletedIds: ['connector-flow'], detachedIds: [] });
    expect(store.get('connector-flow' as never)).toBeUndefined();
    store.destroy();
  });

  it('refuses a missing page, a locked object and a group holding one', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    expect(
      codes(expectRejected(store, moveObjectsToPageCommand, { ids: ['frame-plan'], pageId: 'x' })),
    ).toEqual(['missing-page']);
    expect(
      codes(expectRejected(store, moveObjectsToPageCommand, { ids: ['shape-star'], pageId })),
    ).toEqual(['locked']);
    expect(
      codes(expectRejected(store, moveObjectsToPageCommand, { ids: ['group-diagram'], pageId })),
    ).toEqual(['locked']);
    store.destroy();
  });
});

describe('commands across pages', () => {
  it('refuse a connector, a reparent and a group spanning pages', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    applyCommand(store, moveObjectsToPageCommand, { ids: ['video-demo'], pageId });
    const connect = { from: { objectId: 'image-photo' }, to: { objectId: 'video-demo' } };
    expect(codes(expectRejected(store, connectCommand, connect))).toContain('cross-page');
    const reparent = { moves: [{ id: 'video-demo', by: { x: 0, y: 0 }, parentId: 'frame-plan' }] };
    expect(codes(expectRejected(store, moveObjectsCommand, reparent))).toEqual(['cross-page']);
    const group = { ids: ['image-photo', 'video-demo'] };
    expect(codes(expectRejected(store, groupCommand, group))).toEqual(['mixed-parents']);
    store.destroy();
  });

  it('put new objects on the page they are given, or their targets', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    applyCommand(store, moveObjectsToPageCommand, { ids: ['video-demo', 'line-divider'], pageId });
    const wire = { from: { objectId: 'video-demo' }, to: { point: { x: 0, y: 0 } } };
    const connector = applyCommand(store, connectCommand, wire, undefined, testEnvironment(51))
      .result.id;
    expect(mustGet(store, connector)).toMatchObject({ pageId });
    const group = applyCommand(
      store,
      groupCommand,
      { ids: ['video-demo', 'line-divider'] },
      undefined,
      testEnvironment(61),
    );
    expect(mustGet(store, group.result.groupId)).toMatchObject({ pageId });
    const note = {
      type: 'shape',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      cornerRadius: 0,
      sides: 4,
      label: null,
      stroke: null,
      fill: [1, 0, 0, 1],
      pageId,
    } satisfies z.input<typeof newObjectSchema>;
    const created = applyCommand(
      store,
      createObjectCommand,
      { object: note },
      undefined,
      testEnvironment(41),
    );
    expect(mustGet(store, created.result.id)).toMatchObject({ pageId });
    const many = applyCommand(
      store,
      createObjectsCommand,
      { objects: [note], pageId: 'page-1' },
      undefined,
      testEnvironment(71),
    );
    expect(mustGet(store, many.result.ids[0] ?? '')).toMatchObject({ pageId: 'page-1' });
    const lost = { object: { ...note, pageId: 'gone' } };
    expect(codes(expectRejected(store, createObjectCommand, lost))).toEqual(['missing-page']);
    store.destroy();
  });
});
