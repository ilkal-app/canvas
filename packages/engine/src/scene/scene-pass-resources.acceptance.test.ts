import { describe, expect, it, vi } from 'vitest';

import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { CameraUniform } from './camera-uniform.js';
import { emptyFrameStats } from './frame-context.js';
import { InstanceBuffer } from './instance-buffer.js';
import { ScenePassResources } from './scene-pass-resources.js';
import type { ScenePass } from './scene-pass.js';

function fixture(options: { hasVariants: boolean; hasSlots: boolean }) {
  const backend = new FakeGpuBackend();
  const pageSlots = [1, 3, 5];
  const shader = SDF_SHAPE_PASS.pipelineSpec.shader;
  const pass: ScenePass = {
    ...SDF_SHAPE_PASS,
    name: 'acceptance pages',
    pipelineSpec: {
      ...SDF_SHAPE_PASS.pipelineSpec,
      pageBindings: [{ binding: 1, kind: 'load-texture' }],
      ...(options.hasVariants
        ? { pageShaderVariants: [1, 2, 4].map((pageSlots) => ({ pageSlots, shader })) }
        : {}),
    },
    pageEntries: (page) => [
      {
        binding: 1,
        texture:
          textures[page] ??
          textures[0] ??
          backend.createTexture({ format: 'r8unorm', width: 1, height: 1 }),
      },
    ],
    ...(options.hasSlots ? { pageSlotsOf: (page: number) => pageSlots[page] ?? 5 } : {}),
  };
  const textures = pageSlots.map((page) =>
    backend.createTexture({
      format: 'r8unorm',
      width: 1,
      height: 1,
      label: `page ${String(page)}`,
    }),
  );
  const bindGroups = vi.spyOn(backend, 'createBindGroup');
  const resources = new ScenePassResources(
    backend,
    pass,
    new InstanceBuffer(pass.layout),
    new CameraUniform(backend),
  );
  return { backend, bindGroups, resources, pageSlots };
}

describe('ScenePassResources page shader selection', () => {
  it('chooses the first covering variant and creates each page group for the selected pipeline', () => {
    const { backend, bindGroups, resources } = fixture({ hasVariants: true, hasSlots: true });
    const renderPass = backend.beginRenderPass({});
    const stats = emptyFrameStats();
    for (const page of [0, 1, 2, 1])
      resources.draw(renderPass, [{ start: 0, count: 1 }], stats, page);
    renderPass.end();
    expect(
      backend.calls.filter((call) => call.method === 'setPipeline').map((call) => call.label),
    ).toEqual([
      'acceptance pages 1 pages',
      'acceptance pages 4 pages',
      'acceptance pages',
      'acceptance pages 4 pages',
    ]);
    expect(bindGroups).toHaveBeenCalledTimes(3);
    const selected = bindGroups.mock.calls.map(([descriptor]) => descriptor.pipeline);
    expect(selected).toEqual([backend.pipelines[1], backend.pipelines[3], backend.pipelines[0]]);
    const destroy = backend.pipelines.map((pipeline) => vi.spyOn(pipeline, 'destroy'));
    resources.destroy();
    for (const call of destroy) expect(call).toHaveBeenCalledOnce();
  });

  it('rebuilds a page bind group when its slot count selects another pipeline', () => {
    const { backend, bindGroups, resources, pageSlots } = fixture({
      hasVariants: true,
      hasSlots: true,
    });
    const renderPass = backend.beginRenderPass({});
    const draw = (): void => {
      resources.draw(renderPass, [{ start: 0, count: 1 }], emptyFrameStats(), 0);
    };
    draw();
    pageSlots[0] = 3;
    draw();
    pageSlots[0] = 1;
    draw();
    renderPass.end();
    expect(bindGroups.mock.calls.map(([descriptor]) => descriptor.pipeline)).toEqual([
      backend.pipelines[1],
      backend.pipelines[3],
    ]);
    expect(bindGroups).toHaveBeenCalledTimes(2);
    resources.destroy();
  });

  it.each([
    { hasVariants: false, hasSlots: true },
    { hasVariants: true, hasSlots: false },
  ])('uses the pass shader with variants=$hasVariants and pageSlotsOf=$hasSlots', (options) => {
    const { backend, resources } = fixture(options);
    const renderPass = backend.beginRenderPass({});
    resources.draw(renderPass, [{ start: 0, count: 1 }], emptyFrameStats(), 1);
    renderPass.end();
    expect(backend.calls.filter((call) => call.method === 'setPipeline').at(-1)).toEqual({
      method: 'setPipeline',
      label: 'acceptance pages',
    });
    resources.destroy();
  });
});
