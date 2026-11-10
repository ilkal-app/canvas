import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  groupObject,
  shapeObject,
  zKeyAt,
} from '../__fixtures__/scene-objects.js';
import type { DrawListEntry } from '../draw-list.js';
import type { ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import { ranksByObject } from './closing-ranks.js';
import { EMPTY_ORDER, isEndHidden, refreshOrder } from './paint-order-tables.js';
import { ZOrderMirror } from './z-order-mirror.js';
import { ZOrderSegments } from './z-order-segments.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** How many objects the stage tests' board holds. */
const BOARD_SIZE = 5_000;

/**
 * A mirror that has observed a board, its dirtiness cleared.
 *
 * @param objects - The board.
 * @returns The mirror and the document behind it.
 */
function mirrored(objects: readonly BoardObject[]): {
  mirror: ZOrderMirror;
  document: FakeSceneDocument;
} {
  const mirror = new ZOrderMirror();
  const document = new FakeSceneDocument();
  document.create(...objects);
  mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
  return { mirror, document };
}

describe('refreshOrder', () => {
  const board = [shapeObject('a', { z: 'a0' }), shapeObject('b', { z: 'a1' })];

  it('walks the first board, then appends an object created on top, extending the rank index', () => {
    const { mirror, document } = mirrored(board);
    const first = refreshOrder(EMPTY_ORDER, mirror, [FILLED_RECT_PASS]);
    expect(first.change).toBe('rebuilt');
    expect(first.tables.paintOrder).toEqual(['a', 'b']);
    expect(first.tables.isFromRoots).toBe(true);
    mirror.clearDirty();
    document.create(shapeObject('top', { z: 'a5', fill: null }));
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    const ranks = ranksByObject(first.tables.paintOrder, first.tables.isClosingRank);
    const next = refreshOrder(first.tables, mirror, [FILLED_RECT_PASS], ranks);
    expect(next.change).toBe('appended');
    expect(next.tables.paintOrder).toEqual(['a', 'b', 'top']);
    expect([...next.tables.isClosingRank]).toEqual([0, 0, 0]);
    // The appended shape has no fill: no occluder; the board's filled shapes stay occluders.
    expect([...next.tables.isOccluderByRank]).toEqual([1, 1, 0]);
    expect(ranks.rankById.get('top' as ObjectId)).toBe(2);
    // The order is extended in place, not copied.
    expect(next.tables.paintOrder).toBe(first.tables.paintOrder);
  });

  it('extends in place: a second edit at the end reuses the order and the tables’ buffers', () => {
    const { mirror, document } = mirrored(board);
    let tables = refreshOrder(EMPTY_ORDER, mirror, [FILLED_RECT_PASS]).tables;
    mirror.clearDirty();
    document.create(shapeObject('one', { z: 'a5' }));
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    tables = refreshOrder(tables, mirror, [FILLED_RECT_PASS]).tables;
    mirror.clearDirty();
    const { paintOrder, isClosingRank, isOccluderByRank } = tables;
    document.delete('one');
    document.create(shapeObject('two', { z: 'a6' }), shapeObject('three', { z: 'a7' }));
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    const next = refreshOrder(tables, mirror, [FILLED_RECT_PASS]);
    expect(next.change).toBe('appended');
    expect(next.tables.paintOrder).toBe(paintOrder);
    expect(next.tables.isClosingRank.buffer).toBe(isClosingRank.buffer);
    expect(next.tables.isOccluderByRank.buffer).toBe(isOccluderByRank.buffer);
    expect(next.tables.paintOrder).toEqual(['a', 'b', 'two', 'three']);
    expect([...next.tables.isOccluderByRank]).toEqual([1, 1, 1, 1]);
    expect(next.tables.isClosingRank).toHaveLength(4);
  });

  it('rebuilds the occluder table whole when an occluder changes state in the frame of an append', () => {
    const { mirror, document } = mirrored(board);
    const first = refreshOrder(EMPTY_ORDER, mirror, [FILLED_RECT_PASS]);
    mirror.clearDirty();
    document.update('a', { fill: null });
    document.create(shapeObject('top', { z: 'a5' }));
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    expect(mirror.isOccludersDirty).toBe(true);
    const next = refreshOrder(first.tables, mirror, [FILLED_RECT_PASS]);
    expect(next.change).toBe('appended');
    expect([...next.tables.isOccluderByRank]).toEqual([0, 1, 1]);
  });

  it('keeps an order nothing changed, edits it for a leaf below the top, and walks again after any other change', () => {
    const { mirror, document } = mirrored(board);
    const first = refreshOrder(EMPTY_ORDER, mirror, [FILLED_RECT_PASS]);
    mirror.clearDirty();
    expect(refreshOrder(first.tables, mirror, [FILLED_RECT_PASS]).change).toBe('kept');
    document.create(shapeObject('low', { z: 'Zz' }));
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    const edited = refreshOrder(first.tables, mirror, [FILLED_RECT_PASS]);
    expect(edited.change).toBe('edited');
    expect(edited.tables.paintOrder).toEqual(['low', 'a', 'b']);
    mirror.clearDirty();
    // A group arriving with its child is not a leaf: the order is walked again.
    document.create(
      groupObject('group', { z: 'a0V' }),
      shapeObject('child', { parentId: 'group', z: 'a0' }),
    );
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    const next = refreshOrder(edited.tables, mirror, [FILLED_RECT_PASS]);
    expect(next.change).toBe('rebuilt');
    expect(next.tables.paintOrder).toEqual(['low', 'a', 'group', 'child', 'b']);
  });

  it('drops objects deleted from the end before appending, and walks again if they are not its end', () => {
    const { mirror, document } = mirrored([...board, shapeObject('preview', { z: '~' })]);
    const first = refreshOrder(EMPTY_ORDER, mirror, [FILLED_RECT_PASS]);
    mirror.clearDirty();
    document.delete('preview');
    document.create(shapeObject('stroke', { z: 'a5' }));
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    const ranks = ranksByObject(first.tables.paintOrder, first.tables.isClosingRank);
    const next = refreshOrder(first.tables, mirror, [FILLED_RECT_PASS], ranks);
    expect(next.change).toBe('appended');
    expect(next.tables.paintOrder).toEqual(['a', 'b', 'stroke']);
    expect(next.tables.isOccluderByRank).toHaveLength(3);
    expect([...ranks.rankById]).toEqual([
      ['a', 0],
      ['b', 1],
      ['stroke', 2],
    ]);
    // Tables whose end is not what the mirror trimmed are walked again.
    const stale = { ...first.tables, paintOrder: ['a', 'preview', 'b'] as ObjectId[] };
    expect(refreshOrder(stale, mirror, [FILLED_RECT_PASS]).change).toBe('rebuilt');
  });

  it('walks again rather than append to an order not walked from its roots', () => {
    const { mirror, document } = mirrored(board);
    const first = refreshOrder(EMPTY_ORDER, mirror, [FILLED_RECT_PASS]);
    mirror.clearDirty();
    document.create(shapeObject('top', { z: 'a5' }));
    mirror.observe(document.takeChanges(), [FILLED_RECT_PASS]);
    const notFromRoots = { ...first.tables, isFromRoots: false };
    const next = refreshOrder(notFromRoots, mirror, [FILLED_RECT_PASS]);
    expect(next.change).toBe('rebuilt');
    expect(next.tables.paintOrder).toEqual(['a', 'b', 'top']);
  });
});

/** A z-order stage on a renderer whose one pass counts its occluder checks. */
interface Stage {
  readonly renderer: SceneRenderer;
  readonly segments: ZOrderSegments;
  readonly document: FakeSceneDocument;
  readonly occluderChecks: { count: number };
  /** The objects each frame drew, in draw order. */
  readonly frame: () => ObjectId[];
}

/**
 * A renderer with a z-order stage over a board.
 *
 * @param objects - The board.
 * @returns The stage, its first frame drawn.
 */
function stageOf(objects: readonly BoardObject[]): Stage {
  const occluderChecks = { count: 0 };
  const pass: ScenePass = {
    ...FILLED_RECT_PASS,
    isOccluder: (object) => {
      occluderChecks.count += 1;
      return FILLED_RECT_PASS.isOccluder?.(object) === true;
    },
  };
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [pass], isZOrdered: false });
  const segments = new ZOrderSegments();
  segments.install(renderer.frame);
  let drawList: readonly DrawListEntry[] = [];
  renderer.frame.insertStage('after', 'zOrderSegments', {
    name: 'captureDrawList',
    run: (context) => {
      drawList = [...context.drawList];
    },
  });
  const document = new FakeSceneDocument();
  document.create(...objects);
  const frame = (): ObjectId[] => {
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const owners = new Map<number, ObjectId>();
    for (const [id, slots] of renderer.scene.slotEntriesOf(pass.name)) {
      for (const slot of slots) owners.set(slot, id);
    }
    // A freed slot bridged inside a range is zeroed and draws nothing: only owned slots count.
    return drawList.flatMap(({ ranges }) =>
      ranges.flatMap(({ start, count }) =>
        Array.from({ length: count }, (unused, index) => owners.get(start + index)).filter(
          (id): id is ObjectId => id !== undefined,
        ),
      ),
    );
  };
  frame();
  return { renderer, segments, document, occluderChecks, frame };
}

/**
 * An object the stage's document holds.
 *
 * @param stage - The stage.
 * @param id - The object's id.
 * @returns The object.
 * @throws {Error} When the document does not hold it.
 */
function storedOf(stage: Stage, id: string): BoardObject {
  const object = stage.document.get(id as ObjectId);
  if (object === undefined) throw new Error(`The document holds no ${id}.`);
  return object;
}

describe('ZOrderSegments, an object created on top', () => {
  const board = Array.from({ length: BOARD_SIZE }, (unused, index) =>
    shapeObject(`s${String(index)}`, {
      z: zKeyAt(index),
      x: (index % 80) * 10,
      y: Math.floor(index / 80) * 10,
      width: 8,
      height: 8,
    }),
  );

  it('costs what was created, not the board: no walk, no rebuild, its slots patched', () => {
    const stage = stageOf(board);
    const before = { ...stage.segments.counts };
    const patches = stage.segments.slotPatchCount;
    stage.occluderChecks.count = 0;
    stage.document.create(
      shapeObject('stroke', { z: zKeyAt(BOARD_SIZE), x: 400, y: 300, width: 8, height: 8 }),
    );
    const drawn = stage.frame();
    expect(stage.segments.counts.orderBuilds).toBe(before.orderBuilds);
    expect(stage.segments.counts.slotBuilds).toBe(before.slotBuilds);
    expect(stage.segments.slotPatchCount).toBe(patches + 1);
    // The occluder table took the new object alone, not 5,000 objects again.
    expect(stage.occluderChecks.count).toBeLessThan(10);
    expect(drawn).toEqual(stageOf([...board, storedOf(stage, 'stroke')]).frame());
    expect(drawn.at(-1)).toBe('stroke');
  });

  it('replaces a preview with its stroke at the cost of the two', () => {
    const stage = stageOf([
      ...board,
      shapeObject('preview', { z: '~', x: 400, y: 300, width: 8, height: 8 }),
    ]);
    // Free a slot low in the pass, as a deletion anywhere would.
    stage.document.delete('s0');
    stage.frame();
    const before = { ...stage.segments.counts };
    stage.occluderChecks.count = 0;
    stage.document.delete('preview');
    stage.document.create(
      shapeObject('stroke', { z: zKeyAt(BOARD_SIZE), x: 400, y: 300, width: 8, height: 8 }),
    );
    const drawn = stage.frame();
    expect(stage.segments.counts.orderBuilds).toBe(before.orderBuilds);
    expect(stage.segments.counts.slotBuilds).toBe(before.slotBuilds);
    expect(stage.occluderChecks.count).toBeLessThan(10);
    const fresh = stageOf([...board.slice(1), storedOf(stage, 'stroke')]).frame();
    expect(drawn).toEqual(fresh);
  });

  it('edits the order for a leaf created below the top, and walks it for a group', () => {
    const stage = stageOf(board);
    const before = { ...stage.segments.counts };
    stage.occluderChecks.count = 0;
    stage.document.create(
      shapeObject('under', { z: zKeyAt(0), x: 400, y: 300, width: 8, height: 8 }),
    );
    const drawn = stage.frame();
    expect(stage.segments.counts.orderBuilds).toBe(before.orderBuilds);
    expect(stage.segments.counts.orderEdits).toBe(before.orderEdits + 1);
    expect(stage.occluderChecks.count).toBeLessThan(10);
    expect(drawn).toEqual(stageOf([...board, storedOf(stage, 'under')]).frame());
    stage.occluderChecks.count = 0;
    stage.document.create(
      groupObject('group', { z: zKeyAt(1) }),
      shapeObject('member', { parentId: 'group', x: 400, y: 300, width: 8, height: 8 }),
    );
    const grouped = stage.frame();
    expect(stage.segments.counts.orderBuilds).toBe(before.orderBuilds + 1);
    expect(stage.occluderChecks.count).toBeGreaterThanOrEqual(BOARD_SIZE);
    const objects = ['under', 'group', 'member'].map((id) => storedOf(stage, id));
    expect(grouped).toEqual(stageOf([...board, ...objects]).frame());
  });
});

describe('isEndHidden', () => {
  const sceneHiding = (hidden: readonly string[]) => ({
    passes: [FILLED_RECT_PASS],
    levelOfDetail: {
      hiddenIn: () => new Set(hidden as ObjectId[]),
    } as unknown as Parameters<typeof isEndHidden>[0]['levelOfDetail'],
  });

  it('keeps the hidden tables when nothing at the end is hidden', () => {
    expect(isEndHidden(sceneHiding([]), [Uint8Array.of(1, 0, 0)], 1, ['new' as ObjectId])).toBe(
      false,
    );
    expect(isEndHidden(sceneHiding(['old']), [undefined], 2, ['new' as ObjectId])).toBe(false);
  });

  it('rebuilds them when a trimmed rank or an appended object is hidden', () => {
    expect(isEndHidden(sceneHiding([]), [Uint8Array.of(0, 0, 1)], 2, [])).toBe(true);
    expect(isEndHidden(sceneHiding(['new']), [undefined], 2, ['new' as ObjectId])).toBe(true);
  });
});

describe('a pass’s slots under edits at the end', () => {
  it('keeps a pass bounded when a preview on top is drawn and dropped again and again', () => {
    const stage = stageOf([shapeObject('kept', { z: 'a0', x: 10, y: 10, width: 8, height: 8 })]);
    // Free a slot low in the pass first: a preview may take it, never more than it frees.
    stage.document.create(shapeObject('gone', { z: 'a1', x: 20, y: 10, width: 8, height: 8 }));
    stage.frame();
    stage.document.create(shapeObject('above', { z: 'a2', x: 30, y: 10, width: 8, height: 8 }));
    stage.frame();
    stage.document.delete('gone');
    stage.frame();
    for (let cycle = 0; cycle < 100; cycle += 1) {
      stage.document.create(shapeObject('preview', { z: '~', x: 40, y: 10, width: 8, height: 8 }));
      stage.frame();
      stage.document.delete('preview');
      stage.frame();
    }
    const buffer = stage.renderer.scene.instanceBufferOf(FILLED_RECT_PASS.name);
    expect(buffer.liveCount).toBe(2);
    expect(buffer.recordCount).toBeLessThanOrEqual(4);
  });
});
