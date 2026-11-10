import { describe, expect, it } from 'vitest';

import { echoJob } from './echo-job.js';

describe('echoJob', () => {
  it('returns its request and transfers the bytes back', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    const outcome = await echoJob({ message: 'ping', bytes });

    expect(outcome.response).toEqual({ message: 'ping', bytes });
    expect(outcome.transfer).toEqual([bytes]);
  });
});
