import type { Linter } from 'eslint';

import { TEST_FILES } from '../config/file-globs.js';

/** The longest a file may be, in lines. */
const MAX_FILE_LINES = 400;

/** The longest a function may be, in lines. */
const MAX_FUNCTION_LINES = 80;

/**
 * Creates the size limits: files of at most 400 lines and functions of
 * at most 80 lines. Tests are exempt from the function limit, since a `describe` block holds
 * many cases.
 *
 * @returns Flat config objects for size linting.
 */
export function createSizeRules(): Linter.Config[] {
  return [
    {
      name: 'canvas/size',
      rules: {
        'max-lines': ['error', { max: MAX_FILE_LINES }],
        'max-lines-per-function': ['error', { max: MAX_FUNCTION_LINES }],
      },
    },
    {
      name: 'canvas/size/tests',
      files: TEST_FILES,
      rules: { 'max-lines-per-function': 'off' },
    },
  ];
}
