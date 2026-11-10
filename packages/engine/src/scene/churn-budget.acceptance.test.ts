import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { DEFAULT_CHURN_BUDGET } from './scene-renderer-options.js';
import { SceneRenderer } from './scene-renderer.js';

function rendererWith(count: number, churnBudget?: { entriesPerFrame?: number } | false) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [FILLED_RECT_PASS],
    isZOrdered: false,
    ...(churnBudget === undefined ? {} : { churnBudget }),
  });
  const document = new FakeSceneDocument();
  for (let index = 0; index < count; index++)
    document.create(shapeObject(`s${String(index)}`, { x: index * 20, width: 10 }));
  renderer.enqueue(document.takeChanges());
  return { renderer, backend };
}

function render(renderer: SceneRenderer, width: number, frame: number): void {
  renderer.renderFrame({
    timeMs: frame * 16,
    camera: { x: -10, y: -10, zoom: 1, viewportWidthPx: width, viewportHeightPx: 100, dpr: 1 },
  });
}

describe('renderer churn budget', () => {
  // Adapted: the budget is opt-in (m1 result), so `{}` takes the exported defaults.
  it('uses the exported default admission cap', () => {
    const count =
      (DEFAULT_CHURN_BUDGET as unknown as { entriesPerFrame: number }).entriesPerFrame + 1;
    const { renderer } = rendererWith(count, {});
    render(renderer, count * 20 + 100, 0);
    expect(renderer.hasPendingWork()).toBe(true);
    render(renderer, count * 20 + 100, 1);
    expect(renderer.hasPendingWork()).toBe(false);
  });

  it('keeps scheduling while custom admissions are pending', () => {
    const { renderer } = rendererWith(5, { entriesPerFrame: 2 });
    render(renderer, 200, 0);
    expect(renderer.hasPendingWork()).toBe(true);
    render(renderer, 200, 1);
    expect(renderer.hasPendingWork()).toBe(true);
    render(renderer, 200, 2);
    expect(renderer.hasPendingWork()).toBe(false);
  });

  it('leaves admission unbounded by default', () => {
    const { renderer, backend } = rendererWith(5);
    render(renderer, 200, 0);
    expect(backend.draws()[0]?.instanceCount).toBe(5);
    expect(renderer.hasPendingWork()).toBe(false);
  });

  it('makes admission unbounded when churnBudget is false', () => {
    const { renderer, backend } = rendererWith(5, false);
    render(renderer, 200, 0);
    expect(backend.draws()[0]?.instanceCount).toBe(5);
    expect(renderer.hasPendingWork()).toBe(false);
  });
});
