import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { AllVisibleCuller } from './scene-culler.js';
import { DEFAULT_CHURN_BUDGET, type ChurnBudget } from './scene-renderer-options.js';
import { SceneRenderer } from './scene-renderer.js';

const COUNT = DEFAULT_CHURN_BUDGET.entriesPerFrame + 17;

function firstFrame(churnBudget?: false | ChurnBudget) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [FILLED_RECT_PASS],
    isZOrdered: false,
    ...(churnBudget === undefined ? {} : { churnBudget }),
  });
  const document = new FakeSceneDocument();
  for (let index = 0; index < COUNT; index += 1)
    document.create(shapeObject(`rect-${String(index)}`, { x: index * 12, width: 8 }));
  renderer.enqueue(document.takeChanges());
  const stats = renderer.renderFrame({
    timeMs: 0,
    camera: {
      x: -10,
      y: -10,
      zoom: 1,
      viewportWidthPx: COUNT * 12 + 20,
      viewportHeightPx: 100,
      dpr: 1,
    },
  });
  return { renderer, backend, stats };
}

describe('default scene admission budget', () => {
  // The budget is opt-in; on the m1 it raised the 50k-mobile p95 by a third.
  it('admits every visible rectangle and carries nothing by default', () => {
    const { renderer, backend, stats } = firstFrame();
    expect(backend.draws()[0]?.instanceCount).toBe(COUNT);
    expect(Reflect.get(stats, 'carriedAdmissions')).toBe(0);
    expect(renderer.hasPendingWork()).toBe(false);
    renderer.destroy();
  });

  it('admits everything and reports zero when disabled', () => {
    const { renderer, backend, stats } = firstFrame(false);
    expect(backend.draws()[0]?.instanceCount).toBe(COUNT);
    expect(Reflect.get(stats, 'carriedAdmissions')).toBe(0);
    expect(renderer.hasPendingWork()).toBe(false);
    renderer.destroy();
  });

  it('fills an empty options object from the exported default', () => {
    const { renderer, backend, stats } = firstFrame({});
    expect(backend.draws()[0]?.instanceCount).toBe(DEFAULT_CHURN_BUDGET.entriesPerFrame);
    expect(Reflect.get(stats, 'carriedAdmissions')).toBe(17);
    renderer.destroy();
  });

  it('fills a partial object from the exported default', () => {
    const { renderer, backend, stats } = firstFrame({ lodChangesPerFrame: 1 });
    expect(backend.draws()[0]?.instanceCount).toBe(DEFAULT_CHURN_BUDGET.entriesPerFrame);
    expect(Reflect.get(stats, 'carriedAdmissions')).toBe(17);
    renderer.destroy();
  });

  it('reports zero with a non-spatial culler', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [FILLED_RECT_PASS],
      culler: new AllVisibleCuller(),
    });
    const stats = renderer.renderFrame({
      timeMs: 0,
      camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 },
    });
    expect(Reflect.get(stats, 'carriedAdmissions')).toBe(0);
    renderer.destroy();
  });
});
