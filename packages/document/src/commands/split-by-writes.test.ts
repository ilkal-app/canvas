// The write-budgeted splits of every splitting command: the edges the stepped
// run's acceptance tests do not reach, on plans built directly (a split never validates).
import { describe, expect, it } from 'vitest';

import type { BoardObject, FrameObject, PageId } from '@canvas/schema';

import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { splitComponentDeletion, splitInstanceDetach } from './component-command-parts.js';
import { createObjectsCommand } from './create-objects.js';
import { deletePageCommand } from './pages/delete-page.js';
import { duplicatePageCommand } from './pages/duplicate-page.js';
import { restoreBoardCommand } from './restore-board.js';
import { createObjectsWithStylesCommand } from './styles/create-objects-with-styles.js';
import type { SetNamedStylePlan } from './styles/set-named-style.js';
import { createObjectsWithTokensCommand } from './tokens/create-objects-with-tokens.js';
import type { SetColorTokenPlan } from './tokens/set-color-token.js';

const objects = createLargeBoardObjects(12, 3);
const ids = objects.map((object) => object.id);
const frame = createLargeBoardObjects(40, 3).find(
  (object): object is FrameObject => object.type === 'frame',
);

const tokenPlan = (index: number): SetColorTokenPlan => ({
  token: { id: `brand-${String(index)}`, name: 'Brand', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] },
  id: `brand-${String(index)}`,
  isCreated: true,
  createdAt: 0,
});

const stylePlan = (index: number): SetNamedStylePlan =>
  ({
    style: { id: `effect-${String(index)}`, name: 'Effect', value: { shadows: [] } },
    id: `effect-${String(index)}`,
    isCreated: true,
    createdAt: 0,
    ranges: [],
  }) as unknown as SetNamedStylePlan;

describe('write-budgeted splits', () => {
  it('keeps a plan that fits one part whole', () => {
    expect(createObjectsCommand.split?.({ objects: objects.slice(0, 2) }, { maxWrites: 4 })).toBe(
      undefined,
    );
    const tokens = { objects: objects.slice(0, 1), tokenPlans: [tokenPlan(0)] };
    expect(createObjectsWithTokensCommand.split?.(tokens, { maxWrites: 3 })).toBeUndefined();
    const deletion = { deletedIds: ids.slice(0, 3), updated: [] };
    expect(splitComponentDeletion(deletion, { maxWrites: 3 })).toBeUndefined();
    const restore = { objects: [], deletedIds: ids.slice(0, 2) };
    expect(restoreBoardCommand.split?.(restore, { maxWrites: 2 })).toBeUndefined();
  });

  it('keeps one indivisible write whole rather than splitting it', () => {
    const deletion = { deletedIds: [], updated: objects.slice(0, 1) };
    expect(splitComponentDeletion(deletion, { maxWrites: 1 })).toBeUndefined();
  });

  it('reports a retired main and the instances it detached', () => {
    const plan = {
      deletedIds: ids.slice(2, 6),
      updated: objects.slice(0, 2),
      retiredIds: ids.slice(0, 1),
    };
    const split = splitComponentDeletion(plan, { maxWrites: 4 });
    expect(split?.result).toMatchObject({ retiredIds: [ids[0]], detachedIds: [] });
    expect(split?.parts.map((part) => [part.updated.length, part.deletedIds.length])).toEqual([
      [2, 0],
      [0, 4],
    ]);
  });

  it('keeps a detach that fits whole, and gives the frame room in the first part', () => {
    if (frame === undefined) throw new Error('the large board has no frame');
    const plan = { frame, children: objects.slice(0, 1), idMap: {}, clamped: [] };
    expect(splitInstanceDetach(plan, { maxWrites: 4 })).toBeUndefined();
    const split = splitInstanceDetach({ ...plan, children: objects.slice(0, 3) }, { maxWrites: 4 });
    expect(split?.parts.map((part) => part.children.length)).toEqual([1, 2]);
  });

  it('restores deletions after objects, with no marker when the plan has none', () => {
    const split = restoreBoardCommand.split?.(
      { objects: objects.slice(0, 2), deletedIds: ids.slice(2, 5) },
      { maxWrites: 4 },
    );
    expect(
      split?.parts.map((part) => [part.objects.length, part.deletedIds.length, part.marker]),
    ).toEqual([
      [2, 0, undefined],
      [0, 3, undefined],
    ]);
  });

  it('deletes the page in a part of its own when the last part is full', () => {
    const pageId = 'page-b' as PageId;
    const plan = { pageId, objects: { deletedIds: ids.slice(0, 4), updated: [] } };
    const split = deletePageCommand.split?.(plan, { maxWrites: 2 });
    expect(split?.parts.map((part) => [part.objects.deletedIds.length, part.pageId])).toEqual([
      [2, null],
      [2, null],
      [0, pageId],
    ]);
    const objectsOnly = deletePageCommand.split?.({ ...plan, pageId: null }, { maxWrites: 2 });
    expect(objectsOnly?.parts).toHaveLength(2);
  });

  it('creates the page in the first part, which keeps room for it', () => {
    const plan = {
      page: { id: 'page-c' as PageId, name: 'Copy', key: 'a1' },
      pageId: 'page-c' as PageId,
      createdAt: 0,
      objects: objects.slice(0, 3),
    } as unknown as Parameters<NonNullable<typeof duplicatePageCommand.split>>[0];
    const split = duplicatePageCommand.split?.(plan, { maxWrites: 4 });
    expect(split?.parts.map((part) => [part.page !== null, part.objects.length])).toEqual([
      [true, 1],
      [false, 2],
    ]);
    expect(duplicatePageCommand.split?.({ ...plan, page: null }, { maxWrites: 4 })).toBe(undefined);
  });

  it('writes the styles before the objects and their tokens', () => {
    const inner = { objects: objects.slice(0, 2), tokenPlans: [tokenPlan(1)] };
    const plan = { objects: inner, textStylePlans: [], effectStylePlans: [stylePlan(1)] };
    const split = createObjectsWithStylesCommand.split?.(plan, { maxWrites: 3 });
    expect(split?.parts[0]?.effectStylePlans).toHaveLength(1);
    expect(split?.parts[0]?.objects.objects).toEqual([]);
    expect(split?.result.tokens).toHaveLength(1);
    expect(split?.result.ids).toEqual(inner.objects.map((object: BoardObject) => object.id));
    const unstyled = { ...plan, effectStylePlans: [] };
    const plain = createObjectsWithStylesCommand.split?.(
      { ...unstyled, objects: { objects: objects.slice(0, 3) } },
      { maxWrites: 4 },
    );
    expect(plain?.parts.map((part) => part.objects.objects.length)).toEqual([2, 1]);
    expect(plain?.result.tokens).toEqual([]);
    expect(createObjectsWithStylesCommand.split?.(unstyled, { maxWrites: 64 })).toBeUndefined();
    // The styles alone over the budget, the objects within it: the objects stay one part.
    const fewObjects = { ...plan, objects: { objects: objects.slice(0, 1) } };
    const styledFew = createObjectsWithStylesCommand.split?.(fewObjects, { maxWrites: 2 });
    expect(styledFew?.parts.map((part) => part.objects.objects.length)).toEqual([0, 1]);
  });
});
