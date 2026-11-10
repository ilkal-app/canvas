import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { CAMERA_UNIFORM_BYTE_LENGTH } from '../scene/camera-uniform.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { MemoryLedger } from './memory-ledger.js';
import { CAMERA_UNIFORM_OWNER, CLIP_TABLE_OWNER, reportSceneMemory } from './scene-memory.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

describe('reportSceneMemory', () => {
  it('reports each pass instance buffer by pass name and the camera uniform', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [FILLED_RECT_PASS],
      scene: { instanceBuffer: { initialCapacity: 4 } },
    });
    const ledger = new MemoryLedger();
    renderer.frame.insertStage('after', 'submit', {
      name: 'report',
      run: (context) => {
        reportSceneMemory(context, ledger);
      },
    });
    const document = new FakeSceneDocument();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const buffer = renderer.scene.instanceBufferOf('solid-rect');
    const initialBytes = buffer.byteLength;
    expect(ledger.ownersOf('instanceBuffers')).toEqual(new Map([['solid-rect', initialBytes]]));
    expect(ledger.ownersOf('uniforms')).toEqual(
      new Map([[CAMERA_UNIFORM_OWNER, CAMERA_UNIFORM_BYTE_LENGTH]]),
    );

    for (let index = 0; index < 5; index += 1) document.create(shapeObject(`s${String(index)}`));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(buffer.byteLength).toBe(2 * initialBytes);
    expect(ledger.bytesOf('instanceBuffers')).toBe(2 * initialBytes);
  });

  it('reports the clip table texture under textures, growing with the table', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [FILLED_RECT_PASS] });
    const ledger = new MemoryLedger();
    renderer.frame.insertStage('after', 'submit', {
      name: 'report',
      run: (context) => {
        reportSceneMemory(context, ledger);
      },
    });
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const initial = ledger.ownersOf('textures').get(CLIP_TABLE_OWNER);
    expect(initial).toBeGreaterThan(0);
    const document = new FakeSceneDocument();
    for (let index = 0; index < 40; index += 1) {
      const frame = `f${String(index)}`;
      document.create(
        frameObject(frame, { clip: true }),
        shapeObject(`s${String(index)}`, { parentId: frame }),
      );
    }
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(ledger.ownersOf('textures').get(CLIP_TABLE_OWNER)).toBeGreaterThan(initial ?? 0);
  });
});
