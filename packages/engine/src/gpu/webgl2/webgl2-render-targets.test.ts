import { describe, expect, it } from 'vitest';

import { ResourceTracker } from '../resource-tracker.js';

import { WebGl2RenderTargets } from './webgl2-render-targets.js';

// Render target lifecycle, the shared scratch and the blit resolve on a fake context.
// The pixels, and the row flip they need, are tested on a real GPU by the golden scene
// `render-target-composite`.

/** GL enums the targets use, as names so recorded calls read plainly. */
const ENUMS = {
  TEXTURE_2D: 'TEXTURE_2D',
  RGBA8: 'RGBA8',
  DEPTH24_STENCIL8: 'DEPTH24_STENCIL8',
  TEXTURE_MIN_FILTER: 'TEXTURE_MIN_FILTER',
  TEXTURE_MAG_FILTER: 'TEXTURE_MAG_FILTER',
  NEAREST: 'NEAREST',
  FRAMEBUFFER: 'FRAMEBUFFER',
  READ_FRAMEBUFFER: 'READ_FRAMEBUFFER',
  DRAW_FRAMEBUFFER: 'DRAW_FRAMEBUFFER',
  RENDERBUFFER: 'RENDERBUFFER',
  COLOR_ATTACHMENT0: 'COLOR_ATTACHMENT0',
  DEPTH_STENCIL_ATTACHMENT: 'DEPTH_STENCIL_ATTACHMENT',
  COLOR_BUFFER_BIT: 'COLOR_BUFFER_BIT',
};

/**
 * A context that records every call; each created object is a fresh labelled object.
 *
 * @returns The context and its calls.
 */
function fakeContext() {
  const calls: unknown[][] = [];
  let next = 0;
  const create = (kind: string) => () => {
    next += 1;
    const object = { kind, id: next };
    calls.push([`create${kind}`, object]);
    return object;
  };
  const known: Record<string, unknown> = {
    ...ENUMS,
    createTexture: create('Texture'),
    createFramebuffer: create('Framebuffer'),
    createRenderbuffer: create('Renderbuffer'),
  };
  const gl = new Proxy(known, {
    get(target, property: string) {
      if (property in target) return target[property];
      return (...args: unknown[]) => {
        calls.push([property, ...args]);
      };
    },
  }) as unknown as WebGL2RenderingContext;
  const named = (name: string) => calls.filter(([call]) => call === name);
  return { gl, calls, named };
}

describe('WebGl2RenderTargets', () => {
  it('makes an RGBA8 texture with its own framebuffer for the resolve', () => {
    const { gl, named } = fakeContext();
    const tracker = new ResourceTracker();
    const targets = new WebGl2RenderTargets(gl, 4, tracker);
    const target = targets.create({ width: 32, height: 16 }, 64);
    expect([target.width, target.height, target.texture.format]).toEqual([32, 16, 'rgba8unorm']);
    expect(named('texStorage2D')).toEqual([['texStorage2D', 'TEXTURE_2D', 1, 'RGBA8', 32, 16]]);
    expect(named('framebufferTexture2D')).toEqual([
      [
        'framebufferTexture2D',
        'FRAMEBUFFER',
        'COLOR_ATTACHMENT0',
        'TEXTURE_2D',
        target.texture.handle,
        0,
      ],
    ]);
    expect(() => targets.create({ width: 8, height: 65 }, 64)).toThrow(RangeError);
    expect(targets.liveCount).toBe(1);
  });

  it('draws into a multisampled scratch sized to the largest target, at its corner', () => {
    const { gl, named } = fakeContext();
    const targets = new WebGl2RenderTargets(gl, 4, new ResourceTracker());
    const small = targets.create({ width: 32, height: 16 }, 64);
    targets.create({ width: 8, height: 40 }, 64);
    expect(targets.bind(small).height).toBe(16);
    expect(targets.scratchSize).toEqual({ width: 32, height: 40 });
    expect(named('renderbufferStorageMultisample')).toEqual([
      ['renderbufferStorageMultisample', 'RENDERBUFFER', 4, 'RGBA8', 32, 40],
      ['renderbufferStorageMultisample', 'RENDERBUFFER', 4, 'DEPTH24_STENCIL8', 32, 40],
    ]);
    expect(named('framebufferRenderbuffer').map((call) => call[2])).toEqual([
      'COLOR_ATTACHMENT0',
      'DEPTH_STENCIL_ATTACHMENT',
    ]);
    expect(named('viewport')).toEqual([['viewport', 0, 0, 32, 16]]);
    targets.bind(small);
    expect(named('renderbufferStorageMultisample')).toHaveLength(2);
  });

  it('uses single-sample renderbuffers when the canvas has no MSAA', () => {
    const { gl, named } = fakeContext();
    const targets = new WebGl2RenderTargets(gl, 1, new ResourceTracker());
    targets.bind(targets.create({ width: 8, height: 8 }, 64));
    expect(named('renderbufferStorageMultisample').map((call) => call[2])).toEqual([0, 0]);
  });

  it('resolves the corner into the target with blitFramebuffer, then discards the scratch', () => {
    const { gl, calls } = fakeContext();
    const targets = new WebGl2RenderTargets(gl, 4, new ResourceTracker());
    const target = targets.create({ width: 32, height: 16 }, 64);
    const pass = targets.bind(target);
    const scratch = calls.filter(([call]) => call === 'createFramebuffer').at(-1)?.[1];
    const before = calls.length;
    pass.resolve();
    expect(calls.slice(before)).toEqual([
      ['bindFramebuffer', 'READ_FRAMEBUFFER', scratch],
      ['bindFramebuffer', 'DRAW_FRAMEBUFFER', target.framebuffer],
      ['colorMask', true, true, true, true],
      ['blitFramebuffer', 0, 0, 32, 16, 0, 0, 32, 16, 'COLOR_BUFFER_BIT', 'NEAREST'],
      [
        'invalidateFramebuffer',
        'READ_FRAMEBUFFER',
        ['COLOR_ATTACHMENT0', 'DEPTH_STENCIL_ATTACHMENT'],
      ],
      ['bindFramebuffer', 'FRAMEBUFFER', null],
    ]);
  });

  it('reallocates the scratch when the largest target changes, and frees it with the last', () => {
    const { gl, named } = fakeContext();
    const targets = new WebGl2RenderTargets(gl, 4, new ResourceTracker());
    const small = targets.create({ width: 8, height: 8 }, 64);
    targets.bind(small);
    const large = targets.create({ width: 16, height: 16 }, 64);
    targets.bind(large);
    expect(targets.scratchSize).toEqual({ width: 16, height: 16 });
    expect(named('deleteRenderbuffer')).toHaveLength(2);
    large.destroy();
    large.destroy();
    expect(large.isDestroyed).toBe(true);
    targets.bind(small);
    expect(targets.scratchSize).toEqual({ width: 8, height: 8 });
    small.destroy();
    expect(targets.scratchSize).toBeUndefined();
    expect(named('deleteRenderbuffer')).toHaveLength(6);
    // Two target framebuffers and three scratch framebuffers.
    expect(named('deleteFramebuffer')).toHaveLength(5);
    expect(named('deleteTexture')).toHaveLength(2);
  });

  it('rejects a pass to a destroyed target or another backend’s target', () => {
    const { gl } = fakeContext();
    const targets = new WebGl2RenderTargets(gl, 4, new ResourceTracker());
    const other = new WebGl2RenderTargets(fakeContext().gl, 4, new ResourceTracker());
    expect(() => targets.bind(other.create({ width: 8, height: 8 }, 64))).toThrow(Error);
    const target = targets.create({ width: 8, height: 8 }, 64);
    target.destroy();
    expect(() => targets.bind(target)).toThrow(Error);
  });

  it('is destroyed with the backend through its tracker, and on a context loss', () => {
    const { gl, named } = fakeContext();
    const tracker = new ResourceTracker();
    const targets = new WebGl2RenderTargets(gl, 4, tracker);
    const first = targets.create({ width: 8, height: 8 }, 64);
    targets.bind(first);
    tracker.destroyAll();
    expect(first.isDestroyed).toBe(true);
    expect(targets.liveCount).toBe(0);
    expect(targets.scratchSize).toBeUndefined();
    expect(tracker.liveCount).toBe(0);
    const second = targets.create({ width: 4, height: 4 }, 64);
    targets.destroyAll();
    expect(second.isDestroyed).toBe(true);
    expect(named('deleteTexture').length).toBeGreaterThanOrEqual(2);
    expect(tracker.liveCount).toBe(0);
  });
});
