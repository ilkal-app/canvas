import { describe, expect, it } from 'vitest';

import { cmap, faceBytes, subsetter } from './__fixtures__/cjk-slice-contract.js';

describe('HarfBuzz font subsetter', () => {
  it('maps only requested characters present in the source face', async () => {
    const source = faceBytes('notosanssc', 400);
    const cutter = await subsetter();
    expect(cmap(cutter.subset(source, [0x4e00]))).toEqual([0x4e00]);
    expect(cmap(cutter.subset(source, [0x4e00, 0x10fffd]))).toEqual([0x4e00]);
  });
});
