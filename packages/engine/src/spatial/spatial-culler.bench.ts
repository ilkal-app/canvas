import { bench, describe } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { Scene } from '../scene/scene.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';

import { benchSize } from './__fixtures__/bench-size.js';
import { SpatialCuller } from './spatial-culler.js';

// The cull stage's CPU cost per frame on a 50k-object board: a camera
// move inside the padded region (no query), a pan that re-queries, a zoom-out to the whole
// board, and a one-object drag inside the view. CI's smoke run (`BENCH_SMOKE=1`) spreads 45² ≈ 2k
// objects over the same world, so each view holds the same fraction of the board.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const SIDE = benchSize({ full: 224, smoke: 45 }); // 224² ≈ 50k objects
const OBJECT_COUNT = SIDE * SIDE;
/** The board's side, world units: at full size one 16 × 16 shape every 20 units. */
const WORLD_SIDE = 224 * 20;
const SPACING = WORLD_SIDE / SIDE;
/** The grid column and row of the dragged object, the one nearest (1200, 1200), inside the view. */
const DRAGGED_CELL = Math.round(1200 / SPACING);
const DRAGGED_ID = `s${String(DRAGGED_CELL * SIDE + DRAGGED_CELL)}`;
const DRAGGED_X = DRAGGED_CELL * SPACING;

function loaded(): {
  scene: Scene;
  culler: SpatialCuller;
  document: FakeSceneDocument;
  apply: () => void;
} {
  const scene = new Scene([SOLID_RECT_PASS], { instanceBuffer: { initialCapacity: OBJECT_COUNT } });
  const culler = new SpatialCuller();
  const document = new FakeSceneDocument();
  for (let index = 0; index < OBJECT_COUNT; index += 1) {
    const x = (index % SIDE) * SPACING;
    const y = Math.floor(index / SIDE) * SPACING;
    document.create(shapeObject(`s${String(index)}`, { x, y, width: 16, height: 16 }));
  }
  const apply = () => {
    const changes = document.takeChanges();
    scene.apply(changes);
    culler.applyChanges(changes);
  };
  apply();
  return { scene, culler, document, apply };
}

function viewportAt(x: number, y: number, zoom = 1) {
  return { minX: x, minY: y, maxX: x + 1600 / zoom, maxY: y + 1000 / zoom };
}

describe(`SpatialCuller, ${String(OBJECT_COUNT)} objects`, () => {
  const still = loaded();
  still.culler.cull(still.scene, viewportAt(1000, 1000));
  let wobble = 0;
  bench('camera move inside the padded region (reuses the visible set)', () => {
    wobble = (wobble + 1) % 100;
    still.culler.cull(still.scene, viewportAt(1000 + wobble, 1000));
  });

  const panning = loaded();
  let pan = 0;
  bench('pan past the padded region (one search, about a fifth of the board visible)', () => {
    pan = (pan + 1000) % 2000;
    panning.culler.cull(panning.scene, viewportAt(pan, pan));
  });

  const zoomedOut = loaded();
  let zoom = 0.05;
  // A fourfold zoom leaves the reuse rule's twofold limit, so every frame searches again.
  bench('zoom between 0.05 and 0.2 (whole board visible, one search)', () => {
    zoom = zoom === 0.05 ? 0.2 : 0.05;
    zoomedOut.culler.cull(zoomedOut.scene, viewportAt(-100, -100, zoom));
  });

  const dragging = loaded();
  dragging.culler.cull(dragging.scene, viewportAt(1000, 1000));
  let drag = 0;
  bench('one-object drag inside the view (apply; ranges kept)', () => {
    drag = (drag + 1) % 50;
    dragging.document.update(DRAGGED_ID, { x: DRAGGED_X + drag });
    dragging.apply();
    dragging.culler.cull(dragging.scene, viewportAt(1000, 1000));
  });
});
