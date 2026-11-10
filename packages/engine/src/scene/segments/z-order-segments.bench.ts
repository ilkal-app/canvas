import { bench, describe } from 'vitest';

import type { Camera } from '../../camera/camera.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, zKeyAt } from '../__fixtures__/scene-objects.js';
import type { InstanceRange, SceneCuller } from '../scene-culler.js';
import { SceneRenderer } from '../scene-renderer.js';

import {
  NOTE_PASS,
  stickyObject,
  TEXT_PASS,
  textObject,
} from './__fixtures__/note-and-text-passes.js';

// CPU cost of z-order segments over 10k visible objects (the budget: a
// camera-only frame under 1 ms of CPU). One object in ten is an opaque note, so the board has
// about 1000 segments; every text box has two records. Through a fake backend: the GPU side is
// the golden scene z-order-segments (tooling/golden/scenes).
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const OBJECT_COUNT = 10_000;
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

/** Every record visible, or every record but the last text box's: two visible sets to flip between. */
class FlippingCuller implements SceneCuller {
  isFlipped = false;
  private readonly visible = new Map<string, readonly InstanceRange[]>();
  private readonly flipped = new Map<string, readonly InstanceRange[]>();

  constructor(noteCount: number, textRecordCount: number) {
    this.visible.set('note', [{ start: 0, count: noteCount }]);
    this.visible.set('text', [{ start: 0, count: textRecordCount }]);
    this.flipped.set('note', [{ start: 0, count: noteCount }]);
    this.flipped.set('text', [{ start: 0, count: textRecordCount - 2 }]);
  }

  cull(): ReadonlyMap<string, readonly InstanceRange[]> {
    return this.isFlipped ? this.flipped : this.visible;
  }
}

/**
 * A board of 9000 text boxes and 1000 notes, stacked in creation order, rendered once.
 *
 * @param objectCount - Number of objects in the board.
 * @param textRecordPadding - Extra visible text slots for growing record counts.
 * @param viewRecords - At most this many records of each pass in view (a zoomed-in camera, as
 *   when typing); every record when absent.
 * @returns The backend, renderer, document and culler.
 */
function loadedBoard(
  objectCount = OBJECT_COUNT,
  textRecordPadding = 0,
  viewRecords = Number.POSITIVE_INFINITY,
): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
  document: FakeSceneDocument;
  culler: FlippingCuller;
} {
  const backend = new FakeGpuBackend();
  const noteCount = objectCount / 10;
  const textRecords = (objectCount - noteCount) * 2 + textRecordPadding;
  const culler = new FlippingCuller(
    Math.min(noteCount, viewRecords),
    Math.min(textRecords, viewRecords),
  );
  const renderer = new SceneRenderer(backend, { passes: [NOTE_PASS, TEXT_PASS], culler });
  const document = new FakeSceneDocument();
  for (let index = 0; index < objectCount; index += 1) {
    const fields = { x: (index % 100) * 20, y: Math.floor(index / 100) * 20, z: zKeyAt(index) };
    const id = `o${String(index)}`;
    document.create(index % 10 === 9 ? stickyObject(id, fields) : textObject(id, fields));
  }
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, renderer, document, culler };
}

describe(`z-order segments, ${String(OBJECT_COUNT)} visible objects`, () => {
  const still = loadedBoard();
  let stillTimeMs = 0;
  bench('camera-only frame (cached plan, nothing re-planned)', () => {
    stillTimeMs += 16;
    still.renderer.renderFrame({
      timeMs: stillTimeMs,
      camera: { ...CAMERA, x: stillTimeMs % 500 },
    });
    still.backend.resetCalls();
  });

  const panning = loadedBoard();
  let panTimeMs = 0;
  bench('visible set changes (re-plan the segments)', () => {
    panTimeMs += 16;
    panning.culler.isFlipped = !panning.culler.isFlipped;
    panning.renderer.renderFrame({ timeMs: panTimeMs, camera: CAMERA });
    panning.backend.resetCalls();
  });

  const reordering = loadedBoard();
  let reorderTimeMs = 0;
  bench('one object brought to front (new paint order, slot owners and plan)', () => {
    reorderTimeMs += 16;
    reordering.document.update('o0', { z: `b${String(reorderTimeMs).padStart(9, '0')}` });
    reordering.renderer.enqueue(reordering.document.takeChanges());
    reordering.renderer.renderFrame({ timeMs: reorderTimeMs, camera: CAMERA });
    reordering.backend.resetCalls();
  });
});

describe('z-order segments, 50k visible objects', () => {
  const typing = loadedBoard(50_000, 1);
  let typingTimeMs = 0;
  let isLong = false;
  bench("one text's record count changes on a 50k-object scene", () => {
    typingTimeMs += 16;
    isLong = !isLong;
    const text = isLong ? 'abc' : 'a';
    typing.document.update('o0', { text, runs: textObject('o0', { text }).runs });
    typing.renderer.enqueue(typing.document.takeChanges());
    typing.renderer.renderFrame({ timeMs: typingTimeMs, camera: CAMERA });
    typing.backend.resetCalls();
  });
});

describe('z-order segments, 50k objects, a few in view', () => {
  // As when typing: the camera shows a handful of objects, so the plan is cheap and
  // what is left is the slot-owner table, patched (not rebuilt) when a record count changes.
  const typing = loadedBoard(50_000, 1, 20);
  let typingTimeMs = 0;
  let isLong = false;
  bench("one text's record count changes, 20 records in view", () => {
    typingTimeMs += 16;
    isLong = !isLong;
    const text = isLong ? 'abc' : 'a';
    typing.document.update('o0', { text, runs: textObject('o0', { text }).runs });
    typing.renderer.enqueue(typing.document.takeChanges());
    typing.renderer.renderFrame({ timeMs: typingTimeMs, camera: CAMERA });
    typing.backend.resetCalls();
  });
});
