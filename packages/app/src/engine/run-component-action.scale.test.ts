import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { mountComponentBoard } from './__fixtures__/mounted-component-board.js';

describe('setScale', () => {
  it("sets an instance's content scale, growing its box, and 1 removes it", () => {
    const { run, instance } = mountComponentBoard();
    const id = 'inst' as ObjectId;
    const { width, height } = instance();
    expect(run({ type: 'component', command: 'setScale', id, scale: 2 })).toBe(true);
    expect(instance()).toMatchObject({ scale: 2, width: width * 2, height: height * 2 });
    expect(run({ type: 'component', command: 'setScale', id, scale: 1 })).toBe(true);
    expect(instance().scale).toBeUndefined();
    expect(instance()).toMatchObject({ width, height });
  });

  it('changes nothing for an object that is not an instance', () => {
    const { run, store } = mountComponentBoard();
    const id = 'main' as ObjectId;
    const before = store.get(id);
    run({ type: 'component', command: 'setScale', id, scale: 2 });
    expect(store.get(id)).toEqual(before);
  });
});
