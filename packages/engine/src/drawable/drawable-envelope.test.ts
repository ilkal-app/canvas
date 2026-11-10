import { expect, it, vi } from 'vitest';

import { SceneSourceMirror } from '../host/scene-source-mirror.js';
import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { getRootMovePlacement, markRootMovePlacement } from '../scene/root-move-placement.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { hostileBoard } from './__fixtures__/hostile-board.js';
import { DRAWABLE_EXTENT } from './drawable-extent.js';
import { DrawableGate } from './drawable-gate.js';
import { undrawableReasonOf } from './drawable-geometry.js';
import { RootMoveEnvelope } from './root-move-envelope.js';

function fixture() {
  const mirror = new SceneSourceMirror(true);
  const gate = new DrawableGate();
  const base = shapeObject('root');
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [base],
    positions: new Float64Array([0, 0]),
  });
  if (!begin) throw new Error('Missing begin');
  gate.filter(begin);
  let sequence = 0;
  const move = (x: number, y = 0): SceneChangeSet => {
    const changes = mirror.applyMove({
      kind: 'update',
      session: 1,
      sequence: ++sequence,
      positions: new Float64Array([x, y]),
    });
    if (!changes) throw new Error('Missing update');
    return changes;
  };
  return { mirror, gate, base, move };
}

it('proves interior placements without materializing immutable objects after the first verdict', () => {
  const { mirror, gate, move } = fixture();
  gate.filter(move(1));
  const changes = move(2);
  const get = vi.spyOn(mirror, 'get');
  expect(gate.filter(changes)).toBe(changes);
  expect(get).not.toHaveBeenCalled();
  expect(gate.takeReport()).toEqual({ objects: [], count: 0 });
});

it('preserves exact boundary and invalid-coordinate verdicts and reports', () => {
  const { gate, base, move } = fixture();
  const ordinary = new DrawableGate();
  for (const x of [
    1,
    2,
    DRAWABLE_EXTENT / 8,
    DRAWABLE_EXTENT / 8 + 1,
    DRAWABLE_EXTENT - 10,
    DRAWABLE_EXTENT,
    NaN,
    Infinity,
    -Infinity,
    -DRAWABLE_EXTENT,
    0,
    -0,
  ]) {
    const changes = move(x, x / 2);
    const expected = ordinary.filter({ ...changes });
    const actual = gate.filter(changes);
    expect(actual.get(base.id)).toEqual(expected.get(base.id));
    expect(gate.undrawableCount).toBe(ordinary.undrawableCount);
    expect(gate.takeReport()).toEqual(ordinary.takeReport());
  }
});

it('invalidates admission when an unrelated ordinary update adds a child to a selected leaf', () => {
  const { mirror, gate, base, move } = fixture();
  gate.filter(move(1));
  const child = shapeObject('child', { parentId: base.id });
  gate.filter(
    mirror.apply({ created: [child.id], updated: [], deleted: [], objects: { [child.id]: child } }),
  );
  // Ordinary changes retire the session; a replacement session must establish hierarchy again.
  const next = mirror.applyMove({
    kind: 'begin',
    session: 2,
    sequence: 0,
    objects: [base],
    positions: new Float64Array([0, 0]),
  });
  if (!next) throw new Error('Missing begin');
  gate.filter(next);
  const changed = mirror.applyMove({
    kind: 'update',
    session: 2,
    sequence: 1,
    positions: new Float64Array([DRAWABLE_EXTENT, 0]),
  });
  if (!changed) throw new Error('Missing update');
  expect(gate.filter(changed).get(child.id)).toBeUndefined();
  expect(gate.takeReport().objects).toContainEqual({ id: child.id, reason: 'undrawable-parent' });
});

it('uses the current live positions even when an older accepted change is judged again', () => {
  const { gate, move, base } = fixture();
  gate.filter(move(1));
  const old = move(2);
  gate.filter(old);
  move(Number.NaN);
  expect(gate.filter(old).get(base.id)).toBeUndefined();
  expect(gate.takeReport().objects).toEqual([{ id: base.id, reason: 'not-finite' }]);
});

it('does not inherit a previous session verdict when the same id receives invalid geometry', () => {
  const { mirror, gate, base, move } = fixture();
  gate.filter(move(1));
  gate.filter(move(2));
  const next = mirror.applyMove({
    kind: 'begin',
    session: 2,
    sequence: 0,
    objects: [{ ...base, width: -1 }],
    positions: new Float64Array([0, 0]),
  });
  if (!next) throw new Error('Missing begin');
  gate.filter(next);
  const changed = mirror.applyMove({
    kind: 'update',
    session: 2,
    sequence: 1,
    positions: new Float64Array([1, 0]),
  });
  if (!changed) throw new Error('Missing update');
  expect(gate.filter(changed).get(base.id)).toBeUndefined();
  expect(gate.takeReport().objects).toEqual([{ id: base.id, reason: 'negative-size' }]);
});

it('proves seeded interior placements only when the ordinary exact oracle accepts every drawn type', () => {
  let seed = 912738;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const objects = hostileBoard()
    .honest.map(({ object }) => object)
    .filter((object) => object.type !== 'frame' && object.type !== 'group');
  for (let iteration = 0; iteration < 100; iteration++) {
    const bases = objects.map((object) => ({ ...object, rotation: (random() - 0.5) * 1e30 }));
    const snapshot = {
      ids: bases.map((object) => object.id),
      objects: bases,
      positions: Float64Array.from(
        bases.flatMap(() => [
          ((random() - 0.5) * DRAWABLE_EXTENT) / 4,
          ((random() - 0.5) * DRAWABLE_EXTENT) / 4,
        ]),
      ),
    };
    const proof = RootMoveEnvelope.create(snapshot);
    expect(proof?.accepts(snapshot)).toBe(true);
    bases.forEach((base, index) => {
      const object = {
        ...base,
        x: snapshot.positions[index * 2] ?? 0,
        y: snapshot.positions[index * 2 + 1] ?? 0,
      };
      expect(undrawableReasonOf(object, { get: () => undefined })).toBeUndefined();
    });
  }
});

it('refuses a conservative proof for large local geometry even when exact placement fits', () => {
  const object = shapeObject('wide', { width: DRAWABLE_EXTENT / 4 });
  expect(undrawableReasonOf(object, { get: () => undefined })).toBeUndefined();
  expect(
    RootMoveEnvelope.create({
      ids: [object.id],
      objects: [object],
      positions: new Float64Array([0, 0]),
    }),
  ).toBeUndefined();
});

it('does not grant a fast verdict to an unmarked change carrying only a placement reader', () => {
  const { gate, move, base } = fixture();
  gate.filter(move(1));
  const accepted = move(2);
  const unmarked = markRootMovePlacement({ ...accepted, get: () => ({ ...base, width: -1 }) }, () =>
    getRootMovePlacement(accepted),
  );
  expect(gate.filter(unmarked).get(base.id)).toBeUndefined();
  expect(gate.takeReport().objects).toEqual([{ id: base.id, reason: 'negative-size' }]);
});

it('refuses cached eligibility when the live membership no longer matches the listed update', () => {
  const { gate, move, mirror, base } = fixture();
  gate.filter(move(1));
  const old = move(2);
  gate.filter(old);
  const replacement = shapeObject('replacement', { width: -1 });
  mirror.applyMove({
    kind: 'begin',
    session: 2,
    sequence: 0,
    objects: [replacement],
    positions: new Float64Array([0, 0]),
  });
  const get = vi.spyOn(mirror, 'get');
  gate.filter(old);
  expect(get).toHaveBeenCalledWith(base.id);
});

it('keeps prior immutable source objects unchanged across skipped and materialized updates', () => {
  const { gate, move, mirror, base } = fixture();
  gate.filter(move(1));
  const before = mirror.get(base.id);
  gate.filter(move(2));
  gate.filter(move(3));
  const after = mirror.get(base.id);
  expect(before?.x).toBe(1);
  expect(after?.x).toBe(3);
  expect(after).not.toBe(before);
});

it('includes path handle endpoints and refuses overflowing local sums', () => {
  const path = hostileBoard().honest.find(({ object }) => object.type === 'path')?.object;
  if (path?.type !== 'path') throw new Error('Missing path fixture');
  for (const x of [DRAWABLE_EXTENT, Number.MAX_VALUE]) {
    const object = {
      ...path,
      vertices: path.vertices.map((vertex) => ({ ...vertex, x })),
      segments: path.segments.map((segment) => ({ ...segment, ha: { x, y: 0 } })),
    };
    expect(
      RootMoveEnvelope.create({
        ids: [object.id],
        objects: [object],
        positions: new Float64Array([0, 0]),
      }),
    ).toBeUndefined();
  }
});
