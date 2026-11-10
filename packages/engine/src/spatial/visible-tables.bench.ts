import { bench, describe } from 'vitest';

import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { DEFAULT_CHURN_BUDGET } from '../scene/scene-renderer-options.js';
import { Scene } from '../scene/scene.js';

import { benchSize } from './__fixtures__/bench-size.js';
import { SpatialCuller } from './spatial-culler.js';

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const PARTIAL_A = { minX: 0, maxX: COUNT * 10, minY: -5, maxY: 20 };
const PARTIAL_B = { ...PARTIAL_A, minX: COUNT * 5, maxX: COUNT * 15 };
const WHOLE = { ...PARTIAL_A, minX: -100, maxX: COUNT * 20 + 100 };

function loaded(rangeCache: 'tables' | 'reference', entriesPerFrame = Infinity) {
  const scene = new Scene([FILLED_RECT_PASS], { instanceBuffer: { initialCapacity: COUNT } });
  const document = new FakeSceneDocument();
  const options = { paddingFraction: 0, rangeCache, entriesPerFrame };
  const culler = new SpatialCuller(options);
  for (let index = 0; index < COUNT; index++)
    document.create(shapeObject(`s${String(index)}`, { x: index * 20 }));
  const changes = document.takeChanges();
  scene.apply(changes);
  culler.applyChanges(changes);
  return { scene, culler };
}

for (const entriesPerFrame of [
  Infinity,
  (DEFAULT_CHURN_BUDGET as unknown as { entriesPerFrame: number }).entriesPerFrame,
]) {
  describe(`admission ${String(entriesPerFrame)}, ${String(COUNT)} objects`, () => {
    const churn = loaded('tables', entriesPerFrame);
    churn.culler.cull(churn.scene, PARTIAL_A);
    let isAtA = true;
    bench('one large partial-view churn cull', () => {
      churn.culler.cull(churn.scene, isAtA ? PARTIAL_B : PARTIAL_A);
      isAtA = !isAtA;
    });
  });
}

for (const rangeCache of ['tables', 'reference'] as const) {
  describe(`visible ranges ${rangeCache}, ${String(COUNT)} objects`, () => {
    const churn = loaded(rangeCache);
    churn.culler.cull(churn.scene, PARTIAL_A);
    let isAtA = true;
    bench('large partial-view churn, thousands enter and leave', () => {
      churn.culler.cull(churn.scene, isAtA ? PARTIAL_B : PARTIAL_A);
      isAtA = !isAtA;
    });

    const entering = loaded(rangeCache);
    bench('enter all-visible from partial view', () => {
      entering.culler.cull(entering.scene, PARTIAL_A);
      entering.culler.cull(entering.scene, WHOLE);
    });

    const leaving = loaded(rangeCache);
    bench('leave all-visible for partial view', () => {
      leaving.culler.cull(leaving.scene, WHOLE);
      leaving.culler.cull(leaving.scene, PARTIAL_A);
    });
  });
}
