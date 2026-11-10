import { bench, describe } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { PATH_LEVEL_OF_DETAIL } from '../paths/chord-mesh.js';
import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { benchSize } from '../spatial/__fixtures__/bench-size.js';
import { pathObject } from '../spatial/__fixtures__/spatial-objects.js';
import { textObject } from '../text/scene/__fixtures__/text-objects.js';
import { TEXT_LEVEL_OF_DETAIL } from '../text/scene/text-detail.js';

import { LevelOfDetail, type LodCounters, type LodPass } from './level-of-detail.js';
import { IMAGE_LOD_RULE, PATH_LOD_RULE, TEXT_LOD_RULE } from './lod-thresholds.js';

// The level-of-detail stage's CPU cost per frame on a 50k-object board (the
// budget: camera-only frames < 1 ms CPU): the bench board's mix, text (notes and text objects,
// 37%), images (8%) and paths (12%), the rest drawn in full, with a realistic spread of sizes
// (fix round 1): text lines of 2,000 distinct heights from 14 to 34 units, images of 4,000
// distinct longer edges from 60 to 460 units and freehand paths of 6,000 distinct box sides
// from 20 to 620 units, so a zoom frame cannot be cheap by there being few sizes. The usual zoom
// frame at 1× crosses no edge; far out (0.2×) the text's sizes sit on its thresholds, so each
// step takes a few of them across; a few frames of a sweep take every text across one; a pan
// past the padded region hands over a new visible set. CI's smoke run (`BENCH_SMOKE=1`) builds
// 2k objects.

const OBJECT_COUNT = benchSize({ full: 50_000, smoke: 2_000 });

/**
 * The size every pass measures here: the fixtures' sizes are widths.
 *
 * @param object - The object.
 * @returns Its width.
 */
const width = (object: BoardObject): number => ('width' in object ? object.width : 0);

/** A pass per rule. */
const PASSES: readonly LodPass[] = [
  { name: 'text', levelOfDetail: { rule: TEXT_LOD_RULE, sizeOf: width } },
  { name: 'image', levelOfDetail: { rule: IMAGE_LOD_RULE, sizeOf: width } },
  { name: 'path', levelOfDetail: { rule: PATH_LOD_RULE, sizeOf: width } },
];

/**
 * A spread of `count` distinct values from `from`, a step apart, picked by a scrambled index so
 * neighbouring objects differ.
 *
 * @param index - The object's index.
 * @param count - Distinct values.
 * @param from - The smallest.
 * @param step - Between values.
 * @returns The value.
 */
function spread(index: number, count: number, from: number, step: number): number {
  return from + ((index * 7_919) % count) * step;
}

/**
 * A level of detail tracking the board's objects, updated once at a scale.
 *
 * @param scale - Device pixels per world unit.
 * @returns It and every object's id.
 */
function loaded(scale: number): { lod: LevelOfDetail; ids: ObjectId[] } {
  const lod = new LevelOfDetail();
  lod.register(PASSES);
  const ids: ObjectId[] = [];
  for (let index = 0; index < OBJECT_COUNT; index += 1) {
    const slot = index % 100;
    const id = `o${String(index)}`;
    ids.push(id as ObjectId);
    if (slot < 37) lod.track(0, shapeObject(id, { width: spread(index, 2_000, 14, 0.01) }));
    else if (slot < 45) lod.track(1, shapeObject(id, { width: spread(index, 4_000, 60, 0.1) }));
    else if (slot < 57) lod.track(2, shapeObject(id, { width: spread(index, 6_000, 20, 0.1) }));
  }
  lod.update(ids, scale, counters());
  return { lod, ids };
}

function counters(): LodCounters {
  return { lodTransitions: 0, lodThrashes: 0 };
}

describe(`LevelOfDetail, ${String(OBJECT_COUNT)} objects of spread sizes`, () => {
  const still = loaded(1);
  let wobble = 0;
  bench('a zoom frame that crosses no edge (most frames of a sweep)', () => {
    wobble = (wobble + 1) % 100;
    still.lod.update(still.ids, 1 + wobble * 0.001, counters());
  });

  const far = loaded(0.2);
  let step = 0;
  bench('a far zoom frame (0.2×) taking a few sizes across an edge', () => {
    step = (step + 1) % 100;
    far.lod.update(far.ids, 0.2 * (1 + step * 0.001), counters());
  });

  const crossing = loaded(0.3);
  let isFar = false;
  bench('a zoom frame that takes every text across a threshold', () => {
    isFar = !isFar;
    // 14 to 34-unit lines: 1.4 to 3.4 device px (greek or hidden) and 7 to 17 px (full).
    crossing.lod.update(crossing.ids, isFar ? 0.1 : 0.5, counters());
  });

  const panned = loaded(1);
  const sets = [panned.ids, [...panned.ids]];
  let set = 0;
  bench('a new visible set at the same scale (a pan past the padded region)', () => {
    set = 1 - set;
    panned.lod.update(sets[set], 1, counters());
  });
});

// A drag (fix round 1): the scene tracks each moved object again (`Scene.upsert`), with the
// passes' real sizes (the text's placed runs, a path's bounds); a move changes no size, so no size
// needs measuring. Each frame's objects are new, with new nested arrays, as the document decodes
// them.
const DRAGGED = 1_000;

/**
 * A text object and a freehand path of 100 points at an offset, freshly built.
 *
 * @param index - Which pair.
 * @param offset - How far they moved, world units.
 * @returns The two objects.
 */
function draggedPair(index: number, offset: number): BoardObject[] {
  const points = Array.from({ length: 100 }, (unused, at) => ({ x: at * 3, y: (at % 7) * 5 }));
  return [
    textObject(`t${String(index)}`, 'a line of words to drag', { x: offset, y: offset }),
    pathObject(`p${String(index)}`, points, {}, { x: offset, y: offset }),
  ];
}

describe(`LevelOfDetail, a drag of ${String(DRAGGED)} texts and ${String(DRAGGED)} paths`, () => {
  const lod = new LevelOfDetail();
  lod.register([
    { name: 'text', levelOfDetail: TEXT_LEVEL_OF_DETAIL },
    { name: 'path', levelOfDetail: PATH_LEVEL_OF_DETAIL },
  ]);
  const frames = [0, 1].map((offset) =>
    Array.from({ length: DRAGGED }, (unused, index) => draggedPair(index, offset * 10)),
  );
  for (const [text, path] of frames[0] ?? []) {
    if (text !== undefined) lod.track(0, text);
    if (path !== undefined) lod.track(1, path);
  }
  let frame = 0;
  bench('tracking the moved objects again (a drag frame)', () => {
    frame = 1 - frame;
    for (const [text, path] of frames[frame] ?? []) {
      if (text !== undefined) lod.track(0, text);
      if (path !== undefined) lod.track(1, path);
    }
  });
});
