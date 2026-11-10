import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '../camera/camera.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { Scene } from '../scene/scene.js';

import { SpatialCuller } from './spatial-culler.js';

const CORNER: WorldBounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
const WHOLE: WorldBounds = { minX: -10, minY: -10, maxX: 110, maxY: 30 };

function fixture(entriesPerFrame: number) {
  const document = new FakeSceneDocument();
  const scene = new Scene([FILLED_RECT_PASS]);
  const culler = new SpatialCuller({ entriesPerFrame, paddingFraction: 0, maxGapRecords: 0 });
  for (let index = 0; index < 5; index += 1)
    document.create(shapeObject(`s${String(index)}`, { x: index * 20, width: 10 }));
  const changes = document.takeChanges();
  scene.apply(changes);
  culler.applyChanges(changes);
  return { scene, culler };
}

describe('range deltas through whole-board zooms', () => {
  it('keeps consecutive deltas when a finite budget has admitted every indexed member', () => {
    const { scene, culler } = fixture(2);
    let lastRevision: number | undefined;
    for (const viewport of [CORNER, WHOLE, WHOLE, WHOLE, CORNER, CORNER, CORNER]) {
      culler.cull(scene, viewport);
      const delta = culler.rangeChangeOf(FILLED_RECT_PASS.name);
      if (viewport === WHOLE) expect(delta).toBeDefined();
      if (lastRevision !== undefined && delta?.revision !== lastRevision)
        expect(delta?.previousRevision).toBe(lastRevision);
      lastRevision = delta?.revision;
    }
    expect(culler.hasPendingAdmissions()).toBe(false);
  });

  it('allows the existing whole-buffer behavior without a finite budget', () => {
    const { scene, culler } = fixture(Infinity);
    culler.cull(scene, CORNER);
    culler.cull(scene, WHOLE);
    expect(culler.hasPendingAdmissions()).toBe(false);
    expect(culler.rangeChangeOf(FILLED_RECT_PASS.name)).toBeUndefined();
  });
});
