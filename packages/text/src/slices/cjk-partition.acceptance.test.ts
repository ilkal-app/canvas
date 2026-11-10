import { describe, expect, it } from 'vitest';

import { FAMILIES, cmap, faceBytes, slices, subsetter } from './__fixtures__/cjk-slice-contract.js';

describe('CJK face partitions', () => {
  it.each([400, 700] as const)(
    'partitions every %i face and reports its sizes',
    async (weight) => {
      const cutter = await subsetter();
      for (const [family, folder] of FAMILIES) {
        const source = faceBytes(folder, weight);
        const original = cmap(source);
        const groups = slices.cjkSlices(family, original);
        const files = slices.buildCjkSlices(cutter, family, source);
        expect([...files.keys()]).toEqual([...groups.keys()]);
        const seen = new Set<number>();
        let largest = 0;
        for (const [id, bytes] of files) {
          expect(bytes.byteLength, `${family} ${String(weight)} ${id}`).toBeLessThan(2_000_000);
          largest = Math.max(largest, bytes.byteLength);
          const mapped = cmap(bytes);
          expect(mapped, `${family} ${String(weight)} ${id}`).toEqual(groups.get(id));
          for (const codepoint of mapped) {
            expect(
              seen.has(codepoint),
              `${family} ${String(weight)} duplicate U+${codepoint.toString(16)}`,
            ).toBe(false);
            seen.add(codepoint);
          }
        }
        expect([...seen].sort((a, b) => a - b)).toEqual(original);
        const base = files.get('base');
        expect(base).toBeDefined();
        if (base === undefined) throw new Error(`${family} base slice absent`);
        if (family === 'Noto Sans SC' && weight === 400)
          expect(base.byteLength).toBeLessThan(3_000_000);
        // eslint-disable-next-line no-console -- Requests a concise per-face size table.
        console.log(
          `${family} ${String(weight)}: total ${String(source.byteLength)}, base ${String(base.byteLength)}, largest ${String(largest)}`,
        );
      }
    },
    60_000,
  );
});
