import { describe, expect, it, vi } from 'vitest';

import { frameObject, shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { RTree } from '../../spatial/r-tree.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';

import { createTextSetUp, textObject, CAMERA, STYLE } from './__fixtures__/text-objects.js';
import { TEXT_PASS } from './text-pass.js';

const TEXT = 'A\nB\nC\nD\nE\nF\nG\nH';

describe('shape label overflow culling', () => {
  it.each([0, Math.PI / 2])(
    'draws an initially offscreen shape label at rotation %s',
    async (rotation) => {
      const camera = { ...CAMERA, viewportWidthPx: 30, viewportHeightPx: 30 };
      const setup = createTextSetUp(camera);
      const shape = shapeObject('label', {
        x: rotation === 0 ? -35 : 90,
        y: rotation === 0 ? 80 : -35,
        width: 100,
        height: 10,
        rotation,
        label: { text: TEXT, runs: [{ length: TEXT.length, style: STYLE }] },
      });
      setup.document.create(shape);
      setup.renderer.changes.push(setup.document.takeChanges());
      await setup.settle();
      expect(setup.records().some((record) => (record[6] ?? 0) > 0)).toBe(true);
      const frame = setup.renderer.renderFrame({ timeMs: 300, camera });
      expect(frame.drawCalls).toBeGreaterThan(0);
      setup.renderer.destroy();
    },
  );
});

describe('shape label drawing bounds lifecycle', () => {
  it('updates moves and label changes, shrinks on removal, and clears on deletion', async () => {
    const culler = new SpatialCuller({ paddingFraction: 0 });
    const setup = createTextSetUp(CAMERA, true, true, { culler });
    const shape = shapeObject('label', {
      width: 100,
      height: 10,
      label: { text: TEXT, runs: [{ length: TEXT.length, style: STYLE }] },
    });
    setup.document.create(shape);
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const bounds = culler.index.boundsOf(shape.id);
    expect(bounds?.minY).toBeLessThan(-70);
    expect(bounds?.maxY).toBeGreaterThan(70);
    const revision = culler.index.drawingBoundsRevision;
    setup.renderer.renderFrame({ timeMs: 500, camera: CAMERA });
    expect(culler.index.drawingBoundsRevision).toBe(revision);
    setup.document.update(shape.id, { x: 100 });
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(culler.index.boundsOf(shape.id)?.minX).toBeCloseTo((bounds?.minX ?? 0) + 100);
    expect(culler.index.drawingBoundsRevision).toBe(revision);
    setup.document.update(shape.id, { label: { text: 'A', runs: [{ length: 1, style: STYLE }] } });
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(culler.index.boundsOf(shape.id)?.minY).toBeGreaterThan(-20);
    setup.document.update(shape.id, { label: null });
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(culler.index.boundsOf(shape.id)).toEqual({ minX: 100, minY: 0, maxX: 200, maxY: 10 });
    setup.document.delete(shape.id);
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(culler.index.size).toBe(0);
    setup.renderer.destroy();
  });

  it('splits an occluder over only the overflow when the asynchronous glyph bounds land', async () => {
    const setup = createTextSetUp(CAMERA, true, true, { passes: [SDF_SHAPE_PASS, TEXT_PASS] });
    setup.document.create(
      shapeObject('label', {
        x: 0,
        y: 100,
        width: 100,
        height: 10,
        z: 'a0',
        label: { text: TEXT, runs: [{ length: TEXT.length, style: STYLE }] },
      }),
      shapeObject('cover', { x: 0, y: 30, width: 100, height: 25, z: 'a1' }),
    );
    setup.renderer.enqueue(setup.document.takeChanges());
    const before = setup.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(before.segments).toBe(1);
    await setup.settle();
    expect(setup.renderer.renderFrame({ timeMs: 300, camera: CAMERA }).segments).toBe(2);
    setup.renderer.destroy();
  });
});

describe('shape label drawing bounds ownership', () => {
  it('clears overflow on a same-id replacement with text', async () => {
    const culler = new SpatialCuller();
    const setup = createTextSetUp(CAMERA, true, true, { culler });
    setup.document.create(
      shapeObject('label', {
        width: 100,
        height: 10,
        label: { text: TEXT, runs: [{ length: TEXT.length, style: STYLE }] },
      }),
    );
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const replacement = textObject('label', 'A');
    expect(culler.index.boundsOf(replacement.id)?.minY).toBeLessThan(-70);
    setup.document.update(replacement.id, replacement);
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(culler.index.boundsOf(replacement.id)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 25,
    });
    setup.renderer.destroy();
  });

  it('transforms overflow with a parent and shrinks it on renderer destruction', async () => {
    const culler = new SpatialCuller();
    const setup = createTextSetUp(CAMERA, true, true, { culler });
    const parent = frameObject('parent', { x: 0, y: 0, width: 200, height: 200 });
    const label = shapeObject('label', {
      parentId: parent.id,
      width: 100,
      height: 10,
      label: { text: TEXT, runs: [{ length: TEXT.length, style: STYLE }] },
    });
    setup.document.create(parent, label);
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const before = culler.index.boundsOf(label.id);
    setup.document.update(parent.id, { rotation: Math.PI / 2 });
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const rotated = culler.index.boundsOf(label.id);
    expect(rotated?.minX).toBeCloseTo(-(before?.maxY ?? 0));
    expect(rotated?.maxX).toBeCloseTo(-(before?.minY ?? 0));
    setup.document.update(label.id, { parentId: null });
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(culler.index.boundsOf(label.id)).toEqual(before);
    setup.renderer.destroy();
    expect(culler.index.boundsOf(label.id)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 10 });
  });
});

describe('shape label movement cost', () => {
  it('updates the R-tree once per moved labelled shape', async () => {
    const setup = createTextSetUp();
    const shape = shapeObject('label', {
      width: 100,
      height: 10,
      label: { text: TEXT, runs: [{ length: TEXT.length, style: STYLE }] },
    });
    setup.document.create(shape);
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const update = vi.spyOn(RTree.prototype, 'update');
    setup.document.update(shape.id, { x: 100 });
    setup.renderer.enqueue(setup.document.takeChanges());
    setup.renderer.renderFrame({ timeMs: 500, camera: CAMERA });
    expect(update.mock.calls.filter(([id]) => id === shape.id)).toHaveLength(1);
    update.mockRestore();
    setup.renderer.destroy();
  });
});
