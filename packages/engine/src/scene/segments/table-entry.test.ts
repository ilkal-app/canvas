import { describe, expect, it } from 'vitest';

import { tableEntry } from './table-entry.js';

describe('tableEntry', () => {
  it('reads an entry, and 0 past the end like a new table', () => {
    const table = Int32Array.of(-1, 7);
    expect(tableEntry(table, 0)).toBe(-1);
    expect(tableEntry(table, 1)).toBe(7);
    expect(tableEntry(table, 2)).toBe(0);
  });
});
