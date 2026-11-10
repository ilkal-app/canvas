// Acceptance: the standard scene renders vector text directly after atlas text.
import { expect, it } from 'vitest';

import { meshJob } from '../paths/mesh-job.js';
import { TEXT_PASS_NAME } from '../text/scene/text-pass.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { createStandardScenePasses } from './standard-passes.js';

it('registers the text vector companion immediately after the text pass', () => {
  const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
  try {
    const passes = createStandardScenePasses({ jobs: pool });
    const names = passes.map(({ name }) => name);
    const textIndex = names.indexOf(TEXT_PASS_NAME);
    expect(textIndex).toBeGreaterThanOrEqual(0);
    expect(names[textIndex + 1]).toBe('textVector');
    expect(names.filter((name) => name === 'textVector')).toHaveLength(1);
  } finally {
    pool.terminate();
  }
});
