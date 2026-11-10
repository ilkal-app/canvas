import { describe, expect, it } from 'vitest';

import { bidiClassCases, reportFailures } from './__fixtures__/bidi-conformance.js';
import { lineLevels, resolveLevelsFromClasses, visualOrder } from './bidi-levels.js';
import type { ParagraphDirection } from './bidi-levels.js';

const DIRECTIONS: readonly [number, ParagraphDirection][] = [
  [1, 'auto'],
  [2, 'ltr'],
  [4, 'rtl'],
];

describe('Unicode 17 BidiTest conformance', () => {
  it('resolves every class sequence through L1 and L2 in each requested paragraph direction', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const entry of bidiClassCases()) {
      for (const [bit, direction] of DIRECTIONS) {
        if ((entry.directions & bit) === 0) continue;
        checked += 1;
        try {
          // BidiTest permits B only at the end; the entire sequence is one line.
          const resolved = resolveLevelsFromClasses(entry.classes, direction);
          const actualLevels = lineLevels(resolved.levels, entry.classes, resolved.level);
          expect(Array.from(actualLevels)).toEqual(entry.levels);
          expect(visualOrder(actualLevels)).toEqual(entry.order);
        } catch (error) {
          failures.push(`line ${String(entry.line)} (${direction}): ${String(error)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    reportFailures(failures, checked, 'BidiTest.txt');
  }, 600_000);
});
