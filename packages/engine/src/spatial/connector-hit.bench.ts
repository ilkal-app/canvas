import { bench, describe } from 'vitest';

import type { BoardObject, ConnectorObject } from '@canvas/schema';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { benchSize } from './__fixtures__/bench-size.js';
import { connectorObject } from './__fixtures__/spatial-objects.js';
import { hitPoint, hitTopmost } from './hit-point.js';
import { worldBoundsOf } from './object-world-bounds.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

// What picking a connector by its label and 6 px round its line (item 5) costs on a
// 50k-object board (input handling shares the frame's budget): a press
// on a label and beside a line, a hover's topmost pick, and a labelled connector's bounds,
// which every change to it recomputes. A quarter of the board is labelled connectors, each
// between two of the grid's shapes. CI's smoke run (`BENCH_SMOKE=1`) builds about 2k objects.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const SIDE = benchSize({ full: 224, smoke: 45 }); // 224² ≈ 50k objects
const SPACING = 40;
const LABEL: NonNullable<ConnectorObject['label']> = {
  text: 'Depends on',
  runs: [
    {
      length: 10,
      style: {
        fontFamily: 'Liberation Sans',
        fontSize: 14,
        color: [0, 0, 0, 1],
        weight: 400,
        italic: false,
      },
    },
  ],
};

/**
 * A labelled connector across one grid cell, from (x, y) to (x + 2 cells, y + 1 cell).
 *
 * @param id - Its id.
 * @param x - Its start's x.
 * @param y - Its start's y.
 * @returns The connector.
 */
function labelled(id: string, x: number, y: number): ConnectorObject {
  return {
    ...connectorObject(id),
    from: { kind: 'point', x, y },
    to: { kind: 'point', x: x + 2 * SPACING, y: y + SPACING },
    label: LABEL,
  };
}

const OBJECTS: BoardObject[] = [];
for (let index = 0; index < SIDE * SIDE; index += 1) {
  const x = (index % SIDE) * SPACING;
  const y = Math.floor(index / SIDE) * SPACING;
  OBJECTS.push(
    index % 4 === 0
      ? labelled(`c${String(index)}`, x + 8, y + 8)
      : shapeObject(`s${String(index)}`, { x, y, width: 16, height: 16 }),
  );
}
const DOCUMENT = new FakeSceneDocument();
DOCUMENT.create(...OBJECTS);
const INDEX = new SceneSpatialIndex();
INDEX.apply(DOCUMENT.takeChanges());

// The connector c(row 40 · SIDE + 40): from (1608, 1608) to (1688, 1648), its label at (1648, 1628).
const CELL = 40 * SPACING + 8;
const ON_LABEL = { x: CELL + SPACING, y: CELL + SPACING / 2 - 6 };
const ON_LINE = { x: CELL + 10, y: CELL + 5 + 4 };
const AT_ZOOM_1 = { zoom: 1 };
const SAMPLE = labelled('bounds', 100, 100);
const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 };

describe(`picking connectors, ${String(SIDE * SIDE)} objects, a quarter labelled connectors`, () => {
  bench('hitPoint: a press on a label', () => {
    hitPoint(INDEX, DOCUMENT, ON_LABEL, AT_ZOOM_1);
  });

  bench('hitPoint: a press 4 px off a line', () => {
    hitPoint(INDEX, DOCUMENT, ON_LINE, AT_ZOOM_1);
  });

  bench('hitTopmost: a hover over a label', () => {
    hitTopmost(INDEX, DOCUMENT, ON_LABEL, AT_ZOOM_1);
  });

  bench('worldBoundsOf: a labelled connector', () => {
    worldBoundsOf(SAMPLE, IDENTITY);
  });
});
