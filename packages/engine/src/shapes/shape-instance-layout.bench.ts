import { bench, describe } from 'vitest';

import { packShapeInstances, SHAPE_INSTANCE_FLOATS } from './shape-instance-layout.js';
import type { ShapeInstance, ShapeKind } from './shape-instance.js';
import { noteInstances } from './sticky-note.js';

// CPU packing alone, gated by `pnpm bench:ci` (its micro-benchmark suite). The shapes' GPU time is the frame-time suite's `scene` pass time
// (tooling/bench), gated there.

/** A dense board's worth of records: 5k sticky notes, two instances each, or 10k shapes. */
const INSTANCE_COUNT = 10_000;

function noteGrid(noteCount: number): ShapeInstance[] {
  const instances: ShapeInstance[] = [];
  for (let index = 0; index < noteCount; index += 1) {
    const rect = {
      x: (index % 100) * 220,
      y: Math.floor(index / 100) * 220,
      width: 200,
      height: 200,
    };
    instances.push(...noteInstances(rect, [1, 0.92, 0.55, 1]));
  }
  return instances;
}

const INSTANCES: readonly ShapeInstance[] = noteGrid(INSTANCE_COUNT / 2);

/** The kinds a board's shapes cycle through. */
const KINDS: readonly ShapeKind[] = ['rounded-box', 'ellipse', 'diamond', 'polygon', 'star'];

/**
 * A board's worth of shape objects: every kind in turn, turned, filled and outlined,
 * the polygons and stars with five sides: the records the shape pass writes for shapes.
 *
 * @param count - How many shapes.
 * @returns The instances.
 */
function shapeGrid(count: number): ShapeInstance[] {
  return Array.from({ length: count }, (unused, index) => ({
    kind: KINDS[index % KINDS.length] ?? 'rounded-box',
    x: (index % 100) * 140,
    y: Math.floor(index / 100) * 100,
    width: 120,
    height: 80,
    color: [0.87, 0.93, 1, 1],
    radius: index % 2 === 0 ? 8 : 0,
    softness: 0,
    rotation: 0.1,
    sides: 5,
    stroke: { color: [0.23, 0.45, 0.85, 1], width: 2 },
  }));
}

const SHAPES: readonly ShapeInstance[] = shapeGrid(INSTANCE_COUNT);

const TARGET = new Float32Array(INSTANCE_COUNT * SHAPE_INSTANCE_FLOATS);

describe('packShapeInstances, 10k instances', () => {
  bench('pack every record (a full rebuild)', () => {
    packShapeInstances(INSTANCES, TARGET);
  });

  bench('pack one note into its records (a dirty-range update)', () => {
    packShapeInstances(INSTANCES.slice(4_000, 4_002), TARGET, 4_000);
  });
});

describe('packShapeInstances, 10k shape objects of every kind, outlined', () => {
  bench('pack every record (a full rebuild)', () => {
    packShapeInstances(SHAPES, TARGET);
  });

  bench('pack one shape into its record (a dirty-range update)', () => {
    packShapeInstances(SHAPES.slice(4_000, 4_001), TARGET, 4_000);
  });
});
