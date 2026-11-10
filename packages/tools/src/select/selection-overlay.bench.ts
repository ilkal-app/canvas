import { bench, describe } from 'vitest';

import { SceneRenderer, type Camera, type GpuRenderPass } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { RecordingGpuBackend } from './__fixtures__/recording-gpu-backend.js';
import { indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { SelectionOverlay } from './selection-overlay.js';

// CPU cost of the selection overlay for a large selection: a
// selection change (the frame recomputed over every selected object) and the model the page then
// builds and sends to the engine; the model again with the frame cached (the outline step
// alone); and the frame of a glide that changes the zoom, where the overlay rebuilds its
// rectangles at the new zoom (line widths and handle sizes follow it). Select all on a big board
// would otherwise outline every object in the model and on each such frame; above the outline
// cap the model carries the selection's count instead, so those costs stay bounded by the cap
// and the selection change is left with the frame's own O(selection) pass. Gated by
// `pnpm bench:ci` (its micro-benchmark suite).

/** A backend that records nothing, so a frame costs the overlay's own work. */
class SilentGpuBackend extends RecordingGpuBackend {
  override writeBuffer(): void {
    // Nothing is kept.
  }

  override beginRenderPass(): GpuRenderPass {
    return {
      setViewport: () => undefined,
      setPipeline: () => undefined,
      setBindGroup: () => undefined,
      setVertexBuffer: () => undefined,
      draw: () => undefined,
      end: () => undefined,
    };
  }
}

/**
 * `count` rectangles, 100 to a row on a 50 world-unit grid.
 *
 * @param count - How many.
 * @returns The objects.
 */
function board(count: number): BoardObject[] {
  return [...Array(count).keys()].map((index) =>
    rect(`r${String(index)}`, null, {
      x: (index % 100) * 50,
      y: Math.floor(index / 100) * 50,
      width: 40,
      height: 40,
    }),
  );
}

/**
 * A controller with every object of a board selected, and an overlay showing its model.
 *
 * @param count - How many objects the board has, all selected.
 * @returns The controller, and a frame at a zoom that draws the overlay.
 */
function selectedBoard(count: number) {
  const objects = board(count);
  const store = createSelectStore(objects);
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(indexOf(objects), storeSource(store)),
  });
  const ids = objects.map(({ id }): ObjectId => id);
  const others = ids.slice(1);
  controller.select(ids);
  const backend = new SilentGpuBackend();
  const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
  const overlay = new SelectionOverlay(backend);
  overlay.install(renderer.frame);
  overlay.setModel(controller.overlay());
  const camera: Camera = {
    x: 0,
    y: 0,
    zoom: 0.2,
    viewportWidthPx: 1280,
    viewportHeightPx: 800,
    dpr: 1,
  };
  let frameIndex = 0;
  const glideFrame = (): void => {
    // Each frame of a glide draws at a zoom the last one did not.
    frameIndex += 1;
    renderer.renderFrame({
      timeMs: frameIndex,
      camera: { ...camera, zoom: 0.2 + frameIndex * 1e-6 },
    });
  };
  let isAll = true;
  const reselect = (): void => {
    // A different selection each time, so the frame is recomputed over every selected object.
    isAll = !isAll;
    controller.select(isAll ? ids : others);
    controller.overlay();
  };
  return { controller, glideFrame, reselect };
}

const TEN_THOUSAND = selectedBoard(10_000);
const AT_THE_CAP = selectedBoard(500);

describe('selection overlay, 10,000 objects selected', () => {
  bench(
    'a selection change: every object (or all but one) selected, then the overlay model',
    () => {
      TEN_THOUSAND.reselect();
    },
  );

  bench('the overlay model again, the selection unchanged (its frame cached)', () => {
    TEN_THOUSAND.controller.overlay();
  });

  bench('a zoom-changing glide frame: the overlay rebuilt at the new zoom', () => {
    TEN_THOUSAND.glideFrame();
  });
});

describe('selection overlay, 500 objects selected (the outline cap)', () => {
  bench(
    'a selection change: every object (or all but one) selected, then the overlay model',
    () => {
      AT_THE_CAP.reselect();
    },
  );

  bench('the overlay model again, the selection unchanged (its frame cached)', () => {
    AT_THE_CAP.controller.overlay();
  });

  bench('a zoom-changing glide frame: the overlay rebuilt at the new zoom', () => {
    AT_THE_CAP.glideFrame();
  });
});
