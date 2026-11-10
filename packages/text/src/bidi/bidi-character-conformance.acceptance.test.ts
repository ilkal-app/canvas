import { describe, expect, it } from 'vitest';

import { bidiCharacterCases, reportFailures } from './__fixtures__/bidi-conformance.js';
import { bidiClassOf } from './bidi-class.js';
import { lineLevels, resolveParagraphLevels, visualOrder } from './bidi-levels.js';
import type { ParagraphDirection } from './bidi-levels.js';

const DIRECTIONS: readonly ParagraphDirection[] = ['ltr', 'rtl', 'auto'];

describe('Unicode 17 BidiCharacterTest conformance', () => {
  it('resolves every codepoint sequence through paragraph, line, and visual order rules', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const entry of bidiCharacterCases()) {
      checked += 1;
      try {
        const text = String.fromCodePoint(...entry.codepoints);
        const direction = DIRECTIONS[entry.direction];
        if (direction === undefined)
          throw new Error(`invalid direction ${String(entry.direction)}`);
        const resolved = resolveParagraphLevels(text, direction);
        expect(resolved.level).toBe(entry.paragraphLevel);
        const classes = entry.codepoints.map(bidiClassOf);
        const originalLevels: number[] = [];
        let offset = 0;
        for (const codepoint of entry.codepoints) {
          originalLevels.push(resolved.levels[offset] ?? -1);
          offset += codepoint > 0xffff ? 2 : 1;
        }
        expect(offset).toBe(resolved.levels.length);
        const actualLevels = lineLevels(originalLevels, classes, resolved.level);
        expect(Array.from(actualLevels)).toEqual(entry.levels);
        expect(visualOrder(actualLevels)).toEqual(entry.order);
      } catch (error) {
        failures.push(`line ${String(entry.line)}: ${String(error)}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    reportFailures(failures, checked, 'BidiCharacterTest.txt');
  }, 600_000);
});
