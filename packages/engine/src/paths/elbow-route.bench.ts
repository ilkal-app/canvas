import { bench, describe } from 'vitest';

import type { LineCap, LineObject } from '@canvas/schema';

import { benchSize } from '../spatial/__fixtures__/bench-size.js';
import { lineObject } from '../spatial/__fixtures__/spatial-objects.js';
import { objectGeometry } from '../spatial/object-geometry.js';

import { elbowRoute } from './elbow-route.js';
import { flattenToleranceOf } from './flatten-bucket.js';
import { meshJobRequestOf, runMeshJob } from './mesh-job.js';

// CPU cost of routing and meshing lines (path flattening and mesh
// building are time-sliced). The 50k board's lines (5% of its objects, 2,500 lines) are drawn by
// the path pass in the frame-time suite's zoom sweep (tooling/bench) through the real engine
// host; here, routing every one of them, meshing them at one bucket, and the geometry hit testing
// and the spatial index build per line, all on the CPU. The GPU side is the golden scene
// lines-and-arrows (tooling/golden/scenes).

/** The 50k board's lines: 5% of its objects. */
const LINE_COUNT = benchSize({ full: 2500, smoke: 250 });
const CAPS: readonly LineCap[] = ['none', 'arrow', 'triangle', 'circle', 'diamond'];

/**
 * A line of the bench board: every other one an elbow, with caps cycling through the kinds.
 *
 * @param index - Its place.
 * @returns The line.
 */
function benchLine(index: number): LineObject {
  return lineObject(`l${String(index)}`, {
    x: (index % 50) * 150,
    y: Math.floor(index / 50) * 150,
    points: [
      { x: 0, y: 0 },
      { x: 60 + (index % 7) * 10, y: 20 + (index % 11) * 8 },
    ],
    route: index % 2 === 0 ? 'elbow' : 'straight',
    endCap: CAPS[index % CAPS.length] ?? 'arrow',
  });
}

describe(`${String(LINE_COUNT)} lines`, () => {
  const lines = Array.from({ length: LINE_COUNT }, (unused, index) => benchLine(index));

  bench('elbowRoute of every line', () => {
    for (const { points } of lines) elbowRoute(points[0], points[1]);
  });

  bench('objectGeometry of every line (route and heads, as hit testing reads them)', () => {
    const tolerance = flattenToleranceOf(0);
    for (const line of lines) objectGeometry(line, tolerance);
  });

  const requests = lines.map((line) => meshJobRequestOf(line, 1, 0));
  bench('mesh every line at one zoom bucket', () => {
    for (const request of requests) runMeshJob(request);
  });
});
