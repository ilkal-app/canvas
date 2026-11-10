import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import type { DrawListEntry } from './draw-list.js';
import type { ScenePass } from './scene-pass.js';
import { SceneRenderer } from './scene-renderer.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

/** A second pass drawing the same objects, so draw order across passes is observable. */
const OVER_PASS: ScenePass = { ...FILLED_RECT_PASS, name: 'over' };

function twoPassRenderer(): { backend: FakeGpuBackend; renderer: SceneRenderer } {
  const backend = new FakeGpuBackend();
  // Without z-order segments, so the built-in cull and draw stages are seen on their own.
  const renderer = new SceneRenderer(backend, {
    passes: [FILLED_RECT_PASS, OVER_PASS],
    isZOrdered: false,
  });
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b'), shapeObject('c'));
  renderer.enqueue(document.takeChanges());
  backend.resetCalls();
  return { backend, renderer };
}

/**
 * Describes each recorded draw by the instance buffer bound before it and its range.
 *
 * @param backend - The fake backend that recorded the frame.
 * @returns One line per draw, in order.
 */
function drawSequence(backend: FakeGpuBackend): string[] {
  const sequence: string[] = [];
  let bound = '';
  for (const call of backend.calls) {
    if (call.method === 'setVertexBuffer' && call.slot === 1) bound = call.label;
    if (call.method === 'draw') {
      sequence.push(`${bound} [${String(call.firstInstance)}, +${String(call.instanceCount)})`);
    }
  }
  return sequence;
}

describe('the cull and draw stages', () => {
  it('draw one entry per pass, in pass order, when nothing rewrites the draw list', () => {
    const { backend, renderer } = twoPassRenderer();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(drawSequence(backend)).toEqual([
      'solid-rect instances [0, +3)',
      'over instances [0, +3)',
    ]);
  });

  it('draw in the order a stage inserted after cull rewrites the draw list to', () => {
    const { backend, renderer } = twoPassRenderer();
    const seen: DrawListEntry[][] = [];
    renderer.frame.insertStage('after', 'cull', {
      name: 'segments',
      run: (context) => {
        seen.push([...context.drawList]);
        // Segment-major: records [0, 2) of every pass, then record 2 of every pass.
        context.drawList.splice(
          0,
          context.drawList.length,
          { passName: 'solid-rect', ranges: [{ start: 0, count: 2 }] },
          { passName: 'over', ranges: [{ start: 0, count: 2 }] },
          { passName: 'solid-rect', ranges: [{ start: 2, count: 1 }] },
          { passName: 'over', ranges: [{ start: 2, count: 1 }] },
        );
      },
    });
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(seen).toEqual([
      [
        { passName: 'solid-rect', ranges: [{ start: 0, count: 3 }] },
        { passName: 'over', ranges: [{ start: 0, count: 3 }] },
      ],
    ]);
    expect(drawSequence(backend)).toEqual([
      'solid-rect instances [0, +2)',
      'over instances [0, +2)',
      'solid-rect instances [2, +1)',
      'over instances [2, +1)',
    ]);
  });

  it('refuse a draw list entry that names no pass, and still end the render pass', () => {
    const { backend, renderer } = twoPassRenderer();
    renderer.frame.insertStage('after', 'cull', {
      name: 'broken',
      run: (context) => {
        context.drawList.push({ passName: 'text', ranges: [{ start: 0, count: 1 }] });
      },
    });
    expect(() => renderer.renderFrame({ timeMs: 0, camera: CAMERA })).toThrow(RangeError);
    expect(backend.count('endPass')).toBe(1);
  });
});
