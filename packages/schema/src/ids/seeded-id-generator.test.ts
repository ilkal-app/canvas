import { describe, expect, it } from 'vitest';

import { objectIdSchema } from './object-id.js';
import { createSeededIdGenerator } from './seeded-id-generator.js';

describe('createSeededIdGenerator', () => {
  it('produces the same sequence for the same seed', () => {
    const first = createSeededIdGenerator(42);
    const second = createSeededIdGenerator(42);
    const firstIds = [first(), first(), first()];
    expect([second(), second(), second()]).toEqual(firstIds);
  });

  it('produces different sequences for different seeds', () => {
    expect(createSeededIdGenerator(1)()).not.toBe(createSeededIdGenerator(2)());
  });

  it('produces ids that pass the object id schema and do not repeat within a long run', () => {
    const nextId = createSeededIdGenerator(7);
    const ids = Array.from({ length: 10_000 }, () => nextId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(0, 100)) {
      expect(objectIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('pins the first id of seed 0 so the sequence cannot drift unnoticed', () => {
    expect(createSeededIdGenerator(0)()).toMatchInlineSnapshot(`"RAOJdinpdlPG5auq"`);
  });

  it('rejects a seed that is not a safe integer', () => {
    for (const seed of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => createSeededIdGenerator(seed)).toThrow(RangeError);
    }
  });
});
