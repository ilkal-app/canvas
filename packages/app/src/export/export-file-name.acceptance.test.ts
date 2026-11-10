// Written before the export code. CONTRACT: portable names identify scope, scale
// and format. Deliberately not asserted: menu animation, background colour, PNG bytes, PDF output.
import { describe, expect, it } from 'vitest';

import { exportFileName } from './export-file-name.js';

const nameOf = exportFileName;

describe('exportFileName', () => {
  it.each([
    ['Plan', 'board', 'png', 1, 'Plan.png'],
    ['Plan', 'selection', 'png', 2, 'Plan (selection)@2x.png'],
    [' a/b:c ', 'board', 'pdf', 1, 'a-b-c.pdf'],
    ['  ', 'board', 'png', 1, 'Board.png'],
    ['a\\b*c?d"e<f>g|h', 'board', 'png', 1, 'a-b-c-d-e-f-g-h.png'],
    ['A\u0001B\u001fC\u007fD', 'board', 'pdf', 1, 'A-B-C-D.pdf'],
  ] as const)('names %s at %sx as %s', (title, kind, format, scale, expected) => {
    expect(nameOf(title, kind, format, scale)).toBe(expected);
  });
});
