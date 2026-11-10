// The layers tree's splices against a full rebuild: random sequences of creates,
// deletes, reparents, restacks, renames, locks, collapses, expands and reveals, applied at once
// or queued and applied together, must leave exactly the rows `buildLayerRows` lists.
import { describe, expect, it } from 'vitest';

import { generateKeyBetween, generateNKeysBetween } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createMemoryBoardView, memoryShape } from '../__fixtures__/memory-board.js';

import { buildLayerRows } from './layer-rows.js';
import { LayerTree } from './layer-tree.js';

/**
 * A small seeded generator (mulberry32), so a failure names its seed.
 *
 * @param seed - The seed.
 * @returns Numbers in [0, 1).
 */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Few keys, so siblings often share one and fall back to their ids. */
const KEYS = generateNKeysBetween(null, null, 12);
const MIDDLE_KEY = generateKeyBetween(null, null);

type Kind = 'shape' | 'group' | 'frame';

function objectOf(id: string, kind: Kind, z: string, parentId: ObjectId | null): BoardObject {
  const shape = memoryShape(id, z, parentId);
  if (kind === 'shape') return shape;
  if (kind === 'group') return { ...shape, type: 'group' } as unknown as BoardObject;
  return { ...shape, type: 'frame', name: `Frame ${id}`, clip: false, background: null } as never;
}

/**
 * A random board and a tree over it, with the steps that change both.
 *
 * @param seed - The seed.
 * @returns The board view, the tree, the expanded ids it should have, and a random step.
 */
function setUp(seed: number) {
  const random = randomFrom(seed);
  const pick = <Item>(items: readonly Item[]): Item | undefined =>
    items[Math.floor(random() * items.length)];
  const key = () => pick(KEYS) ?? MIDDLE_KEY;
  const view = createMemoryBoardView([]);
  const frames: (() => void)[] = [];
  const tree = new LayerTree(view.board, {
    scheduleFrame: (callback) => {
      frames.push(callback);
      return () => {
        frames.splice(frames.indexOf(callback), 1);
      };
    },
  });
  const expanded = new Set<ObjectId>();
  let isQueueing = false;
  view.subscribe((change) => {
    if (change.kind !== 'document') return;
    if (isQueueing) tree.queueChanges(change.changes);
    else tree.applyChanges(change.changes);
  });
  let nextId = 0;
  const all = () => [...view.objects.values()];
  const containers = () => all().filter((object) => object.type !== 'shape');
  const isInside = (id: ObjectId, ancestor: ObjectId): boolean => {
    for (let at: ObjectId | null | undefined = id; at != null;) {
      if (at === ancestor) return true;
      at = view.objects.get(at)?.parentId;
    }
    return false;
  };
  const emit = (changes: { created?: ObjectId[]; updated?: ObjectId[]; deleted?: ObjectId[] }) => {
    view.emit({ created: [], updated: [], deleted: [], ...changes });
  };
  const create = () => {
    const id = `o${String((nextId += 1))}` as ObjectId;
    const parent = random() < 0.3 ? null : (pick([null, ...containers()])?.id ?? null);
    view.objects.set(
      id,
      objectOf(id, pick<Kind>(['shape', 'shape', 'group', 'frame']) ?? 'shape', key(), parent),
    );
    emit({ created: [id] });
  };
  const steps = {
    create,
    paste: () => {
      const ids: ObjectId[] = [];
      for (let count = 0; count < 5; count += 1) {
        const id = `o${String((nextId += 1))}` as ObjectId;
        const parent = pick([null, ...containers().map((object) => object.id), ...ids]) ?? null;
        const kind = count % 2 === 0 ? 'group' : 'shape';
        view.objects.set(id, objectOf(id, kind, key(), parent));
        ids.push(id);
      }
      emit({ created: ids });
    },
    delete: () => {
      const object = pick(all());
      if (object === undefined) return;
      const doomed =
        random() < 0.5
          ? [object.id]
          : all()
              .filter((inside) => isInside(inside.id, object.id))
              .map((inside) => inside.id);
      for (const id of doomed) view.objects.delete(id);
      emit({ deleted: doomed });
    },
    reparent: () => {
      const object = pick(all());
      if (object === undefined) return;
      const targets = [null, ...containers().filter((c) => !isInside(c.id, object.id))];
      const parentId = pick(targets)?.id ?? null;
      view.objects.set(object.id, { ...object, parentId, z: key() });
      emit({ updated: [object.id] });
    },
    restack: () => {
      const object = pick(all());
      if (object === undefined) return;
      view.objects.set(object.id, { ...object, z: key() });
      emit({ updated: [object.id] });
    },
    renameAndLock: () => {
      const object = pick(all());
      if (object === undefined) return;
      const patch = object.type === 'frame' ? { name: `Renamed ${String(nextId)}` } : {};
      view.objects.set(object.id, { ...object, ...patch, locked: !object.locked });
      emit({ updated: [object.id] });
    },
    lockMany: () => {
      const locked = all().filter(() => random() < 0.6);
      for (const object of locked) {
        view.objects.set(object.id, { ...object, locked: !object.locked });
      }
      emit({ updated: locked.map((object) => object.id) });
    },
    toggle: () => {
      const ids = [pick(all())?.id, pick(containers())?.id].filter((id) => id !== undefined);
      const isExpanding = random() < 0.6;
      for (const id of ids) {
        if (isExpanding) expanded.add(id);
        else expanded.delete(id);
      }
      tree.setExpanded(ids, isExpanding);
    },
    reveal: () => {
      const object = pick(all());
      if (object === undefined) return;
      for (let at = object.parentId; at != null; at = view.objects.get(at)?.parentId ?? null) {
        expanded.add(at);
      }
      tree.reveal(object.id);
    },
  };
  const step = () => {
    isQueueing = random() < 0.4;
    const runs = isQueueing ? 1 + Math.floor(random() * 4) : 1;
    for (let run = 0; run < runs; run += 1) pick(Object.values(steps))?.();
    isQueueing = false;
    for (const frame of frames.splice(0)) frame();
  };
  for (let count = 0; count < 25; count += 1) create();
  return { view, tree, expanded, step, all };
}

describe('LayerTree splices', () => {
  it.each([...Array(24).keys()].map((seed) => seed + 1))(
    'lists what a full rebuild lists after every random step (seed %i)',
    (seed) => {
      const { view, tree, expanded, step, all } = setUp(seed);
      for (let count = 0; count < 80; count += 1) {
        step();
        const rows = tree.rows();
        expect(rows, `seed ${String(seed)}, step ${String(count)}`).toEqual(
          buildLayerRows(view.board, expanded),
        );
        rows.forEach((row, index) => {
          expect(tree.indexOf(row.id)).toBe(index);
        });
        const listed = new Set(rows.map((row) => row.id));
        for (const object of all()) {
          if (!listed.has(object.id)) expect(tree.indexOf(object.id)).toBeUndefined();
        }
      }
    },
  );

  it('applies a burst of queued change sets in one pass, in the next frame', () => {
    const { view, tree } = setUp(99);
    const frames: (() => void)[] = [];
    const queued = new LayerTree(view.board, {
      scheduleFrame: (callback) => {
        frames.push(callback);
        return () => undefined;
      },
    });
    let passes = 0;
    queued.subscribe(() => {
      passes += 1;
    });
    const ids: ObjectId[] = [];
    for (let count = 0; count < 1_000; count += 1) {
      const id = `pasted-${String(count)}` as ObjectId;
      view.objects.set(id, memoryShape(id, KEYS[count % KEYS.length] ?? MIDDLE_KEY));
      ids.push(id);
      view.emit({ created: [id], updated: [], deleted: [] });
      queued.queueChanges({
        origin: SYSTEM,
        isLocal: false,
        created: [id],
        updated: [],
        deleted: [],
      });
    }
    expect(frames).toHaveLength(1);
    expect(passes).toBe(0);
    frames[0]?.();
    expect(passes).toBe(1);
    expect(queued.rows()).toEqual(tree.rows());
  });
});

const SYSTEM = { kind: 'system' } as never;
