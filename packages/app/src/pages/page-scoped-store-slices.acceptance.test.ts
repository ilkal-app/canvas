import { describe, expect, it } from 'vitest';

import {
  findCommand,
  isStoreRunning,
  runCommand,
  StoreBusyError,
  storeRunState,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type ChangeSet,
} from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { PageIndex } from './page-index.js';
import { PageScopedStore } from './page-scoped-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const FIRST = 'page-1' as PageId;
const environment = { clock: () => 1, createId: createSeededIdGenerator(557) };
type SlicedView = PageScopedStore & {
  showInSlices(
    page: PageId,
    slicing: { sliceSize: number; yieldToBrowser: () => Promise<void> },
  ): Promise<void>;
};

/**
 * A rectangle on a page or inside a frame.
 *
 * @param id - Its id.
 * @param pageId - Its root page.
 * @param parentId - Its parent.
 * @returns The object.
 */
function rect(id: string, pageId?: PageId, parentId: ObjectId | null = null): BoardObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    parentId,
    ...(pageId === undefined ? {} : { pageId }),
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
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
 * A frame deliberately sorted after its children by id.
 *
 * @param pageId - Its page.
 * @returns The object.
 */
function frame(pageId: PageId): BoardObject {
  return {
    id: 'z-frame' as ObjectId,
    type: 'frame',
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
    width: 10,
    height: 10,
    name: 'Frame',
    clip: false,
    background: null,
  };
}

/**
 * A free ended connector.
 *
 * @param pageId - Its page.
 * @returns The object.
 */
function connector(pageId: PageId): BoardObject {
  const base = frame(pageId);
  return {
    id: 'connector' as ObjectId,
    type: 'connector',
    parentId: null,
    pageId,
    x: base.x,
    y: base.y,
    rotation: base.rotation,
    z: base.z,
    locked: base.locked,
    createdBy: base.createdBy,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    from: { kind: 'point', x: 0, y: 0 },
    to: { kind: 'point', x: 10, y: 10 },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 1 },
    startCap: 'none',
    endCap: 'none',
    label: null,
  };
}

/**
 * A manually released browser yield.
 *
 * @returns Its yield function, pending count, and next release.
 */
function yields() {
  const pending: (() => void)[] = [];
  return {
    yieldToBrowser: () => new Promise<void>((resolve) => pending.push(resolve)),
    get pending() {
      return pending.length;
    },
    async next() {
      const resolve = pending.shift();
      if (resolve === undefined) throw new Error('a browser yield is pending');
      resolve();
      await Promise.resolve();
    },
  };
}

/**
 * A two page board with 25 objects on each page.
 *
 * @returns The root, view, and second page.
 * @throws {Error} When addPage is unavailable or rejected.
 */
function board() {
  const store = new YjsDocumentStore();
  const command = findCommand('addPage');
  if (command === undefined) throw new Error('addPage is registered');
  const added = runCommand(store, ORIGIN, command, {}, environment);
  if (added.status !== 'applied') throw new Error('addPage applies');
  const second = (added.result as { pageId: PageId }).pageId;
  store.transact(ORIGIN, (tx) => {
    for (let index = 0; index < 25; index += 1) {
      tx.setObject(rect(`old-${index.toString().padStart(2, '0')}`, FIRST));
    }
    tx.setObject(frame(second));
    for (let index = 0; index < 3; index += 1) {
      tx.setObject(rect(`a-child-${index.toString()}`, undefined, 'z-frame' as ObjectId));
    }
    tx.setObject(connector(second));
    for (let index = 0; index < 20; index += 1) {
      tx.setObject(rect(`new-${index.toString().padStart(2, '0')}`, second));
    }
  });
  return { store, view: new PageScopedStore(store, new PageIndex(store), FIRST), second };
}

/**
 * Completes all waiting slices while preserving manual yield boundaries.
 *
 * @param gate - The browser yield gate.
 * @param switching - The switch promise.
 */
async function drain(gate: ReturnType<typeof yields>, switching: Promise<void>): Promise<void> {
  for (let index = 0; index < 30 && gate.pending > 0; index += 1) await gate.next();
  await switching;
}

describe('PageScopedStore.showInSlices', () => {
  it('publishes the new view synchronously, then every id once in bounded parent-first slices', async () => {
    const { store, view, second } = board();
    const gate = yields();
    const changes: ChangeSet[] = [];
    view.subscribe((change) => changes.push(change));
    const switching = (view as SlicedView).showInSlices(second, {
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    expect(view.page).toBe(second);
    // Readers see what listeners were told: the first slice now, the rest later.
    expect([...view.read().objects.keys()].sort()).toEqual([...(changes[0]?.created ?? [])].sort());
    expect(view.get('z-frame' as ObjectId)).toBeUndefined();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ origin: SYSTEM_ORIGIN, isLocal: false, updated: [] });
    expect(changes[0]?.deleted).toHaveLength(25);
    expect(changes[0]?.created).toHaveLength(4);
    expect(isStoreRunning(view)).toBe(true);
    expect(storeRunState(view)?.progress).toEqual({ done: 4, total: 25 });
    expect(() => {
      view.transact(ORIGIN, () => undefined);
    }).toThrow(StoreBusyError);
    await gate.next();
    expect(changes).toHaveLength(2);
    expect(storeRunState(view)?.progress).toEqual({ done: 8, total: 25 });
    await drain(gate, switching);
    const created = changes.flatMap((change) => change.created);
    const deleted = changes.flatMap((change) => change.deleted);
    expect(created).toHaveLength(25);
    expect(new Set(created).size).toBe(25);
    expect(deleted).toHaveLength(25);
    expect(new Set(deleted).size).toBe(25);
    expect(changes.slice(1).every((change) => change.deleted.length === 0)).toBe(true);
    // A parent and its children may share a slice; no slice may exceed the size limit.
    expect(changes.every((change) => change.created.length <= 4)).toBe(true);
    for (const id of created) {
      const object = view.get(id);
      expect(view.pageOf(id)).toBe(view.page);
      if (object?.parentId !== null && object?.parentId !== undefined) {
        expect(created.indexOf(object.parentId)).toBeLessThanOrEqual(created.indexOf(id));
      }
    }
    expect(isStoreRunning(view)).toBe(false);
    expect(storeRunState(view)).toBeUndefined();
    expect(view.read().objects.size).toBe(25);
    expect(view.get('z-frame' as ObjectId)?.id).toBe('z-frame');
    expect(view.references.childrenOf('z-frame' as ObjectId).size).toBe(3);
    view.destroy();
    store.destroy();
  });

  it('reconciles owed updates and deletions without duplicate notifications', async () => {
    const { store, view, second } = board();
    const run = store.beginRun();
    const gate = yields();
    const changes: ChangeSet[] = [];
    view.subscribe((change) => changes.push(change));
    const switching = (view as SlicedView).showInSlices(second, {
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    const owed = [...store.read().objects.keys()].filter(
      (id) => view.pageOf(id) === second && !changes[0]?.created.includes(id),
    );
    const updated = owed.find((id) => store.get(id)?.type === 'shape');
    const deleted = owed.find((id) => id !== updated && store.get(id)?.type === 'shape');
    const moved = owed.find(
      (id) =>
        id !== updated &&
        id !== deleted &&
        store.get(id)?.type === 'shape' &&
        store.get(id)?.parentId === null,
    );
    const sent = changes[0]?.created.find((id) => store.get(id)?.type === 'shape');
    if (
      updated === undefined ||
      deleted === undefined ||
      moved === undefined ||
      sent === undefined
    ) {
      throw new Error('owed and sent shapes exist');
    }
    run.enter(() => {
      store.transact(ORIGIN, (tx) => {
        const object = store.get(updated);
        const moving = store.get(moved);
        const sentObject = store.get(sent);
        const arriving = store.get('old-00' as ObjectId);
        if (
          object === undefined ||
          moving === undefined ||
          sentObject === undefined ||
          arriving === undefined
        ) {
          throw new Error('objects exist');
        }
        tx.setObject({ ...object, x: 20 });
        tx.setObject({ ...moving, pageId: FIRST });
        tx.setObject({ ...sentObject, x: 30 });
        tx.deleteObject(deleted);
        tx.setObject(rect('arrived', second));
        tx.setObject({ ...arriving, pageId: second });
      });
    });
    await drain(gate, switching);
    const created = changes.flatMap((change) => change.created);
    expect(created.filter((id) => id === updated)).toHaveLength(1);
    expect(created).not.toContain(deleted);
    expect(created).not.toContain(moved);
    expect(changes.flatMap((change) => change.deleted)).not.toContain(deleted);
    expect(changes.flatMap((change) => change.deleted)).not.toContain(moved);
    expect(created).toContain('arrived');
    expect(created.filter((id) => id === 'old-00')).toHaveLength(1);
    expect(changes.flatMap((change) => change.updated)).toContain(sent);
    run.close();
    view.destroy();
    store.destroy();
  });

  it('supersedes a pending switch, deletes only delivered ids, and closes its run', async () => {
    const { store, view, second } = board();
    const gate = yields();
    const changes: ChangeSet[] = [];
    view.subscribe((change) => changes.push(change));
    const first = (view as SlicedView).showInSlices(second, {
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    const delivered = changes[0]?.created ?? [];
    view.show(FIRST);
    expect(changes[1]?.deleted).toEqual(delivered);
    expect(changes[1]?.created).toHaveLength(25);
    await gate.next();
    await expect(first).resolves.toBeUndefined();
    expect(changes).toHaveLength(2);
    expect(storeRunState(view)).toBeUndefined();
    view.destroy();
    store.destroy();
  });

  it('uses an existing run, and closes its own run on destroy or yield failure', async () => {
    const { store, view, second } = board();
    const outer = store.beginRun();
    const gate = yields();
    const nested = (view as SlicedView).showInSlices(second, {
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    expect(storeRunState(view)).toEqual({ progress: undefined });
    view.destroy();
    await gate.next();
    await expect(nested).resolves.toBeUndefined();
    expect(isStoreRunning(store)).toBe(true);
    outer.close();
    const again = new PageScopedStore(store, new PageIndex(store), FIRST);
    const failure = new Error('yield failed');
    const switching = (again as SlicedView).showInSlices(second, {
      sliceSize: 4,
      yieldToBrowser: () => Promise.reject(failure),
    });
    await expect(switching).rejects.toBe(failure);
    expect(storeRunState(again)).toBeUndefined();
    again.destroy();
    store.destroy();
  });

  it('stops its own pending run when destroyed', async () => {
    const { store, view, second } = board();
    const gate = yields();
    const switching = (view as SlicedView).showInSlices(second, {
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    expect(isStoreRunning(view)).toBe(true);
    view.destroy();
    expect(storeRunState(store)).toBeUndefined();
    await gate.next();
    await expect(switching).resolves.toBeUndefined();
    store.destroy();
  });

  it('a second sliced switch supersedes the first and deletes only delivered ids', async () => {
    const { store, view, second } = board();
    const gate = yields();
    const changes: ChangeSet[] = [];
    view.subscribe((change) => changes.push(change));
    const first = (view as SlicedView).showInSlices(second, {
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    const sent = changes[0]?.created ?? [];
    const next = (view as SlicedView).showInSlices(FIRST, {
      sliceSize: 4,
      yieldToBrowser: () => Promise.resolve(),
    });
    expect(changes[1]?.deleted).toEqual(sent);
    await gate.next();
    await expect(first).resolves.toBeUndefined();
    await next;
    expect(view.page).toBe(FIRST);
    view.destroy();
    store.destroy();
  });
});
