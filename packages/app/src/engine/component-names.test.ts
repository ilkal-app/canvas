import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { nextComponentName } from './component-names.js';

/**
 * A main, for its name and retirement only.
 *
 * @param name - Its name.
 * @param isRetired - Whether it was deleted.
 * @returns The main.
 */
function main(name: string, isRetired = false): BoardObject {
  return { id: name, type: 'component', name, retired: isRetired } as unknown as BoardObject;
}

describe('nextComponentName (ruling 2)', () => {
  it('names the first main "Component 1"', () => {
    expect(nextComponentName([])).toBe('Component 1');
  });

  it('counts the live mains on the board, not retired ones nor other objects', () => {
    const shape = { id: 's', type: 'shape' } as unknown as BoardObject;
    expect(nextComponentName([main('Card'), main('Old', true), shape])).toBe('Component 2');
  });

  it('skips a name a live main already has', () => {
    expect(nextComponentName([main('Component 2'), main('Component 3')])).toBe('Component 4');
    expect(nextComponentName([main('Component 1')])).toBe('Component 2');
  });

  it('may reuse the name of a retired main', () => {
    expect(nextComponentName([main('Card'), main('Component 2', true)])).toBe('Component 2');
  });
});
