import { describe, expect, it } from 'vitest';

import { EvictionMemory, REGENERATION_WINDOW_MS } from './eviction-memory.js';

describe('EvictionMemory', () => {
  it('counts an entry made again within the window of its eviction as a regeneration', () => {
    const memory = new EvictionMemory();
    memory.evicted('a', 1_000);
    memory.evicted('b', 1_000);
    expect(memory.made('a', 1_000 + REGENERATION_WINDOW_MS)).toBe(true);
    // Once counted, the entry is forgotten: making it again is new work.
    expect(memory.made('a', 1_000 + REGENERATION_WINDOW_MS)).toBe(false);
    expect(memory.made('c', 2_000)).toBe(false);
    expect(memory.regenerations).toBe(1);
  });

  it('forgets evictions older than the window, a sweep of the zoom', () => {
    const memory = new EvictionMemory();
    memory.evicted('a', 0);
    memory.evicted('b', 5_000);
    memory.prune(REGENERATION_WINDOW_MS + 1);
    expect(memory.size).toBe(1);
    expect(memory.made('a', REGENERATION_WINDOW_MS + 1)).toBe(false);
    expect(memory.made('b', REGENERATION_WINDOW_MS + 1)).toBe(true);
  });
});
