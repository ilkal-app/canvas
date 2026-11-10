// Where a frame's name draws, for the spatial index: the name sits above the frame's
// box at a constant size on screen, so it reaches farther on the board as the camera zooms out.
// The index holds a zoom-independent bound of every size the name is drawn at, so culling keeps
// it and the z-order segments order it against what overlaps it, with no re-index on a zoom.
import { describe, expect, it } from 'vitest';

import { frameObject, shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import { SOLID_RECT_PASS } from '../../scene/solid-rect-pass.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';

import { CAMERA, createTextSetUp } from './__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS, FRAME_TITLE_PASS_NAME } from './frame-title-pass.js';

/**
 * A renderer with frame backgrounds, shapes and frame names, drawn in z-order segments.
 *
 * @param culler - The culler, to read the index.
 * @returns The set-up.
 */
function setUp(culler = new SpatialCuller({ paddingFraction: 0 })) {
  const setup = createTextSetUp(CAMERA, true, true, {
    culler,
    passes: [SOLID_RECT_PASS, SDF_SHAPE_PASS, FRAME_TITLE_PASS],
  });
  return { ...setup, culler };
}

describe('the frame title’s drawing bounds', () => {
  it('draws a name before a higher shape that overlaps only the name', async () => {
    const { renderer, document, settle, backend } = setUp();
    document.create(
      frameObject('a', { x: 20, y: 60, width: 200, height: 100, z: 'a0', name: 'Plan' }),
      shapeObject('b', { x: 20, y: 40, width: 100, height: 16, z: 'a1' }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 9_000, camera: CAMERA });
    const pipelines = backend.calls
      .flatMap((call) => (call.method === 'setPipeline' ? [call.label] : []))
      .filter((label, index, labels) => label !== labels[index - 1]);
    expect(pipelines).toEqual(['solid-rect', FRAME_TITLE_PASS_NAME, 'sdf-shape']);
  });

  it('reaches above the frame as far as the name is drawn when zoomed out, turned with it', async () => {
    const { renderer, document, settle, culler } = setUp();
    document.create(frameObject('a', { x: 20, y: 60, width: 200, height: 100, name: 'Plan' }));
    renderer.enqueue(document.takeChanges());
    await settle();
    const bounds = culler.index.boundsOf('a' as never);
    // Drawn down to 40 device px of width, a fifth of 200 units at dpr 1: a CSS px is up to
    // five units, and the name's line sits about 4 to 19 CSS px above the edge.
    expect(bounds?.minY).toBeLessThan(60 - 19 * 5 + 10);
    expect(bounds?.minY).toBeGreaterThan(60 - 24 * 5 - 10);
    expect(bounds?.maxY).toBe(160);
    document.update('a', { rotation: Math.PI / 2 });
    renderer.enqueue(document.takeChanges());
    await settle();
    // Turned a quarter, "above" the frame is to its right.
    const turned = culler.index.boundsOf('a' as never);
    expect(turned?.maxX).toBeGreaterThan(20 + 19 * 5 - 10);
  });

  it('keeps the index as it is across zooms, and publishes it again for a new pixel ratio', async () => {
    const { renderer, document, settle, culler } = setUp();
    document.create(frameObject('a', { x: 20, y: 60, width: 200, height: 100, name: 'Plan' }));
    renderer.enqueue(document.takeChanges());
    await settle();
    const before = culler.index.boundsOf('a' as never);
    const revision = culler.index.drawingBoundsRevision;
    await settle(12, { ...CAMERA, zoom: 0.3 });
    await settle(12, { ...CAMERA, zoom: 4 });
    expect(culler.index.drawingBoundsRevision).toBe(revision);
    expect(culler.index.boundsOf('a' as never)).toEqual(before);
    await settle(12, { ...CAMERA, dpr: 2 });
    const doubled = culler.index.boundsOf('a' as never);
    expect(doubled?.minY).toBeLessThan(before?.minY ?? 0);
  });

  it('withdraws the reach when the name is hidden, and publishes it when shown', async () => {
    const { renderer, document, settle, culler } = setUp();
    document.create(frameObject('a', { x: 20, y: 60, width: 200, height: 100, name: 'Plan' }));
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(culler.index.boundsOf('a' as never)?.minY).toBeLessThan(60);
    document.update('a', { showName: false });
    renderer.enqueue(document.takeChanges());
    await settle();
    // Only the frame's own box is left in the index.
    expect(culler.index.boundsOf('a' as never)?.minY).toBe(60);
    document.update('a', { showName: true });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(culler.index.boundsOf('a' as never)?.minY).toBeLessThan(60);
  });

  it('publishes no reach for a nested frame’s name by default', async () => {
    const { renderer, document, settle, culler } = setUp();
    document.create(
      frameObject('outer', { width: 400, height: 400, name: 'Outer' }),
      frameObject('inner', { parentId: 'outer', x: 20, y: 60, width: 200, height: 100 }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(culler.index.boundsOf('inner' as never)?.minY).toBe(60);
  });

  it('withdraws the reach when the frame goes', async () => {
    const { renderer, document, settle, culler } = setUp();
    document.create(frameObject('a', { name: 'Plan' }));
    renderer.enqueue(document.takeChanges());
    await settle();
    document.delete('a');
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(culler.index.size).toBe(0);
    renderer.destroy();
  });
});
