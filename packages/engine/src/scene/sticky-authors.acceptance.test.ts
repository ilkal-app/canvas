import { describe, expect, it, vi } from 'vitest';

import type { PrincipalId, StickyObject } from '@canvas/schema';

import { STICKY_AUTHOR_PASS_KIND, STICKY_AUTHOR_PASS_NAME, type StickyAuthors } from '../index.js';
import { FontLibrary } from '../text/font/font-library.js';
import { preloadLayoutShaper } from '../text/layout/layout-job.js';
import { addBundledFaces, CAMERA, textObject } from '../text/scene/__fixtures__/text-objects.js';
import { TEXT_PASS_NAME } from '../text/scene/text-pass.js';
import { createDefaultJobHandlers } from '../workers/default-job-handlers.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from './__fixtures__/scene-objects.js';
import { SceneRenderer } from './scene-renderer.js';
import { createStandardScenePasses } from './standard-passes.js';

function sticky(id: string, createdBy = 'user:ada', text = 'Own note'): StickyObject {
  return {
    ...textObject(id, text, { createdBy: createdBy as PrincipalId }),
    type: 'sticky',
    width: 200,
    height: 200,
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  };
}

const AUTHORS: StickyAuthors = {
  isShown: true,
  names: new Map([['user:ada', 'Ada']]),
  fallback: 'Former member',
};

function setUp() {
  const fonts = new FontLibrary();
  addBundledFaces(fonts);
  const jobs = new WorkerPool({ workerCount: 0, fallbackHandlers: createDefaultJobHandlers() });
  const submit = vi.spyOn(jobs, 'submit');
  const passes = createStandardScenePasses({ jobs });
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes,
    environment: { now: () => 0, requestFrame: () => undefined, text: { fonts, jobs } },
  });
  const document = new FakeSceneDocument();
  const layouts = () => submit.mock.calls.filter(([kind]) => kind === 'layout').length;
  const frame = async () => {
    await preloadLayoutShaper();
    for (let step = 0; step < 12; step += 1) {
      renderer.renderFrame({ timeMs: step * 16, camera: CAMERA });
      jobs.drainMainThread(1_000, () => step * 16);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { renderer, document, jobs, passes, layouts, frame };
}

describe('sticky author pass', () => {
  it('has its own instances after main text and scales in board world units', () => {
    const { renderer, passes, jobs } = setUp();
    const names = passes.map((pass) => pass.name);
    expect(names).toContain(STICKY_AUTHOR_PASS_NAME);
    expect(names.indexOf(STICKY_AUTHOR_PASS_NAME)).toBeGreaterThan(names.indexOf(TEXT_PASS_NAME));
    expect(STICKY_AUTHOR_PASS_KIND.name).toBe(STICKY_AUTHOR_PASS_NAME);
    expect(STICKY_AUTHOR_PASS_KIND.scaleOf({ ...CAMERA, zoom: 2, dpr: 3 })).toBe(6);
    expect(renderer.scene.instanceBufferOf(STICKY_AUTHOR_PASS_NAME)).not.toBe(
      renderer.scene.instanceBufferOf(TEXT_PASS_NAME),
    );
    jobs.terminate();
  });

  it('re-lays only changed labels when names or visibility change, leaving note text alone', async () => {
    const { renderer, document, jobs, layouts, frame } = setUp();
    document.create(sticky('one'), sticky('two', 'user:missing'));
    renderer.enqueue(document.takeChanges());
    await frame();
    const before = layouts();
    expect(renderer.setStickyAuthors(AUTHORS)).toBe(2);
    await frame();
    expect(layouts()).toBe(before + 2);
    expect(renderer.setStickyAuthors(AUTHORS)).toBe(0);
    await frame();
    expect(layouts()).toBe(before + 2);
    expect(
      renderer.setStickyAuthors({ ...AUTHORS, names: new Map([['user:ada', 'Ada Byron']]) }),
    ).toBe(1);
    await frame();
    expect(layouts()).toBe(before + 3);
    expect(renderer.setStickyAuthors({ ...AUTHORS, isShown: false })).toBe(2);
    await frame();
    expect(layouts()).toBe(before + 3);
    jobs.terminate();
  });

  it('uses the current authors for a sticky created or edited later', async () => {
    const { renderer, document, jobs, frame } = setUp();
    expect(renderer.setStickyAuthors(AUTHORS)).toBe(0);
    document.create(sticky('new'));
    renderer.enqueue(document.takeChanges());
    await frame();
    expect(renderer.scene.instanceBufferOf(STICKY_AUTHOR_PASS_NAME).recordCount).toBe(3);
    document.update('new', { createdBy: 'user:gone' as PrincipalId });
    renderer.enqueue(document.takeChanges());
    await frame();
    expect(renderer.scene.instanceBufferOf(STICKY_AUTHOR_PASS_NAME).recordCount).toBeGreaterThan(3);
    jobs.terminate();
  });
});
