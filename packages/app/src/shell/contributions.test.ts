import { describe, expect, it } from 'vitest';

import { collectContributions } from './contributions.js';

const isNumber = (value: unknown): value is number => typeof value === 'number';

describe('collectContributions', () => {
  it('takes the named export of every module in path order', () => {
    const modules = { './b-thing.ts': { thing: 2 }, './a-thing.ts': { thing: 1, other: 'x' } };
    expect(collectContributions(modules, 'thing', isNumber)).toEqual([1, 2]);
  });

  it('returns nothing for an empty folder', () => {
    expect(collectContributions({}, 'thing', isNumber)).toEqual([]);
  });

  it('fails on a module without the export, naming the file', () => {
    expect(() => collectContributions({ './bad.ts': { thng: 1 } }, 'thing', isNumber)).toThrow(
      './bad.ts must export `thing`',
    );
  });

  it('fails on an export of the wrong shape', () => {
    expect(() => collectContributions({ './bad.ts': { thing: 'one' } }, 'thing', isNumber)).toThrow(
      /bad\.ts/,
    );
  });
});
