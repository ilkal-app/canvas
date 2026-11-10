import type { Linter } from 'eslint';
import jsdoc from 'eslint-plugin-jsdoc';

import { TYPESCRIPT_FILES } from '../config/file-globs.js';

/** TSDoc tags TypeDoc understands that plain JSDoc does not define. */
const TSDOC_TAGS = [
  'remarks',
  'typeParam',
  'defaultValue',
  'packageDocumentation',
  'privateRemarks',
];

/**
 * Creates the TSDoc rules: every exported function, class, interface,
 * type alias and const carries a comment with a description, its parameters, its return and
 * what it throws.
 *
 * @returns Flat config objects for documentation linting.
 */
export function createJsdocRules(): Linter.Config[] {
  return [
    {
      ...jsdoc.configs['flat/recommended-typescript-error'],
      name: 'canvas/jsdoc/recommended',
      files: TYPESCRIPT_FILES,
    },
    {
      name: 'canvas/jsdoc',
      files: TYPESCRIPT_FILES,
      rules: {
        'jsdoc/require-jsdoc': [
          'error',
          {
            publicOnly: true,
            require: {
              ArrowFunctionExpression: true,
              ClassDeclaration: true,
              FunctionDeclaration: true,
              FunctionExpression: true,
            },
            contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'VariableDeclaration'],
          },
        ],
        'jsdoc/require-description': 'error',
        'jsdoc/require-param': 'error',
        'jsdoc/require-returns': 'error',
        // A function body with a `throw` documents it: `@throws {RangeError} When …`.
        'jsdoc/require-throws': 'error',
        'jsdoc/check-param-names': 'error',
        'jsdoc/no-undefined-types': 'error',
        'jsdoc/check-tag-names': ['error', { definedTags: TSDOC_TAGS }],
        // TSDoc style: one blank line between the description and the first tag.
        'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
      },
    },
  ];
}
