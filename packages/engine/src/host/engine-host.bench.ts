import { bench, describe } from 'vitest';

import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';

import { coalescePointerInputs, type PointerInput } from './pointer-input.js';
import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

// CPU cost the engine host adds to a frame: serialising a change set on
// the main thread, applying it to the worker's mirror, and coalescing a frame's pointer inputs.
// The frame itself is benchmarked in scene/scene-renderer.bench.ts; the real-worker path (a
// frame kept while the main thread is busy) by the scenario spec
// tooling/scenario/specs/engine/engine-host-frames.real-clock.spec.ts.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const CHILD_COUNT = 1_000;
const CHANGE_COUNT = 100;

/**
 * A frame holding 1,000 rectangles, loaded into a mirror.
 *
 * @returns The document and the mirror that has received all of it.
 */
function loadedMirror(): { document: FakeSceneDocument; mirror: SceneSourceMirror } {
  const document = new FakeSceneDocument();
  document.create(frameObject('frame', { width: 2_000, height: 2_000 }));
  for (let index = 0; index < CHILD_COUNT; index += 1) {
    document.create(shapeObject(`s${String(index)}`, { parentId: 'frame', x: index }));
  }
  const mirror = new SceneSourceMirror();
  mirror.apply(serializeChangeSet(document.takeChanges()));
  return { document, mirror };
}

describe('engine host change sets', () => {
  const { document, mirror } = loadedMirror();
  let round = 0;
  bench(`serialise and mirror a ${String(CHANGE_COUNT)}-object move (ancestors included)`, () => {
    round += 1;
    for (let index = 0; index < CHANGE_COUNT; index += 1) {
      document.update(`s${String(index * 10)}`, { y: round });
    }
    mirror.apply(serializeChangeSet(document.takeChanges()));
  });

  bench(`serialise and mirror a ${String(CHILD_COUNT + 1)}-object first load`, () => {
    loadedMirror();
  });
});

describe('engine host pointer inputs', () => {
  const inputs: PointerInput[] = Array.from({ length: 240 }, (slot, index) => ({
    type: index % 60 === 0 ? 'down' : 'move',
    xPx: index,
    yPx: index,
    buttons: 1,
    pointerId: index % 2,
    timestampMs: index,
  }));
  bench('coalesce 240 inputs of two pointers (a busy frame of a 4 kHz pen)', () => {
    coalescePointerInputs(inputs);
  });
});
