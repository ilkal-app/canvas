import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import { createEslintConfig } from './create-eslint-config.js';

/**
 * A miniature copy of the repo layout (`packages/document`, `packages/schema`,
 * `packages/engine`) so path-based rules see the fixtures as files of `packages/document`.
 */
const FIXTURE_ROOT = fileURLToPath(new URL('./__fixtures__/repo', import.meta.url));
const VALID_MODULE = 'packages/document/src/valid-module.ts';
const INVALID_MODULE = 'packages/document/src/invalid-module.ts';

// Type-aware linting starts a TypeScript project service on first use, which takes seconds.
const LINT_TIMEOUT_MS = 60_000;

describe('createEslintConfig on packages/document fixtures', () => {
  const eslint = new ESLint({
    cwd: FIXTURE_ROOT,
    overrideConfigFile: true,
    overrideConfig: createEslintConfig({ rootDir: FIXTURE_ROOT }),
  });
  let invalidMessages: Linter.LintMessage[] = [];

  async function lintFixture(relativePath: string): Promise<Linter.LintMessage[]> {
    const [result] = await eslint.lintFiles([relativePath]);
    return result?.messages ?? [];
  }

  beforeAll(async () => {
    invalidMessages = await lintFixture(INVALID_MODULE);
  }, LINT_TIMEOUT_MS);

  it(
    'accepts a documented module that imports only an allowed package root',
    async () => {
      expect(await lintFixture(VALID_MODULE)).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it('reports an exported function without a TSDoc comment', () => {
    expect(invalidMessages).toContainEqual(
      expect.objectContaining({ line: 8, ruleId: 'jsdoc/require-jsdoc' }),
    );
  });

  it('reports a function that throws without a @throws tag', () => {
    expect(invalidMessages).toContainEqual(
      expect.objectContaining({ line: 12, ruleId: 'jsdoc/require-throws' }),
    );
  });

  it('reports a deep import that bypasses another package root', () => {
    expect(invalidMessages).toContainEqual(
      expect.objectContaining({
        line: 4,
        ruleId: 'no-restricted-imports',
        message: expect.stringContaining('only through their package root') as unknown,
      }),
    );
  });

  it('reports a relative import that reaches into another package', () => {
    expect(invalidMessages).toContainEqual(
      expect.objectContaining({ line: 6, ruleId: 'import-x/no-relative-packages' }),
    );
  });

  it('reports a react import in packages/document', () => {
    expect(invalidMessages).toContainEqual(
      expect.objectContaining({
        line: 1,
        ruleId: 'no-restricted-imports',
        message: expect.stringContaining('@canvas/document stays React-free') as unknown,
      }),
    );
  });

  it('reports an import of a package that is not upstream of packages/document', () => {
    expect(invalidMessages).toContainEqual(
      expect.objectContaining({
        line: 3,
        ruleId: 'import-x/no-restricted-paths',
        message: expect.stringContaining(
          '@canvas/document may import only @canvas/schema',
        ) as unknown,
      }),
    );
  });

  it('reports exactly those violations and nothing else', () => {
    // ESLint reports messages in source order.
    const reported = invalidMessages.map(({ line, ruleId }) => `${String(line)}:${ruleId ?? ''}`);
    expect(reported).toEqual([
      '1:no-restricted-imports',
      '3:import-x/no-restricted-paths',
      '4:no-restricted-imports',
      '6:import-x/no-relative-packages',
      '8:jsdoc/require-jsdoc',
      '12:jsdoc/require-throws',
    ]);
  });
});

describe('createEslintConfig on tooling/scenario fixtures (type-only imports of the app)', () => {
  const eslint = new ESLint({
    cwd: FIXTURE_ROOT,
    overrideConfigFile: true,
    overrideConfig: createEslintConfig({ rootDir: FIXTURE_ROOT }),
  });

  async function lintFixture(relativePath: string): Promise<Linter.LintMessage[]> {
    const [result] = await eslint.lintFiles([relativePath]);
    return result?.messages ?? [];
  }

  it(
    'accepts an import type from @canvas/app',
    async () => {
      expect(await lintFixture('tooling/scenario/src/type-import.ts')).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'reports a value import from @canvas/app, and nothing else',
    async () => {
      const messages = await lintFixture('tooling/scenario/src/value-import.ts');
      expect(messages).toEqual([
        expect.objectContaining({
          line: 1,
          ruleId: '@typescript-eslint/no-restricted-imports',
          message: expect.stringContaining(
            '@canvas/scenario may import only types from @canvas/app',
          ) as unknown,
        }),
      ]);
    },
    LINT_TIMEOUT_MS,
  );
});

describe('createEslintConfig default-export exemptions', () => {
  const eslint = new ESLint({
    cwd: FIXTURE_ROOT,
    overrideConfigFile: true,
    overrideConfig: createEslintConfig({ rootDir: FIXTURE_ROOT }),
  });

  /**
   * The severity of `import-x/no-default-export` for a path: 0 off, 2 error.
   *
   * @param relativePath - A path under the fixture root; the file need not exist.
   * @returns The severity.
   */
  async function defaultExportSeverity(relativePath: string): Promise<unknown> {
    const config = (await eslint.calculateConfigForFile(relativePath)) as Linter.Config;
    const setting = config.rules?.['import-x/no-default-export'];
    return Array.isArray(setting) ? setting[0] : setting;
  }

  it('exempts tool configs and Playwright setup files, and nothing else', async () => {
    const severities = Object.fromEntries(
      await Promise.all(
        [
          'vitest.config.ts',
          'tooling/scenario/playwright.config.ts',
          'tooling/scenario/global-setup.ts',
          'tooling/golden/harness/global-teardown.ts',
          'packages/document/src/valid-module.ts',
          'tooling/scenario/src/global-setup-helpers.ts',
        ].map(async (path) => [path, await defaultExportSeverity(path)] as const),
      ),
    );

    expect(severities).toEqual({
      'vitest.config.ts': 0,
      'tooling/scenario/playwright.config.ts': 0,
      'tooling/scenario/global-setup.ts': 0,
      'tooling/golden/harness/global-teardown.ts': 0,
      'packages/document/src/valid-module.ts': 2,
      'tooling/scenario/src/global-setup-helpers.ts': 2,
    });
  });
});
