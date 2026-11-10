import { describe, expect, it, vi } from 'vitest';

import type { GpuShaderSource } from '../gpu-shader.js';
import { ResourceTracker } from '../resource-tracker.js';

import { WebGl2Pipeline } from './webgl2-pipeline.js';
import { WebGl2ProgramCache } from './webgl2-program-cache.js';

// Pipelines drawn with one shader share one linked program.

/**
 * A shader source with a label and empty stages.
 *
 * @param label - Its label.
 * @returns The source.
 */
function shader(label: string): GpuShaderSource {
  return {
    label,
    wgsl: '',
    vertexEntryPoint: 'vs',
    fragmentEntryPoint: 'fs',
    glslVertex: '',
    glslFragment: '',
  };
}

/**
 * The context calls a program cache and a pipeline make, recorded; every program and vertex
 * array is a fresh object.
 *
 * @returns The fake context and its recorded deletions.
 */
function fakeContext() {
  const deletedPrograms: unknown[] = [];
  const deletedVertexArrays: unknown[] = [];
  const gl = {
    deleteProgram: (program: unknown) => deletedPrograms.push(program),
    createVertexArray: () => ({}),
    bindVertexArray: () => undefined,
    enableVertexAttribArray: () => undefined,
    vertexAttribDivisor: () => undefined,
    deleteVertexArray: (array: unknown) => deletedVertexArrays.push(array),
  } as unknown as WebGL2RenderingContext;
  return { gl, deletedPrograms, deletedVertexArrays };
}

describe('WebGl2ProgramCache', () => {
  it('links a shader once however many pipelines hold it, and deletes it with the last', () => {
    const { gl, deletedPrograms } = fakeContext();
    const link = vi.fn((...args: [WebGL2RenderingContext, GpuShaderSource]): WebGLProgram => ({
      label: args[1].label,
    }));
    const cache = new WebGl2ProgramCache(gl, link);
    const shape = shader('sdf-shape');
    const path = shader('path');
    const first = cache.acquire(shape);
    expect(cache.acquire(shape)).toBe(first);
    const other = cache.acquire(path);
    expect(other).not.toBe(first);
    expect(link.mock.calls.map((call) => call[1].label)).toEqual(['sdf-shape', 'path']);
    expect(cache.size).toBe(2);
    cache.release(shape);
    expect(deletedPrograms).toEqual([]);
    cache.release(shape);
    expect(deletedPrograms).toEqual([first]);
    cache.release(shape);
    expect(deletedPrograms).toEqual([first]);
    expect(cache.size).toBe(1);
    expect(cache.acquire(shape)).not.toBe(first);
    expect(link).toHaveBeenCalledTimes(3);
  });

  it('shares a program between pipelines of one shader, each destroy giving back one hold', () => {
    const { gl, deletedPrograms, deletedVertexArrays } = fakeContext();
    const link = vi.fn((...args: [WebGL2RenderingContext, GpuShaderSource]): WebGLProgram => ({
      label: args[1].label,
    }));
    const cache = new WebGl2ProgramCache(gl, link);
    const tracker = new ResourceTracker();
    const descriptor = {
      shader: shader('sdf-shape'),
      vertexBuffers: [],
      bindings: [],
      blend: 'premultiplied',
    } as const;
    const first = new WebGl2Pipeline(gl, descriptor, tracker, cache);
    const second = new WebGl2Pipeline(gl, { ...descriptor, label: 'frame stroke' }, tracker, cache);
    expect(link).toHaveBeenCalledTimes(1);
    first.destroy();
    first.destroy();
    expect(deletedPrograms).toHaveLength(0);
    expect(deletedVertexArrays).toHaveLength(1);
    tracker.destroyAll();
    expect(deletedPrograms).toHaveLength(1);
    expect(deletedVertexArrays).toHaveLength(2);
    second.destroy();
    expect(deletedPrograms).toHaveLength(1);
    expect(tracker.liveCount).toBe(0);
  });
});
