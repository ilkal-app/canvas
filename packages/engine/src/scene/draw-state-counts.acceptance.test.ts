import { describe, expect, it } from 'vitest';

import { FRAME_COUNTER_NAMES } from '../diagnostics/frame-sample.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { SceneRenderer } from './scene-renderer.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };
const NAMES = ['renderPasses', 'pipelineSwitches', 'bindGroupChanges'] as const;

describe('GPU draw-state counters', () => {
  it('counts actual state changes cumulatively and copies only the frame delta into stats', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend);
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    renderer.enqueue(document.takeChanges());
    const first = renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const countedBackend = backend as FakeGpuBackend & {
      drawStateCounts: Record<(typeof NAMES)[number], number>;
    };
    const firstTotal = { ...countedBackend.drawStateCounts };
    expect(firstTotal).toMatchObject({ renderPasses: 1 });
    for (const name of NAMES)
      expect((first as unknown as Record<(typeof NAMES)[number], number>)[name]).toBe(
        firstTotal[name],
      );
    const second = renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    for (const name of NAMES) {
      expect((second as unknown as Record<(typeof NAMES)[number], number>)[name]).toBe(
        countedBackend.drawStateCounts[name] - firstTotal[name],
      );
    }
  });

  it('publishes all three frame counter names', () => {
    for (const name of NAMES) expect(FRAME_COUNTER_NAMES).toContain(name);
  });
});
