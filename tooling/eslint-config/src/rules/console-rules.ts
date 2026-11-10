import type { Linter } from 'eslint';

import { CONSOLE_ALLOWED_FILES } from '../config/file-globs.js';

/**
 * Creates the console rule: libraries never write to the console (test output stays
 * pristine); services and tooling may, since the console is how they report to an operator.
 *
 * @returns Flat config objects for console linting.
 */
export function createConsoleRules(): Linter.Config[] {
  return [
    { name: 'canvas/console', rules: { 'no-console': 'error' } },
    {
      name: 'canvas/console/allowed',
      files: CONSOLE_ALLOWED_FILES,
      rules: { 'no-console': 'off' },
    },
  ];
}
