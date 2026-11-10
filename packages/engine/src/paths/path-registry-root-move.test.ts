import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { withRootMoveBatch } from '../scene/root-move-batch.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';
import type { SceneChangeSet } from '../scene/scene-source.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { squarePath, zigzagPath } from './__fixtures__/path-scene.js';
import { PathRegistry } from './path-registry.js';

function changesOf(objects: readonly BoardObject[]): SceneChangeSet {
  const source = new Map(objects.map((object) => [object.id, object]));
  return {
    created: [],
    updated: objects.map(({ id }) => id),
    deleted: [],
    get: vi.fn((id: ObjectId) => source.get(id)),
  };
}

function fixture() {
  const objects = [squarePath('a', 0), zigzagPath('b', 1), shapeObject('shape')];
  const removed: ObjectId[] = [];
  const registry = new PathRegistry('path', (id) => removed.push(id));
  const oracle = new PathRegistry('path', () => undefined);
  const slots = new Map<string, number[]>([
    ['a', [0, 1]],
    ['b', [2]],
  ]);
  const scene = { slotsOf: (id: ObjectId) => slots.get(id) ?? [] };
  for (const target of [registry, oracle]) target.observe(changesOf(objects), scene);
  return { objects, removed, registry, oracle, slots, scene };
}

function expectParity(registry: PathRegistry, oracle: PathRegistry) {
  expect(registry.size).toBe(oracle.size);
  for (const id of ['a', 'b', 'new', 'shape'])
    expect(registry.get(id as ObjectId)).toEqual(oracle.get(id as ObjectId));
  for (let slot = 0; slot < 6; slot += 1)
    expect(registry.ownerOf(slot)).toEqual(oracle.ownerOf(slot));
}

describe('PathRegistry scoped root moves', () => {
  it('measures a connector in a root move again, since its route follows where it is', () => {
    const connector = connectorObject('c');
    const registry = new PathRegistry('path', () => undefined);
    const scene = { slotsOf: (id: ObjectId) => (id === connector.id ? [4] : []) };
    registry.observe(changesOf([connector]), scene);
    const moved = { ...connector, x: 30 };
    const changes = markRootMoveChanges(changesOf([moved]));
    const reads = vi.spyOn(changes, 'get');
    withRootMoveBatch(changes, [moved], () => {
      registry.observe(changes, scene);
    });
    // Fell back to the ordinary refresh, which reads the change set.
    expect(reads).toHaveBeenCalled();
    expect(registry.get(connector.id)?.object).toBe(moved);
  });

  it('reuses invariant mesh metadata while replacing object and owner snapshots', () => {
    const { objects, registry, oracle, scene } = fixture();
    const before = registry.get('a' as ObjectId);
    const owner = registry.ownerOf(0);
    const moved = objects.map((object) => ({ ...object, x: -0, y: 16_777_217.125 }));
    const changes = markRootMoveChanges(changesOf(moved));
    const reads = vi.spyOn(changes, 'get');
    withRootMoveBatch(changes, moved, () => {
      registry.observe(changes, scene);
    });
    expect(reads).not.toHaveBeenCalled();
    oracle.observe(changes, scene);
    expectParity(registry, oracle);
    const after = registry.get('a' as ObjectId);
    expect(after?.object).toBe(moved[0]);
    expect(after?.layers).toBe(before?.layers);
    expect(after?.slots).toBe(before?.slots);
    expect(after?.localBounds).toBe(before?.localBounds);
    expect(after).not.toBe(before);
    expect(registry.ownerOf(0)).not.toBe(owner);
    expect(owner?.path).toBe(before);
    expect(before?.object).toBe(objects[0]);
  });

  it('matches ordinary refresh when resources replace or reassign current slots', () => {
    const { objects, registry, oracle, scene, slots } = fixture();
    slots.set('a', [2, 3]);
    slots.set('b', [0]);
    const moved = objects.map((object) => ({ ...object, x: 90 }));
    const changes = markRootMoveChanges(changesOf(moved));
    withRootMoveBatch(changes, moved, () => {
      registry.observe(changes, scene);
    });
    oracle.observe(changes, scene);
    expectParity(registry, oracle);
    expect(registry.ownerOf(2)?.path.id).toBe('a');
    expect(registry.ownerOf(1)).toBeUndefined();
    slots.set('a', []);
    withRootMoveBatch(changes, moved, () => {
      registry.observe(changes, scene);
    });
    oracle.observe(changes, scene);
    expectParity(registry, oracle);
  });

  it('does not retain invariant metadata for later ordinary geometry changes', () => {
    const { objects, registry, oracle, scene } = fixture();
    const moved = objects.map((object) => ({ ...object, x: 90 }));
    const changes = markRootMoveChanges(changesOf(moved));
    withRootMoveBatch(changes, moved, () => {
      registry.observe(changes, scene);
    });
    oracle.observe(changes, scene);
    const changed = squarePath('a', 0, { fill: null, stroke: { width: 9, color: [1, 0, 0, 1] } });
    for (const target of [registry, oracle]) target.observe(changesOf([changed]), scene);
    expectParity(registry, oracle);
  });

  it('preserves missing, newly tracked, type-changed and empty paths', () => {
    const { registry, oracle, scene, slots, removed } = fixture();
    slots.set('new', [4, 5]);
    const objects = [shapeObject('a'), squarePath('new', 2), zigzagPath('b', 1, { stroke: null })];
    const changes = markRootMoveChanges(changesOf(objects));
    withRootMoveBatch(changes, objects, () => {
      registry.observe(changes, scene);
    });
    oracle.observe(changes, scene);
    expectParity(registry, oracle);
    expect(removed).toEqual(['a', 'b']);
  });

  it.each(['unmarked', 'mixed', 'reversed', 'short', 'nonroot'])(
    'uses live reads for refused %s scopes',
    (kind) => {
      const { objects, registry, oracle, scene } = fixture();
      const moved = objects.map((object) => ({ ...object, x: 9 }));
      const changes = changesOf(moved);
      if (kind !== 'unmarked') markRootMoveChanges(changes);
      const current =
        kind === 'mixed'
          ? markRootMoveChanges({ ...changes, deleted: ['absent' as ObjectId] })
          : changes;
      const batch =
        kind === 'reversed'
          ? [...moved].reverse()
          : kind === 'short'
            ? moved.slice(1)
            : kind === 'nonroot'
              ? moved.map((object) => ({ ...object, parentId: 'parent' as ObjectId }))
              : moved;
      const reads = vi.spyOn(current, 'get');
      withRootMoveBatch(current, batch, () => {
        registry.observe(current, scene);
      });
      expect(reads).toHaveBeenCalled();
      oracle.observe(current, scene);
      expectParity(registry, oracle);
    },
  );

  it('keeps duplicate update order and ordinary out-of-scope live reads', () => {
    const { objects, registry, oracle, scene } = fixture();
    const moved = [...objects, ...objects];
    const changes = markRootMoveChanges(changesOf(moved));
    withRootMoveBatch(changes, moved, () => {
      registry.observe(changes, scene);
    });
    oracle.observe(changes, scene);
    expectParity(registry, oracle);
    const reads = vi.spyOn(changes, 'get');
    reads.mockClear();
    registry.observe(changes, scene);
    expect(reads).toHaveBeenCalledTimes(moved.length);
  });
});

it('switches to live reads after a fallback invokes a removal callback', () => {
  const a = squarePath('a', 0);
  const b = zigzagPath('b', 1);
  const source = new Map<ObjectId, BoardObject>([
    [a.id, a],
    [b.id, b],
  ]);
  const registry = new PathRegistry('path', () => source.delete(b.id));
  const scene = { slotsOf: () => [0, 1] };
  registry.observe(changesOf([a, b]), scene);
  const replacement = shapeObject('a');
  source.set(a.id, replacement);
  const changes = markRootMoveChanges({
    created: [],
    updated: [a.id, b.id],
    deleted: [],
    get: (id: ObjectId) => source.get(id),
  });
  withRootMoveBatch(changes, [replacement, b], () => {
    registry.observe(changes, scene);
  });
  expect(registry.size).toBe(0);
});
