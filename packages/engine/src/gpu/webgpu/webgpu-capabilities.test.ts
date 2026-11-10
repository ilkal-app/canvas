import { describe, expect, it } from 'vitest';

import { resolveWebGpuCapabilities } from './webgpu-capabilities.js';

const APPLE_ADAPTER = {
  maxTextureDimension2D: 16384,
  features: new Set(['timestamp-query', 'shader-f16']),
  info: { vendor: 'apple', architecture: 'metal-3', description: '', isFallbackAdapter: false },
  sampleCount: 4,
} as const;

describe('resolveWebGpuCapabilities', () => {
  it('reports the texture limit, timestamps and a name built from vendor and architecture', () => {
    expect(resolveWebGpuCapabilities(APPLE_ADAPTER)).toEqual({
      backendName: 'webgpu',
      maxTextureSize: 16384,
      hasTimestampQuery: true,
      sampleCount: 4,
      adapterName: 'apple metal-3',
      isSoftwareAdapter: false,
    });
  });

  it('prefers the adapter description when the browser gives one', () => {
    const adapter = {
      ...APPLE_ADAPTER,
      info: { ...APPLE_ADAPTER.info, description: 'Apple M1 Max' },
    };
    expect(resolveWebGpuCapabilities(adapter).adapterName).toBe('Apple M1 Max');
  });

  it('reports no timestamps when the device lacks timestamp-query', () => {
    const adapter = { ...APPLE_ADAPTER, features: new Set<string>() };
    expect(resolveWebGpuCapabilities(adapter).hasTimestampQuery).toBe(false);
  });

  it('flags a fallback adapter as software', () => {
    const adapter = { ...APPLE_ADAPTER, info: { ...APPLE_ADAPTER.info, isFallbackAdapter: true } };
    expect(resolveWebGpuCapabilities(adapter).isSoftwareAdapter).toBe(true);
  });

  it('flags a SwiftShader adapter as software even when not marked fallback', () => {
    const adapter = {
      ...APPLE_ADAPTER,
      info: { vendor: 'google', architecture: 'swiftshader', description: '' },
    };
    expect(resolveWebGpuCapabilities(adapter).isSoftwareAdapter).toBe(true);
  });
});
