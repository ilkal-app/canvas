// Readers during a sliced page switch: the layers panel, the hit index and the page
// camera see only what listeners were told, and a never-seen page fits its whole content once the
// switch is done.
import { describe, expect, it, vi } from 'vitest';

import { findCommand, runCommand, YjsDocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { DocumentHitIndex } from '../engine/document-hit-index.js';
import { LayerTree } from '../panels/layers/layer-tree.js';

import { PageCameras } from './page-cameras.js';
import { PageIndex } from './page-index.js';
import { PageNavigator } from './page-navigator.js';
import { PageScopedStore } from './page-scoped-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const FIRST = 'page-1' as PageId;
const environment = { clock: () => 1, createId: createSeededIdGenerator(523) };

/**
 * The fields every object shares.
 *
 * @param id - Its id.
 * @param pageId - Its page.
 * @returns The fields.
 */
const base = (id: string, pageId: PageId) => ({
  id: id as ObjectId,
  parentId: null,
  pageId,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: ORIGIN.principalId,
  createdAt: 1,
  updatedAt: 1,
});

/**
 * A rectangle at the page's root.
 *
 * @param id - Its id.
 * @param pageId - Its page.
 * @returns The shape.
 */
function rect(id: string, pageId: PageId): BoardObject {
  return {
    ...base(id, pageId),
    type: 'shape',
    width: 10,
    height: 10,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: [1, 0, 0, 1],
  };
}

/**
 * A connector from an object (or a free point) to a free point.
 *
 * @param id - Its id.
 * @param pageId - Its page.
 * @param target - The object its start is attached to, if any.
 * @returns The connector.
 */
function link(id: string, pageId: PageId, target?: string): BoardObject {
  return {
    ...base(id, pageId),
    type: 'connector',
    from:
      target === undefined
        ? { kind: 'point', x: 0, y: 0 }
        : { kind: 'object', objectId: target as ObjectId, anchor: { x: 1, y: 0.5 } },
    to: { kind: 'point', x: 40, y: 40 },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 1 },
    startCap: 'none',
    endCap: 'none',
    label: null,
  };
}

/**
 * Browser yields released by hand.
 *
 * @returns The yield and a way to release every pending one.
 */
function yields() {
  const pending: (() => void)[] = [];
  return {
    yieldToBrowser: () => new Promise<void>((resolve) => pending.push(resolve)),
    async drain() {
      for (let step = 0; step < 50 && pending.length > 0; step += 1) {
        pending.shift()?.();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

/**
 * A two-page board: the first holds `old` roots, the second whatever `place` writes.
 *
 * @param place - Writes the second page's objects.
 * @param oldCount - How many roots the first page holds.
 * @returns The store, the page-scoped view on the first page, and the second page.
 * @throws {Error} When the page command is missing or refused.
 */
function board(place: (second: PageId) => readonly BoardObject[], oldCount = 6) {
  const store = new YjsDocumentStore();
  const command = findCommand('addPage');
  if (command === undefined) throw new Error('addPage is registered');
  const added = runCommand(store, ORIGIN, command, {}, environment);
  if (added.status !== 'applied') throw new Error('addPage applies');
  const second = (added.result as { pageId: PageId }).pageId;
  store.transact(ORIGIN, (tx) => {
    for (let index = 0; index < oldCount; index += 1) {
      tx.setObject(rect(`old-${String(index)}`, FIRST));
    }
    for (const object of place(second)) tx.setObject(object);
  });
  return { store, view: new PageScopedStore(store, new PageIndex(store), FIRST), second };
}

describe('readers during a sliced page switch', () => {
  it('builds layer rows only for announced objects, then the whole page', async () => {
    // A reviewer's case: enough roots that the panel rebuilds its root level from the references.
    const roots = (second: PageId) =>
      Array.from({ length: 600 }, (unused, index) => rect(`new-${String(index)}`, second));
    const { store, view, second } = board(roots, 600);
    const tree = new LayerTree(view);
    view.subscribe((changes) => {
      tree.applyChanges(changes);
    });
    const gate = yields();
    const slicing = { sliceSize: 100, firstSliceSize: 1, yieldToBrowser: gate.yieldToBrowser };
    const switching = view.showInSlices(second, slicing);
    expect(tree.rows().map(({ id }) => id)).toEqual(['new-0']);
    await gate.drain();
    await switching;
    expect(tree.rows()).toHaveLength(600);
    view.destroy();
    store.destroy();
  });

  it('does not index a connector before it is announced', async () => {
    const objects = (second: PageId) => [
      rect('a', second),
      link('b', second),
      link('z', second, 'a'),
    ];
    const { store, view, second } = board(objects);
    const hits = new DocumentHitIndex(view);
    const gate = yields();
    const slicing = { sliceSize: 1, firstSliceSize: 2, yieldToBrowser: gate.yieldToBrowser };
    const switching = view.showInSlices(second, slicing);
    expect(hits.index.boundsOf('a' as ObjectId)).toBeDefined();
    expect(hits.index.boundsOf('z' as ObjectId)).toBeUndefined();
    await gate.drain();
    await switching;
    expect(hits.index.boundsOf('z' as ObjectId)).toBeDefined();
    // Done, the switch is forgotten: a shown parent's children are the board's own set again.
    expect(view.references.childrenOf('a' as ObjectId)).toBe(
      store.references.childrenOf('a' as ObjectId),
    );
    hits.destroy();
    view.destroy();
    store.destroy();
  });

  it("fits a never-seen page's camera once all its objects are announced", async () => {
    const roots = (second: PageId) =>
      Array.from({ length: 6 }, (unused, index) => rect(`new-${String(index)}`, second));
    const { store, view, second } = board(roots);
    const gate = yields();
    const navigator = new PageNavigator({
      store,
      view,
      origin: ORIGIN,
      environment,
      findCommand,
      slicing: { sliceSize: 2, firstSliceSize: 1, yieldToBrowser: gate.yieldToBrowser },
    });
    const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
    const fitContent = vi.fn(() => {
      expect(view.read().objects.size).toBe(6);
    });
    const cameras = new PageCameras(
      navigator,
      { camera: () => camera, setCamera: () => undefined, fitContent },
      'board',
    );
    navigator.show(second);
    expect(navigator.current()).toBe(second);
    expect(fitContent).not.toHaveBeenCalled();
    await gate.drain();
    await navigator.whenShown();
    await Promise.resolve();
    expect(fitContent).toHaveBeenCalledOnce();
    cameras.destroy();
    navigator.destroy();
    view.destroy();
    store.destroy();
  });
});
