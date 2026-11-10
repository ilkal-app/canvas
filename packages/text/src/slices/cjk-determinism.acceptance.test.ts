import { describe, expect, it } from 'vitest';

import { faceBytes, slices, subsetter } from './__fixtures__/cjk-slice-contract.js';

describe('CJK slice build determinism', () => {
  it('returns byte-identical files on repeated builds', async () => {
    const cutter = await subsetter();
    const source = faceBytes('notosanssc', 400);
    const first = slices.buildCjkSlices(cutter, 'Noto Sans SC', source);
    const second = slices.buildCjkSlices(cutter, 'Noto Sans SC', source);
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [id, bytes] of first) expect(second.get(id)).toEqual(bytes);
  }, 60_000);
});
