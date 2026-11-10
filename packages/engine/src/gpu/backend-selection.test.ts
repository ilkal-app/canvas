import { describe, expect, it } from 'vitest';

import { backendAttemptOrder, selectGpuBackend } from './backend-selection.js';
import type { GpuBackendProbes } from './backend-selection.js';
import type { GpuBackend } from './gpu-backend.js';
import type { GpuBackendName } from './gpu-capabilities.js';

/**
 * A stand-in backend: selection only reads `capabilities.backendName`.
 *
 * @param backendName - The name the stand-in reports.
 * @returns The stand-in.
 */
function fakeBackend(backendName: GpuBackendName): GpuBackend {
  return { capabilities: { backendName } } as unknown as GpuBackend;
}

/**
 * Probes that record which backends were tried, in order.
 *
 * @param results - What each probe resolves to, or the error it rejects with.
 * @returns The probes and the list they record into.
 */
function recordingProbes(results: Record<GpuBackendName, GpuBackend | undefined | Error>): {
  probes: GpuBackendProbes;
  attempts: GpuBackendName[];
} {
  const attempts: GpuBackendName[] = [];
  const probe = (name: GpuBackendName) => () => {
    attempts.push(name);
    const result = results[name];
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { probes: { webgpu: probe('webgpu'), webgl2: probe('webgl2') }, attempts };
}

describe('backendAttemptOrder', () => {
  it('tries WebGPU first and WebGL2 second by default', () => {
    expect(backendAttemptOrder('webgpu')).toEqual(['webgpu', 'webgl2']);
  });

  it('tries WebGL2 first when it is preferred, still falling back to WebGPU', () => {
    expect(backendAttemptOrder('webgl2')).toEqual(['webgl2', 'webgpu']);
  });
});

describe('selectGpuBackend', () => {
  it('uses WebGPU when the browser has it and an adapter', async () => {
    const { probes, attempts } = recordingProbes({
      webgpu: fakeBackend('webgpu'),
      webgl2: fakeBackend('webgl2'),
    });
    const backend = await selectGpuBackend('webgpu', probes);
    expect(backend.capabilities.backendName).toBe('webgpu');
    expect(attempts).toEqual(['webgpu']);
  });

  it('falls back to WebGL2 when WebGPU is missing or has no adapter', async () => {
    const { probes, attempts } = recordingProbes({
      webgpu: undefined,
      webgl2: fakeBackend('webgl2'),
    });
    const backend = await selectGpuBackend('webgpu', probes);
    expect(backend.capabilities.backendName).toBe('webgl2');
    expect(attempts).toEqual(['webgpu', 'webgl2']);
  });

  it('falls back to WebGL2 when creating the WebGPU device fails', async () => {
    const { probes } = recordingProbes({
      webgpu: new Error('requestDevice rejected'),
      webgl2: fakeBackend('webgl2'),
    });
    const backend = await selectGpuBackend('webgpu', probes);
    expect(backend.capabilities.backendName).toBe('webgl2');
  });

  it('does not try WebGPU when WebGL2 is preferred and available', async () => {
    const { probes, attempts } = recordingProbes({
      webgpu: fakeBackend('webgpu'),
      webgl2: fakeBackend('webgl2'),
    });
    await selectGpuBackend('webgl2', probes);
    expect(attempts).toEqual(['webgl2']);
  });

  it('names every failure when no backend can be created', async () => {
    const { probes } = recordingProbes({
      webgpu: new Error('adapter lost'),
      webgl2: undefined,
    });
    await expect(selectGpuBackend('webgpu', probes)).rejects.toThrow(
      /webgpu: adapter lost; webgl2: unavailable/,
    );
  });
});
