// A frame switched between sharp and rounded corners, incrementally: its background moves between the flat-quad passes (solid-rect, rect-gradient) and the
// rounded-rect passes, and rect-image, its outline and its shadow take radii or zeros. After
// every edit the renderer's draw order and each frame record (less the scene's clip index and a
// gradient's paint table row, which depend on allocation order) must equal a fresh renderer's
// given the board as it now is, across background changes in between, with the frame stroked
// (a closing rank) and shadowed (its own rank flagged) over content below and holding a child.
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, Gradient, ImagePaint, ObjectId } from '@canvas/schema';

import { fixtureAssetId } from '../../images/fixture-asset-source.js';
import type { WorkerPool } from '../../workers/worker-pool.js';
import { type FakeSceneDocument, frameObject, shapeObject } from '../__fixtures__/scene-objects.js';
import { FRAME_SHAPE_FLOATS } from '../frame-shape-record.js';

import { createDrawn, drawOrder, type Drawn } from './__fixtures__/standard-draw-order.js';

const pools: WorkerPool[] = [];

afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

const GRADIENT: Gradient = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

const IMAGE: ImagePaint = {
  type: 'image',
  assetId: fixtureAssetId('photo'),
  naturalSize: { width: 400, height: 300 },
  fit: 'fill',
  crop: { x: 0, y: 0, width: 1, height: 1 },
};

/** The frame passes whose records are compared, and the floats each record's comparison skips. */
const FRAME_PASSES: Readonly<Record<string, readonly number[]>> = {
  'frame-shadow': [],
  'solid-rect': [],
  'rect-gradient': [10],
  'rect-image': [4, 5, 6, 7],
  'rounded-rect': [],
  'rounded-rect-gradient': [FRAME_SHAPE_FLOATS],
  'frame-stroke': [],
};

/**
 * Each frame pass's records of each object, without the floats that depend on allocation order
 * (the clip index, a paint table row) or on image residency (a placeholder colour). For the image
 * background only its box and corner radii are kept: the tail is residency's.
 *
 * @param drawn - The renderer.
 * @returns `pass:object` to its records' floats.
 */
function frameRecords(drawn: Drawn): Map<string, number[][]> {
  const { scene } = drawn.renderer;
  const records = new Map<string, number[][]>();
  for (const [pass, skipped] of Object.entries(FRAME_PASSES)) {
    const buffer = scene.instanceBufferOf(pass);
    const { floatsPerRecord, clipFloat } = buffer.layout;
    const kept = (index: number) =>
      index !== clipFloat &&
      !skipped.includes(index) &&
      (pass !== 'rect-image' || index < 4 || (index >= 8 && index < FRAME_SHAPE_FLOATS));
    for (const [id, slots] of scene.slotEntriesOf(pass)) {
      records.set(
        `${pass}:${id}`,
        slots.map((slot) =>
          Array.from(
            buffer.data.subarray(slot * floatsPerRecord, (slot + 1) * floatsPerRecord),
          ).filter((unused, index) => kept(index)),
        ),
      );
    }
  }
  return records;
}

/**
 * Draws a board, then applies each edit in turn, checking after each that the renderer draws, in
 * the same order and with the same frame records, what a fresh renderer given the board draws.
 *
 * @param board - The board.
 * @param edits - The edits, each on the document.
 * @returns The draw order after the board and after each edit.
 */
async function drawSteps(
  board: readonly BoardObject[],
  edits: readonly ((document: FakeSceneDocument) => void)[],
): Promise<string[][]> {
  const drawn = createDrawn(pools);
  const objects = new Map<ObjectId, BoardObject>(board.map((object) => [object.id, object]));
  drawn.document.create(...board);
  drawn.renderer.enqueue(drawn.document.takeChanges());
  const orders = [await drawOrder(drawn)];
  for (const edit of edits) {
    edit(drawn.document);
    const changes = drawn.document.takeChanges();
    for (const id of [...changes.created, ...changes.updated, ...changes.deleted]) {
      const object = changes.get(id);
      if (object) objects.set(id, object);
      else objects.delete(id);
    }
    drawn.renderer.enqueue(changes);
    const order = await drawOrder(drawn);
    const fresh = createDrawn(pools);
    fresh.document.create(...objects.values());
    fresh.renderer.enqueue(fresh.document.takeChanges());
    expect(order).toEqual(await drawOrder(fresh));
    expect(frameRecords(drawn)).toEqual(frameRecords(fresh));
    orders.push(order);
  }
  return orders;
}

describe('a frame switched between sharp and rounded corners', () => {
  it('draws as a fresh renderer does after each switch and background change', async () => {
    const board = [
      shapeObject('below', { x: 20, y: 20, width: 200, height: 200, z: 'a0' }),
      frameObject('f', {
        x: 40,
        y: 40,
        width: 200,
        height: 160,
        z: 'a1',
        clip: true,
        showName: false,
        background: [0.9, 0.9, 1, 1],
        stroke: { color: [0, 0, 0, 1], width: 4 },
        strokeAlign: 'outside',
        shadow: { x: 6, y: 6, blur: 0, spread: 0, color: [0, 0, 0, 0.5] },
      }),
      shapeObject('child', { parentId: 'f', x: 0, y: 0, width: 60, height: 60, z: 'a0' }),
      shapeObject('above', { x: 200, y: 160, width: 80, height: 80, z: 'a2' }),
    ];
    const set =
      (fields: Record<string, unknown>) =>
      (document: FakeSceneDocument): void => {
        document.update('f', fields);
      };
    const orders = await drawSteps(board, [
      set({ cornerRadius: 24 }),
      set({ background: GRADIENT }),
      set({ cornerRadius: undefined }),
      set({ cornerRadius: [0, 8, 16, 24] }),
      set({ background: IMAGE }),
      set({ cornerRadius: undefined }),
      set({ cornerRadius: 40, background: [0.2, 0.4, 0.6, 1] }),
      set({ cornerRadius: undefined }),
    ]);
    const background = (order: readonly string[]) =>
      order.filter((entry) => entry.endsWith(':f') && !entry.startsWith('frame-'));
    expect(orders.map(background)).toEqual([
      ['solid-rect:f'],
      ['rounded-rect:f'],
      ['rounded-rect-gradient:f'],
      ['rect-gradient:f'],
      ['rounded-rect-gradient:f'],
      ['rect-image:f'],
      ['rect-image:f'],
      ['rounded-rect:f'],
      ['solid-rect:f'],
    ]);
    for (const order of orders) {
      expect(order.indexOf('frame-shadow:f')).toBeLessThan(order.indexOf('sdf-shape:child'));
      expect(order.indexOf('frame-stroke:f')).toBeGreaterThan(order.indexOf('sdf-shape:child'));
    }
  });
});
