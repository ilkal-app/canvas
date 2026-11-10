import { describe, expect, it, vi } from 'vitest';

import type { GpuBackend } from './gpu-backend.js';
import type { GpuTextureDescriptor } from './gpu-texture.js';
import { TransformTable } from './transform-table.js';

// Absolute placement is rounded once, exactly where ordinary instance records round it.
function fakeBackend(maxTextureSize = 8192) {
  return {
    capabilities: { maxTextureSize } as GpuBackend['capabilities'],
    createTexture: vi.fn((descriptor: GpuTextureDescriptor) => ({
      ...descriptor,
      destroy: vi.fn(),
    })),
    writeTexture: vi.fn<GpuBackend['writeTexture']>(),
  };
}

const PLACEMENT = { x: 16_777_217.125, y: -0, cos: Math.cos(0.371), sin: Math.sin(0.371) };

describe('TransformTable', () => {
  it('uploads the same placement bits as ordinary records, including signed zero', () => {
    const backend = fakeBackend();
    const write = vi.spyOn(backend, 'writeTexture');
    const table = new TransformTable(backend, 7);
    table.set(1, PLACEMENT);
    expect(table.flush()).toEqual({ uploadedBytes: 16, writes: 1 });
    expect(table.byteLength).toBe(128);
    const upload = write.mock.calls[0];
    expect(upload?.[0].format).toBe('rgba32float');
    const source = upload?.[1] as Float32Array;
    expect([...new Uint32Array(source.buffer, source.byteOffset, 4)]).toEqual([
      ...new Uint32Array(
        new Float32Array([PLACEMENT.x, PLACEMENT.y, PLACEMENT.cos, PLACEMENT.sin]).buffer,
      ),
    ]);
    expect(upload?.[2]).toEqual({ x: 1, y: 0, width: 1, height: 1 });
    expect(table.flush()).toEqual({ uploadedBytes: 0, writes: 0 });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('splits dirty spans at texture rows without dropping adjacent objects', () => {
    const backend = fakeBackend(4);
    const write = vi.spyOn(backend, 'writeTexture');
    const table = new TransformTable(backend, 7);
    table.set(3, PLACEMENT);
    table.set(4, { ...PLACEMENT, x: 99 });
    expect(table.flush()).toEqual({ uploadedBytes: 32, writes: 2 });
    expect(write.mock.calls.map((call) => call[2])).toEqual([
      { x: 3, y: 0, width: 1, height: 1 },
      { x: 0, y: 1, width: 1, height: 1 },
    ]);
    expect((write.mock.calls[1]?.[1] as Float32Array)[0]).toBe(99);
  });

  it('reserves zero for fallback and rejects overflow before writing', () => {
    const backend = fakeBackend(4);
    expect(() => new TransformTable(backend, 16)).toThrow(/capacity/);
    const table = new TransformTable(backend, 7);
    expect(() => {
      table.set(0, PLACEMENT);
    }).toThrow(/index/);
    expect(() => {
      table.set(8, PLACEMENT);
    }).toThrow(/index/);
    expect(() => {
      table.set(1.5, PLACEMENT);
    }).toThrow(/index/);
    table.flush();
    expect(backend.writeTexture).not.toHaveBeenCalled();
  });

  it('invalidates a placement witness on each edit while reads and uploads preserve it', () => {
    const backend = fakeBackend();
    const table = new TransformTable(backend, 2);
    expect(table.revision).toBe(0);
    table.set(1, PLACEMENT);
    const first = table.revision;
    expect(first).toBeGreaterThan(0);
    expect(table.read(1)).toEqual({
      x: Math.fround(PLACEMENT.x),
      y: -0,
      cos: Math.fround(PLACEMENT.cos),
      sin: Math.fround(PLACEMENT.sin),
    });
    table.flush();
    expect(table.revision).toBe(first);
    table.set(1, { ...PLACEMENT, x: -129.125 });
    expect(table.revision).toBeGreaterThan(first);
    expect(table.read(1).x).toBe(-129.125);
    const second = table.revision;
    expect(() => table.read(0)).toThrow(/index/);
    expect(() => table.read(3)).toThrow(/index/);
    expect(() => table.read(1.5)).toThrow(/index/);
    expect(table.revision).toBe(second);
    const destroy = vi.spyOn(table.texture, 'destroy');
    table.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('translates every placement through texel 0 and uploads only that texel', () => {
    const backend = fakeBackend();
    const table = new TransformTable(backend, 3);
    table.set(1, { x: 10, y: 20, cos: 1, sin: 0 });
    table.set(3, { x: 0.1, y: -4, cos: 0, sin: 1 });
    table.flush();
    backend.writeTexture.mockClear();
    const revision = table.revision;
    table.setOffset(2.5, -1);
    expect(table.revision).toBe(revision + 1);
    expect(table.read(1)).toEqual({ x: 12.5, y: 19, cos: 1, sin: 0 });
    // As the shader adds them: float32 placement plus float32 offset, rounded to float32.
    expect(table.read(3).x).toBe(Math.fround(Math.fround(0.1) + 2.5));
    table.flush();
    expect(backend.writeTexture).toHaveBeenCalledTimes(1);
    expect(backend.writeTexture.mock.calls[0]?.[2]).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    table.setOffset(2.5, -1);
    expect(table.revision).toBe(revision + 1);
    table.setOffset(0, 0);
    expect(table.read(1)).toEqual({ x: 10, y: 20, cos: 1, sin: 0 });
  });
});
