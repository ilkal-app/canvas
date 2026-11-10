import type { Linter } from 'eslint';
import { globalIgnores } from 'eslint/config';

import { createBoundaryRules } from '../boundaries/boundary-rules.js';
import { createConsoleRules } from '../rules/console-rules.js';
import { createImportRules } from '../rules/import-rules.js';
import { createJsdocRules } from '../rules/jsdoc-rules.js';
import { createNamingRules } from '../rules/naming-rules.js';
import { createSizeRules } from '../rules/size-rules.js';
import { createTypeScriptRules } from '../rules/typescript-rules.js';

/** Options for {@link createEslintConfig}. */
export interface EslintConfigOptions {
  /**
   * Absolute path of the repository root: the directory holding `eslint.config.js`, which
   * anchors tsconfig lookup and the dependency-direction zones.
   */
  readonly rootDir: string;
}

/** Build output, reports, generated docs and the engine's generated shader modules: never linted. */
const GENERATED_PATHS = [
  '**/dist/',
  '**/coverage/',
  '**/.turbo/',
  'docs/api/',
  'packages/engine/src/gpu/shaders/*.generated.ts',
];

/** The eslint-config test's fixture repo, which breaks the rules on purpose. */
const LINT_FIXTURES = ['tooling/eslint-config/src/**/__fixtures__/'];

/**
 * The MX benchmark's frozen tools and inputs: kept byte-identical to the ones a run
 * measured with (SHA256SUMS), so never linted or rewritten.
 */
const FROZEN_PATHS = ['tooling/mx-bench/tools/', 'tooling/mx-bench/inputs/'];

/**
 * Creates the canvas monorepo's ESLint flat config. The root `eslint.config.js` is the only
 * caller in the repo; the eslint-config test calls it on a fixture repo.
 *
 * @param options - Where the repository root is.
 * @returns The flat config array, in the order ESLint applies it.
 */
export function createEslintConfig(options: EslintConfigOptions): Linter.Config[] {
  const { rootDir } = options;
  return [
    globalIgnores([...GENERATED_PATHS, ...LINT_FIXTURES, ...FROZEN_PATHS], 'canvas/ignores'),
    {
      name: 'canvas/linter-options',
      linterOptions: { reportUnusedDisableDirectives: 'error' },
    },
    ...createTypeScriptRules(rootDir),
    ...createImportRules(rootDir),
    ...createJsdocRules(),
    ...createNamingRules(),
    ...createSizeRules(),
    ...createConsoleRules(),
    ...createBoundaryRules(rootDir),
  ];
}
