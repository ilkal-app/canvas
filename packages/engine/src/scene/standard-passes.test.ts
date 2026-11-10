import { afterEach, describe, expect, it } from 'vitest';

import { meshJob } from '../paths/mesh-job.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { createStandardScenePasses } from './standard-passes.js';

const pools: WorkerPool[] = [];

afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

describe('createStandardScenePasses', () => {
  it('lists frame shadows, solid rectangles, frame outlines, layer composites, SDF shapes, images, paths, text, its vector companion, sticky author labels, then frame titles, with or without a fault sink and a cap', () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
    pools.push(pool);

    const bare = createStandardScenePasses({ jobs: pool });
    const full = createStandardScenePasses({
      jobs: pool,
      onFault: () => undefined,
      meshByteBudget: 1024,
    });

    expect(bare.map(({ name }) => name)).toEqual([
      'frame-shadow',
      'solid-rect',
      'rect-gradient',
      'rect-image',
      'rounded-rect',
      'rounded-rect-gradient',
      'frame-stroke',
      'layer-composite',
      'sdf-shape',
      'sdf-shape-gradient',
      'sdf-shape-image',
      'link-preview',
      'link-icon',
      'image',
      'image-border',
      'path',
      'path-gradient',
      'connector',
      'text',
      'textVector',
      'sticky-author',
      'link-card-body',
      'link-card-footer',
      'frame-title',
    ]);
    expect(full.map(({ name }) => name)).toEqual([
      'frame-shadow',
      'solid-rect',
      'rect-gradient',
      'rect-image',
      'rounded-rect',
      'rounded-rect-gradient',
      'frame-stroke',
      'layer-composite',
      'sdf-shape',
      'sdf-shape-gradient',
      'sdf-shape-image',
      'link-preview',
      'link-icon',
      'image',
      'image-border',
      'path',
      'path-gradient',
      'connector',
      'text',
      'textVector',
      'sticky-author',
      'link-card-body',
      'link-card-footer',
      'frame-title',
    ]);
  });
});
