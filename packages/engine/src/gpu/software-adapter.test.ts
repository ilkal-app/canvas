import { describe, expect, it } from 'vitest';

import { isSoftwareAdapterName } from './software-adapter.js';

describe('isSoftwareAdapterName', () => {
  it.each([
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Microsoft Basic Render Driver',
  ])('recognises the software rasterizer %s', (name) => {
    expect(isSoftwareAdapterName(name)).toBe(true);
  });

  it.each([
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)',
    'apple metal-3',
    '',
  ])('accepts the hardware or hidden adapter "%s"', (name) => {
    expect(isSoftwareAdapterName(name)).toBe(false);
  });
});
