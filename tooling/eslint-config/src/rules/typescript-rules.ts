import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';

import { CONFIG_FILES, JAVASCRIPT_FILES } from '../config/file-globs.js';

/**
 * Creates the typescript-eslint rules: `strictTypeChecked` plus `stylisticTypeChecked`, with
 * type information from each file's nearest tsconfig.json.
 *
 * @param rootDir - Absolute path of the repository root, where tsconfig lookup is anchored.
 * @returns Flat config objects for TypeScript linting.
 */
export function createTypeScriptRules(rootDir: string): Linter.Config[] {
  return [
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      name: 'canvas/typescript',
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: rootDir },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
      },
    },
    {
      // Tool configs and plain JavaScript sit outside every tsconfig, so they are linted
      // without type information.
      name: 'canvas/typescript/untyped-files',
      files: [...CONFIG_FILES, ...JAVASCRIPT_FILES],
      ...tseslint.configs.disableTypeChecked,
    },
  ];
}
