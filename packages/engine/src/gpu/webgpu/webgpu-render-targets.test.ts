import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebGpuRenderTargets } from './webgpu-render-targets.js';

// Render target lifecycle and the shared scratch on a fake device. The pixels are
// tested on a real GPU by the golden scene `render-target-composite`.

const USAGE = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 };

interface FakeTexture {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly format: GPUTextureFormat;
  readonly sampleCount: number;
  readonly usage: number;
  isDestroyed: boolean;
}

/**
 * A device whose textures record their descriptor and whether they were destroyed.
 *
 * @returns The device and every texture it made.
 */
function fakeDevice() {
  const textures: FakeTexture[] = [];
  const device = {
    createTexture(descriptor: GPUTextureDescriptor) {
      const { width, height } = descriptor.size as GPUExtent3DDict;
      const texture = {
        label: descriptor.label ?? '',
        width,
        height: height ?? 1,
        format: descriptor.format,
        sampleCount: descriptor.sampleCount ?? 1,
        usage: descriptor.usage,
        isDestroyed: false,
        createView: () => ({ of: texture }),
        destroy: () => {
          texture.isDestroyed = true;
        },
      };
      textures.push(texture);
      return texture;
    },
  } as unknown as GPUDevice;
  const live = (label: string) =>
    textures.filter((texture) => texture.label === label && !texture.isDestroyed);
  return { device, textures, live };
}

describe('WebGpuRenderTargets', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUTextureUsage', USAGE);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes a sampleable target in the canvas format that reads as rgba8unorm', () => {
    const { device, textures } = fakeDevice();
    const targets = new WebGpuRenderTargets(device, 'bgra8unorm', 4);
    const target = targets.create({ width: 32, height: 16 }, 64);
    expect([target.width, target.height, target.texture.format]).toEqual([32, 16, 'rgba8unorm']);
    expect(textures[0]).toMatchObject({
      format: 'bgra8unorm',
      sampleCount: 1,
      usage: USAGE.TEXTURE_BINDING | USAGE.COPY_DST,
    });
    expect(() => targets.create({ width: 65, height: 8 }, 64)).toThrow(RangeError);
    expect(targets.liveCount).toBe(1);
  });

  it('draws a multisampled pass into a shared scratch with discarded stores, then copies', () => {
    const { device, live } = fakeDevice();
    const targets = new WebGpuRenderTargets(device, 'bgra8unorm', 4);
    const small = targets.create({ width: 32, height: 16 }, 64);
    targets.create({ width: 8, height: 40 }, 64);
    const pass = targets.beginPass(small, [0, 0, 0, 0]);
    expect(targets.scratchSize).toEqual({ width: 32, height: 40 });
    const [color] = live('render target scratch colour');
    const [resolved] = live('render target scratch resolve');
    const [stencil] = live('render target scratch stencil');
    expect(color).toMatchObject({ width: 32, height: 40, sampleCount: 4, format: 'bgra8unorm' });
    expect(resolved).toMatchObject({ sampleCount: 1, usage: USAGE.RENDER_ATTACHMENT | 1 });
    expect(stencil).toMatchObject({ sampleCount: 4, format: 'stencil8' });
    const [attachment] = pass.descriptor.colorAttachments as GPURenderPassColorAttachment[];
    expect(attachment).toEqual({
      view: { of: color },
      resolveTarget: { of: resolved },
      loadOp: 'clear',
      storeOp: 'discard',
      clearValue: [0, 0, 0, 0],
    });
    expect(pass.descriptor.depthStencilAttachment).toEqual({
      view: { of: stencil },
      stencilLoadOp: 'clear',
      stencilStoreOp: 'discard',
      stencilClearValue: 0,
    });
    const copyTextureToTexture = vi.fn();
    pass.land({ copyTextureToTexture } as unknown as GPUCommandEncoder);
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: resolved },
      { texture: small.texture.handle },
      { width: 32, height: 16 },
    );
  });

  it('keeps and copies the colour itself without MSAA', () => {
    const { device, live } = fakeDevice();
    const targets = new WebGpuRenderTargets(device, 'rgba8unorm', 1);
    const target = targets.create({ width: 8, height: 8 }, 64);
    const pass = targets.beginPass(target, [1, 0, 0, 1]);
    const [color] = live('render target scratch colour');
    expect(color).toMatchObject({ sampleCount: 1, usage: USAGE.RENDER_ATTACHMENT | 1 });
    expect(live('render target scratch resolve')).toEqual([]);
    const [attachment] = pass.descriptor.colorAttachments as GPURenderPassColorAttachment[];
    expect(attachment).toEqual({
      view: { of: color },
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: [1, 0, 0, 1],
    });
    const copyTextureToTexture = vi.fn();
    pass.land({ copyTextureToTexture } as unknown as GPUCommandEncoder);
    expect(copyTextureToTexture.mock.calls[0]?.[0]).toEqual({ texture: color });
  });

  it('reuses the scratch until the largest target changes, and retires it only after submit', () => {
    const { device, live, textures } = fakeDevice();
    const targets = new WebGpuRenderTargets(device, 'bgra8unorm', 4);
    const small = targets.create({ width: 8, height: 8 }, 64);
    targets.beginPass(small, [0, 0, 0, 0]);
    targets.beginPass(small, [0, 0, 0, 0]);
    expect(textures.filter(({ label }) => label.startsWith('render target scratch'))).toHaveLength(
      3,
    );
    const large = targets.create({ width: 16, height: 16 }, 64);
    targets.beginPass(large, [0, 0, 0, 0]);
    expect(targets.scratchSize).toEqual({ width: 16, height: 16 });
    // The first scratch may still be used by commands recorded before the submit.
    expect(textures.filter(({ isDestroyed }) => isDestroyed)).toEqual([]);
    targets.afterSubmit();
    expect(textures.filter(({ isDestroyed }) => isDestroyed)).toHaveLength(3);
    large.destroy();
    targets.beginPass(small, [0, 0, 0, 0]);
    expect(targets.scratchSize).toEqual({ width: 8, height: 8 });
    targets.afterSubmit();
    expect(live('render target scratch colour')).toHaveLength(1);
  });

  it('frees a target once, and the scratch with the last target', () => {
    const { device, live } = fakeDevice();
    const targets = new WebGpuRenderTargets(device, 'bgra8unorm', 4);
    const target = targets.create({ width: 8, height: 8 }, 64);
    targets.beginPass(target, [0, 0, 0, 0]);
    target.destroy();
    target.destroy();
    expect(target.isDestroyed).toBe(true);
    expect(live('render target')).toEqual([]);
    expect(targets.scratchSize).toBeUndefined();
    expect(targets.liveCount).toBe(0);
    targets.afterSubmit();
    expect(live('render target scratch colour')).toEqual([]);
  });

  it('rejects a pass to a destroyed target or another backend’s target', () => {
    const { device } = fakeDevice();
    const targets = new WebGpuRenderTargets(device, 'bgra8unorm', 4);
    const other = new WebGpuRenderTargets(fakeDevice().device, 'bgra8unorm', 4);
    const foreign = other.create({ width: 8, height: 8 }, 64);
    expect(() => targets.beginPass(foreign, [0, 0, 0, 0])).toThrow(Error);
    const target = targets.create({ width: 8, height: 8 }, 64);
    target.destroy();
    expect(() => targets.beginPass(target, [0, 0, 0, 0])).toThrow(Error);
    const lookalike = { width: 8, height: 8, texture: target.texture, destroy: () => undefined };
    expect(() => targets.beginPass(lookalike, [0, 0, 0, 0])).toThrow(Error);
  });

  it('destroys every target and the scratch on a device loss or with the backend', () => {
    const { device, textures } = fakeDevice();
    const targets = new WebGpuRenderTargets(device, 'bgra8unorm', 4);
    const first = targets.create({ width: 8, height: 8 }, 64);
    const second = targets.create({ width: 4, height: 4 }, 64);
    targets.beginPass(first, [0, 0, 0, 0]);
    targets.destroyAll();
    expect([first.isDestroyed, second.isDestroyed]).toEqual([true, true]);
    expect(textures.every(({ isDestroyed }) => isDestroyed)).toBe(true);
    expect(targets.liveCount).toBe(0);
  });
});
