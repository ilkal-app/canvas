import { join } from 'node:path';

import type { Linter } from 'eslint';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';

import { CONFIG_FILES, PLAYWRIGHT_SETUP_FILES } from '../config/file-globs.js';

/**
 * Creates the import rules: a fixed import order, no cycles, named exports only.
 *
 * @param rootDir - Absolute path of the repository root, where the resolver finds tsconfigs.
 * @returns Flat config objects for import linting.
 */
export function createImportRules(rootDir: string): Linter.Config[] {
  return [
    {
      name: 'canvas/imports',
      plugins: { 'import-x': importX },
      settings: {
        'import-x/internal-regex': '^@canvas/',
        'import-x/resolver-next': [
          createTypeScriptImportResolver({
            // The solution tsconfig; the resolver follows its project references.
            project: join(rootDir, 'tsconfig.json'),
            // Resolve workspace packages to src/, like tsc and Vitest do.
            conditionNames: ['development', 'types', 'import', 'default'],
          }),
        ],
      },
      rules: {
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        'import-x/no-cycle': 'error',
        'import-x/no-default-export': 'error',
      },
    },
    {
      name: 'canvas/imports/config-files',
      files: CONFIG_FILES,
      rules: { 'import-x/no-default-export': 'off' },
    },
    {
      // Playwright loads a `globalSetup` or `globalTeardown` file's default export.
      name: 'canvas/imports/playwright-setup-files',
      files: PLAYWRIGHT_SETUP_FILES,
      rules: { 'import-x/no-default-export': 'off' },
    },
  ];
}
