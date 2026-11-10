import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import {
  CAMERA_UNIFORM_BYTE_LENGTH,
  CameraUniform,
  cameraUniformValues,
} from './camera-uniform.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

describe('cameraUniformValues', () => {
  it('holds the clip map, then the world size of one device pixel, then padding', () => {
    const values = cameraUniformValues({ ...CAMERA, x: 10, zoom: 2, dpr: 2 });
    const expected = [0.02, -0.04, -1.2, 1, 0.25, 0.5, 0, 0];
    expect(values).toHaveLength(expected.length);
    for (const [index, value] of expected.entries()) expect(values[index]).toBeCloseTo(value, 12);
  });
});

describe('CameraUniform', () => {
  it('writes the clip map and the device pixel on its first update', () => {
    const backend = new FakeGpuBackend();
    const uniform = new CameraUniform(backend);
    expect(uniform.update(CAMERA)).toBe(true);
    expect(backend.writes()).toEqual([
      { method: 'writeBuffer', label: 'camera', byteOffset: 0, byteLength: 32 },
    ]);
    expect(uniform.buffer.byteLength).toBe(CAMERA_UNIFORM_BYTE_LENGTH);
    expect(CAMERA_UNIFORM_BYTE_LENGTH).toBe(32);
  });

  it('writes nothing while the camera stays the same', () => {
    const backend = new FakeGpuBackend();
    const uniform = new CameraUniform(backend);
    uniform.update(CAMERA);
    backend.resetCalls();
    expect(uniform.update({ ...CAMERA })).toBe(false);
    expect(backend.count('writeBuffer')).toBe(0);
  });

  it('writes again when the device pixel ratio changes, which resizes a device pixel', () => {
    const backend = new FakeGpuBackend();
    const uniform = new CameraUniform(backend);
    uniform.update(CAMERA);
    expect(uniform.update({ ...CAMERA, dpr: 2 })).toBe(true);
  });

  it('writes again after a pan or zoom', () => {
    const backend = new FakeGpuBackend();
    const uniform = new CameraUniform(backend);
    uniform.update(CAMERA);
    expect(uniform.update({ ...CAMERA, x: 5 })).toBe(true);
    expect(uniform.update({ ...CAMERA, x: 5, zoom: 2 })).toBe(true);
    expect(backend.count('writeBuffer')).toBe(3);
  });

  it('frees its buffer when destroyed', () => {
    const backend = new FakeGpuBackend();
    const uniform = new CameraUniform(backend);
    uniform.destroy();
    expect(backend.buffers[0]?.isDestroyed).toBe(true);
  });
});
