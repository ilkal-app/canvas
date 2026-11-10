import { describe, expect, it, vi } from 'vitest';

import * as webgl2Capabilities from './webgl2-capabilities.js';

const { readRendererName, resolveWebGl2Capabilities } = webgl2Capabilities;

const METAL_RENDERER = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)';

describe('resolveWebGl2Capabilities', () => {
  it('reports the texture limit, the unmasked renderer and the timer extension', () => {
    expect(
      resolveWebGl2Capabilities({
        maxTextureSize: 16384,
        rendererName: METAL_RENDERER,
        hasTimerQuery: true,
        samples: 4,
      }),
    ).toEqual({
      backendName: 'webgl2',
      maxTextureSize: 16384,
      hasTimestampQuery: true,
      sampleCount: 4,
      adapterName: METAL_RENDERER,
      isSoftwareAdapter: false,
    });
  });

  it('flags SwiftShader as a software adapter', () => {
    const capabilities = resolveWebGl2Capabilities({
      maxTextureSize: 8192,
      rendererName:
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      hasTimerQuery: false,
      samples: 0,
    });
    expect(capabilities.isSoftwareAdapter).toBe(true);
    expect(capabilities.hasTimestampQuery).toBe(false);
  });

  it.each([
    [0, 1],
    [4, 4],
    [8, 8],
  ])('reports a drawing buffer with SAMPLES %i as %i samples per pixel', (samples, expected) => {
    const capabilities = resolveWebGl2Capabilities({
      maxTextureSize: 16384,
      rendererName: METAL_RENDERER,
      hasTimerQuery: true,
      samples,
    });
    expect(capabilities.sampleCount).toBe(expected);
  });
});

describe('readRendererName', () => {
  it.each(['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'Apple GPU'])(
    'uses an unmasked renderer directly without querying the deprecated extension: %s',
    (name) => {
      const renderer = vi.fn(() => name);
      const unmaskedRenderer = vi.fn(() => 'unused');
      expect(readRendererName({ renderer, unmaskedRenderer })).toBe(name);
      expect(renderer).toHaveBeenCalledOnce();
      expect(unmaskedRenderer).not.toHaveBeenCalled();
    },
  );

  it('uses the extension only for Chrome’s masked WebKit WebGL renderer', () => {
    const renderer = vi.fn(() => 'WebKit WebGL');
    const unmaskedRenderer = vi.fn(() => METAL_RENDERER);
    expect(readRendererName({ renderer, unmaskedRenderer })).toBe(METAL_RENDERER);
    expect(renderer).toHaveBeenCalledOnce();
    expect(unmaskedRenderer).toHaveBeenCalledOnce();
  });

  it('keeps the masked value when the extension gives no useful name', () => {
    for (const value of ['', undefined, 42]) {
      expect(
        readRendererName({ renderer: () => 'WebKit WebGL', unmaskedRenderer: () => value }),
      ).toBe('WebKit WebGL');
    }
  });

  it('returns an empty string for a non-string renderer without querying the extension', () => {
    const unmaskedRenderer = vi.fn(() => METAL_RENDERER);
    expect(readRendererName({ renderer: () => null, unmaskedRenderer })).toBe('');
    expect(unmaskedRenderer).not.toHaveBeenCalled();
  });
});
