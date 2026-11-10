import { describe, expect, it } from 'vitest';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { AllVisibleCuller } from './scene-culler.js';
import type { SceneCuller } from './scene-culler.js';
import { Scene } from './scene.js';

const VIEWPORT = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const culler: SceneCuller = new AllVisibleCuller();

describe('AllVisibleCuller', () => {
  it('reports every record of every pass as visible, far off-screen ones included', () => {
    const scene = new Scene([FILLED_RECT_PASS]);
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b', { x: 1e6 }), shapeObject('c'));
    scene.apply(document.takeChanges());
    expect(culler.cull(scene, VIEWPORT)).toEqual(
      new Map([['solid-rect', [{ start: 0, count: 3 }]]]),
    );
  });

  it('reports no ranges for a pass with no records', () => {
    const scene = new Scene([FILLED_RECT_PASS]);
    expect(culler.cull(scene, VIEWPORT)).toEqual(new Map());
  });
});
