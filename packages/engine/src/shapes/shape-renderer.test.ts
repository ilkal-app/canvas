import { describe, expect, it } from 'vitest';

import { createRecordingGpu } from './__fixtures__/recording-gpu-backend.js';
import { SHAPE_CAMERA_BYTE_LENGTH } from './shape-camera.js';
import { SHAPE_INSTANCE_BYTES, SHAPE_INSTANCE_FLOATS } from './shape-instance-layout.js';
import { SHAPE_PIPELINE_DESCRIPTOR, SHAPE_UNCLIPPED_QUAD_VERTICES } from './shape-pipeline.js';
import { ShapeRenderer } from './shape-renderer.js';

function setUp(instanceCount = 8) {
  const gpu = createRecordingGpu();
  const renderer = new ShapeRenderer(gpu.backend);
  const cameraBuffer = gpu.backend.createBuffer({
    usage: 'uniform',
    byteLength: SHAPE_CAMERA_BYTE_LENGTH,
  });
  const instances = gpu.backend.createBuffer({
    usage: 'vertex',
    byteLength: instanceCount * SHAPE_INSTANCE_BYTES,
  });
  const camera = renderer.createCameraBindGroup(cameraBuffer);
  gpu.calls.length = 0;
  return { ...gpu, renderer, camera, cameraBuffer, instances };
}

describe('ShapeRenderer', () => {
  it('creates the shape pipeline, an unclipped clip table and the unit quad, before any pass', () => {
    const { backend, calls } = createRecordingGpu();
    new ShapeRenderer(backend);
    expect(calls.map(({ name }) => name)).toEqual([
      'createRenderPipeline',
      'createTexture',
      'createBuffer',
      'writeBuffer',
    ]);
    expect(calls[0]?.args[0]).toBe(SHAPE_PIPELINE_DESCRIPTOR);
    expect(calls[1]?.args[0]).toMatchObject({ format: 'rgba32float', width: 4, height: 1 });
    // Each corner is followed by its clip index, 0: nothing clips a shape drawn outside a scene;
    // its layer transparency, 0: nothing fades it; then four corner radii of 0:
    // a shape draws its record's one radius.
    expect(calls[3]?.args[2]).toEqual(Array.from(SHAPE_UNCLIPPED_QUAD_VERTICES));
    expect(SHAPE_UNCLIPPED_QUAD_VERTICES).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('draws an instance range as six quad vertices from its first record', () => {
    const { renderer, pass, calls, camera, instances } = setUp();
    renderer.draw(pass, camera, instances, { first: 3, count: 4 });
    expect(calls.map(({ name }) => name)).toEqual([
      'setPipeline',
      'setBindGroup',
      'setVertexBuffer',
      'setVertexBuffer',
      'draw',
    ]);
    expect(calls[0]?.args[0]).toBe(renderer.pipeline);
    expect(calls[1]?.args[0]).toBe(camera);
    expect(calls[3]?.args.slice(0, 2)).toEqual([1, instances]);
    expect(calls[4]?.args).toEqual([6, 4, 0, 3]);
  });

  it('records nothing for an empty range', () => {
    const { renderer, pass, calls, camera, instances } = setUp();
    renderer.draw(pass, camera, instances, { first: 5, count: 0 });
    expect(calls).toEqual([]);
  });

  it('rejects a range that runs past the instance buffer or is not whole records', () => {
    const { renderer, pass, camera, instances } = setUp(4);
    expect(() => {
      renderer.draw(pass, camera, instances, { first: 2, count: 3 });
    }).toThrow(RangeError);
    expect(() => {
      renderer.draw(pass, camera, instances, { first: -1, count: 1 });
    }).toThrow(RangeError);
    expect(() => {
      renderer.draw(pass, camera, instances, { first: 0, count: 1.5 });
    }).toThrow(RangeError);
  });

  it('binds a camera uniform buffer at binding 0 and rejects one too small for the block', () => {
    const { backend, renderer, cameraBuffer, calls } = setUp();
    const camera = renderer.createCameraBindGroup(cameraBuffer);
    expect(camera.entries).toEqual([
      { binding: 0, buffer: cameraBuffer },
      { binding: 5, texture: expect.objectContaining({ format: 'rgba32float' }) as unknown },
    ]);
    expect(calls.at(-1)?.name).toBe('createBindGroup');
    const small = backend.createBuffer({ usage: 'uniform', byteLength: 16 });
    expect(() => renderer.createCameraBindGroup(small)).toThrow(RangeError);
  });

  it('prepares records in a caller-provided slice', () => {
    const { renderer } = setUp();
    const target = new Float32Array(2 * SHAPE_INSTANCE_FLOATS);
    renderer.prepare(
      [
        {
          kind: 'ellipse',
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          color: [0, 0, 0, 1],
          radius: 0,
          softness: 0,
        },
      ],
      target,
      1,
    );
    expect(Array.from(target.subarray(SHAPE_INSTANCE_FLOATS))).toEqual([
      1, 2, 3, 4, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('frees its pipeline, quad buffer and clip table on destroy', () => {
    const { renderer, calls } = setUp();
    renderer.destroy();
    expect(calls.map(({ name }) => name).sort()).toEqual([
      'destroyBuffer',
      'destroyPipeline',
      'destroyTexture',
    ]);
  });
});
