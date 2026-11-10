import { describe, expect, it } from 'vitest';

import { ClipboardMemory } from './clipboard-memory.js';

const FLAVOURS = new Map([['text/plain', 'kept']]);

describe('ClipboardMemory', () => {
  it('offers nothing before a copy', () => {
    expect(new ClipboardMemory().itemsFor(true)).toBeUndefined();
  });

  it('offers a copy the system clipboard does not hold, before reading the system', () => {
    const memory = new ClipboardMemory();
    memory.remember(FLAVOURS, false);
    expect(memory.itemsFor(false)).toEqual([{ kind: 'string', type: 'text/plain', data: 'kept' }]);
  });

  it('leaves a copy the system holds to the system, unless reading the system failed', () => {
    const memory = new ClipboardMemory();
    memory.remember(FLAVOURS, true);
    expect(memory.itemsFor(false)).toBeUndefined();
    expect(memory.itemsFor(true)).toHaveLength(1);
  });
});
