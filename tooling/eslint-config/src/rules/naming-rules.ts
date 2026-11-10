import type { Linter } from 'eslint';

import { CONFIG_FILES } from '../config/file-globs.js';

/** Prefixes that make a boolean read as a predicate (`isVisible`, `hasChildren`). */
const BOOLEAN_PREFIXES = ['is', 'has', 'can', 'should', 'did', 'was', 'will'];

type NameFormat = 'camelCase' | 'PascalCase' | 'UPPER_CASE';

/**
 * Builds the naming-convention options.
 *
 * @param isReactModule - Whether the options are for `.tsx` files, where functions and module
 *   constants may also be PascalCase, because React components are functions.
 * @returns The rule options, one object per selector.
 */
function createNamingOptions(isReactModule: boolean): unknown[] {
  const componentFormats: NameFormat[] = isReactModule ? ['PascalCase'] : [];
  return [
    { selector: 'default', format: ['camelCase'] },
    { selector: 'import', format: ['camelCase', 'PascalCase'] },
    { selector: 'typeLike', format: ['PascalCase'] },
    { selector: 'enumMember', format: ['PascalCase'] },
    { selector: 'function', format: ['camelCase', ...componentFormats] },
    // UPPER_SNAKE_CASE is for true compile-time constants, which live at module scope.
    {
      selector: 'variable',
      modifiers: ['const', 'global'],
      format: ['camelCase', 'UPPER_CASE', ...componentFormats],
    },
    // Destructuring keeps the source's names (for example environment variables).
    { selector: 'variable', modifiers: ['destructured'], format: null },
    // Object literal keys often mirror an external schema (rule names, AST node types).
    { selector: 'objectLiteralProperty', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
    {
      selector: ['objectLiteralProperty', 'objectLiteralMethod', 'typeProperty'],
      modifiers: ['requiresQuotes'],
      format: null,
    },
    {
      selector: ['variable', 'parameter', 'classProperty', 'typeProperty', 'accessor'],
      types: ['boolean'],
      format: ['PascalCase'],
      prefix: BOOLEAN_PREFIXES,
    },
  ];
}

/**
 * Creates the naming rules: types `PascalCase`; functions, variables and
 * properties `camelCase`; module constants may be `UPPER_SNAKE_CASE`; booleans read as
 * predicates.
 *
 * @returns Flat config objects for naming linting.
 */
export function createNamingRules(): Linter.Config[] {
  return [
    {
      name: 'canvas/naming',
      files: ['**/*.ts'],
      // The boolean selector needs type information, which tool configs are linted without.
      ignores: CONFIG_FILES,
      rules: { '@typescript-eslint/naming-convention': ['error', ...createNamingOptions(false)] },
    },
    {
      name: 'canvas/naming/react',
      files: ['**/*.tsx'],
      rules: { '@typescript-eslint/naming-convention': ['error', ...createNamingOptions(true)] },
    },
  ];
}
