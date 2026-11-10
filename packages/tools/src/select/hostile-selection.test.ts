// The select tool on a board holding objects a peer wrote past the command layer: NaN,
// infinities, places past the drawable extent, negative sizes, children of an undrawable frame or
// group. The honest objects stay hittable and selectable; the hostile ones stay selectable by id
// but are left out of the selection frame, zoom to fit and snapping, all of which stay finite.
import { describe, expect, it } from 'vitest';

import { DrawableGate, SceneSpatialIndex, type Camera, type WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { fitCameraToRect } from '../camera/camera-moves.js';
import { snapCandidatesNear } from '../snap/snap-candidates.js';

import { frame, group, id, mapSource, rect } from './__fixtures__/select-board.js';
import { worldBoundsOfBox, type OrientedBox } from './oriented-box.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { selectionFrameOf } from './selection-frame.js';
import { orientedBoxOf } from './selection-geometry.js';

const HONEST: readonly BoardObject[] = [
  rect('a', null, { x: 0, y: 0, width: 100, height: 50 }),
  rect('b', null, { x: 200, y: 0, width: 50, height: 50 }),
  frame('f', null, { x: 400, y: 0, width: 200, height: 200 }),
  rect('c', 'f', { x: 20, y: 20, width: 40, height: 40 }),
];

const HOSTILE: readonly BoardObject[] = [
  rect('nan-x', null, { x: Number.NaN, y: 0, width: 10, height: 10 }),
  rect('far', null, { x: 1e308, y: 0, width: 10, height: 10 }),
  rect('infinite', null, { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }),
  rect('negative', null, { x: 0, y: 0, width: -5, height: 10 }),
  rect('turned-nan', null, { x: 0, y: 0, width: 10, height: 10, rotation: Number.NaN }),
  frame('nan-frame', null, { x: Number.NaN, y: 0, width: 100, height: 100 }),
  rect('orphan', 'nan-frame', { x: 10, y: 10, width: 10, height: 10 }),
  group('far-group', null, -1e308, 0),
  rect('far-member', 'far-group', { x: 0, y: 0, width: 10, height: 10 }),
];

const BOARD = [...HONEST, ...HOSTILE];
const ALL_IDS = BOARD.map((object) => object.id);
const HONEST_IDS = HONEST.map((object) => object.id);
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * The hit-test index the app keeps: fed through a `DrawableGate`, as `DocumentSceneFeed` does.
 *
 * @param objects - The board.
 * @returns The index.
 */
function gatedIndexOf(objects: readonly BoardObject[]): SceneSpatialIndex {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const index = new SceneSpatialIndex();
  const changes = { created: [...byId.keys()], updated: [], deleted: [], get: byId.get.bind(byId) };
  index.apply(new DrawableGate().filter(changes));
  return index;
}

/**
 * Whether every number of a value is finite.
 *
 * @param value - A box or a camera.
 * @returns True when they all are.
 */
function isFinite(value: OrientedBox | WorldBounds | Camera | undefined): boolean {
  return (
    value !== undefined &&
    Object.values(value).every((field) => typeof field !== 'number' || Number.isFinite(field))
  );
}

/**
 * The board as the app reads it: the hit gate's verdicts through `isDrawable`.
 *
 * @param objects - The board.
 * @returns The source.
 */
function gatedSource(objects: readonly BoardObject[]) {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const gate = new DrawableGate();
  gate.filter({ created: [...byId.keys()], updated: [], deleted: [], get: byId.get.bind(byId) });
  return { ...mapSource(objects), isDrawable: (key: ObjectId) => gate.isDrawable(key) };
}

describe('the select tool on a board with hostile objects', () => {
  it('leaves an object undrawable for a non-box reason out of the frame, as the picture does', () => {
    const invisible = { ...rect('invisible', null, { x: 900, y: 0, width: 50, height: 50 }) };
    const board = [
      ...HONEST,
      { ...invisible, fill: [Number.NaN, 0, 0, 1] as [number, number, number, number] },
    ];
    const source = gatedSource(board);
    expect(orientedBoxOf(invisible.id, source)).toBeUndefined();
    expect(selectionFrameOf([...HONEST_IDS, invisible.id], source)).toEqual(
      selectionFrameOf(HONEST_IDS, source),
    );
  });

  it('outlines no hostile object, and frames a select-all around the honest ones only', () => {
    const source = mapSource(BOARD);
    for (const object of HOSTILE)
      expect(orientedBoxOf(object.id, source), object.id).toBeUndefined();
    const everything = selectionFrameOf(ALL_IDS, source);
    expect(isFinite(everything)).toBe(true);
    expect(everything).toEqual(selectionFrameOf(HONEST_IDS, source));
  });

  it('zooms to fit and to the selection with a finite camera', () => {
    const source = mapSource(BOARD);
    const index = gatedIndexOf(BOARD);
    const { bounds } = index;
    const selection = selectionFrameOf(ALL_IDS, source);
    if (bounds === undefined || selection === undefined) throw new Error('the board has bounds');
    const fit = fitCameraToRect(CAMERA, bounds, 24);
    expect(isFinite(fit)).toBe(true);
    const toSelection = fitCameraToRect(CAMERA, worldBoundsOfBox(selection), 24);
    expect(isFinite(toSelection)).toBe(true);
    expect(toSelection).toEqual(fit);
  });

  it('hits and marquee-selects the honest objects only', () => {
    const source = mapSource(BOARD);
    const tester = createSelectHitTester(gatedIndexOf(BOARD), source);
    expect(tester.hitPoint({ x: 5, y: 5 }, 1)?.id).toBe(id('a'));
    expect(tester.hitPoint({ x: 430, y: 30 }, 1)?.id).toBe(id('c'));
    const marquee = tester.hitRect({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }, 'intersect');
    expect(new Set(marquee)).toEqual(new Set(['a', 'b', 'f'].map(id)));
  });

  it('snaps to the honest objects only, at finite boxes', () => {
    const source = mapSource(BOARD);
    const moving = { minX: 100, minY: 60, maxX: 140, maxY: 100 };
    const candidates = snapCandidatesNear(
      gatedIndexOf(BOARD),
      source,
      moving,
      new Set<ObjectId>(),
      {
        viewport: { minX: -200, minY: -200, maxX: 800, maxY: 400 },
        thresholdWorld: 1000,
      },
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const box of candidates) expect(isFinite(box)).toBe(true);
    expect(candidates.length).toBeLessThanOrEqual(HONEST.length);
  });
});
