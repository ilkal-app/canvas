import { describe, expect, it } from 'vitest';

import { assertBufferByteLength, assertBufferWrite } from './gpu-buffer.js';

describe('assertBufferByteLength', () => {
  it('accepts a positive multiple of 4 bytes', () => {
    expect(() => {
      assertBufferByteLength(64);
    }).not.toThrow();
  });

  it.each([0, -4, 6, 4.5])('rejects %s bytes', (byteLength) => {
    expect(() => {
      assertBufferByteLength(byteLength);
    }).toThrow(RangeError);
  });
});

describe('assertBufferWrite', () => {
  it('accepts a dirty-range write that ends exactly at the buffer end', () => {
    expect(() => {
      assertBufferWrite(64, 48, 16);
    }).not.toThrow();
  });

  it('rejects a write that overruns the buffer', () => {
    expect(() => {
      assertBufferWrite(64, 56, 16);
    }).toThrow(/overruns/);
  });

  it('rejects an offset or a length that is not 4-byte aligned, as WebGPU would', () => {
    expect(() => {
      assertBufferWrite(64, 2, 4);
    }).toThrow(/aligned/);
    expect(() => {
      assertBufferWrite(64, 0, 6);
    }).toThrow(/aligned/);
  });
});
