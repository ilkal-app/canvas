import { join } from 'node:path';

import type { Linter } from 'eslint';

import { WORKSPACE_PACKAGES } from './workspace-packages.js';
import type { WorkspacePackage } from './workspace-packages.js';

const STANDARDS_LINK = 'docs/engineering-standards.md#dependency-direction';

const DEEP_IMPORT_PATTERN = {
  group: ['@canvas/*/*'],
  message:
    'Import other packages only through their package root ("@canvas/<name>"): deep imports ' +
    `bypass the public API in src/index.ts (Global Constraint 8, ${STANDARDS_LINK}).`,
};

function describeAllowedImports(workspacePackage: WorkspacePackage): string {
  const { name, allowedImports } = workspacePackage;
  const allowed = allowedImports.length > 0 ? allowedImports.join(', ') : 'no workspace package';
  return `${name} may import only ${allowed} (Global Constraint 8, ${STANDARDS_LINK}).`;
}

function createDependencyZone(
  rootDir: string,
  workspacePackage: WorkspacePackage,
): { target: string; from: string[]; message: string } {
  const forbidden = WORKSPACE_PACKAGES.filter(
    ({ name }) => name !== workspacePackage.name && !workspacePackage.allowedImports.includes(name),
  );
  return {
    target: join(rootDir, workspacePackage.dir),
    from: forbidden.map(({ dir }) => join(rootDir, dir)),
    message: describeAllowedImports(workspacePackage),
  };
}

function createReactRestriction(workspacePackage: WorkspacePackage): Linter.Config {
  const message =
    `React belongs to the shell (tools, app, sdk); ${workspacePackage.name} stays React-free ` +
    'so it runs headless and in workers (Global Constraint 2).';
  return {
    name: `canvas/boundaries/react-free/${workspacePackage.name}`,
    files: [`${workspacePackage.dir}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message },
            { name: 'react-dom', message },
          ],
          patterns: [DEEP_IMPORT_PATTERN, { group: ['react/*', 'react-dom/*'], message }],
        },
      ],
    },
  };
}

function createTypeOnlyRestriction(workspacePackage: WorkspacePackage): Linter.Config {
  const { name, dir, typeOnlyImports = [] } = workspacePackage;
  return {
    name: `canvas/boundaries/type-only/${name}`,
    files: [`${dir}/**/*.{ts,tsx}`],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: typeOnlyImports.map((imported) => ({
            name: imported,
            allowTypeImports: true,
            message:
              `${name} may import only types from ${imported} (\`import type\`), so its code ` +
              `never loads at runtime (${STANDARDS_LINK}).`,
          })),
        },
      ],
    },
  };
}

/**
 * Creates the rules that keep packages apart: imports follow the dependency direction,
 * reach other packages only through their root (never by a deep or a
 * relative path), stay React-free outside the shell, and are types only where the table says
 * so (`typeOnlyImports`).
 *
 * @param rootDir - Absolute path of the repository root; dependency zones are absolute paths.
 * @returns Flat config objects for the boundary rules.
 */
export function createBoundaryRules(rootDir: string): Linter.Config[] {
  return [
    {
      name: 'canvas/boundaries/dependency-direction',
      files: ['**/*.{ts,tsx}'],
      rules: {
        'import-x/no-restricted-paths': [
          'error',
          {
            zones: WORKSPACE_PACKAGES.map((workspacePackage) =>
              createDependencyZone(rootDir, workspacePackage),
            ),
          },
        ],
        'no-restricted-imports': ['error', { patterns: [DEEP_IMPORT_PATTERN] }],
        // The relative-path twin of a deep import (`../../schema/src/...`): another package is
        // reached only through its name, which resolves to its src/index.ts.
        'import-x/no-relative-packages': 'error',
      },
    },
    // Later config objects replace a rule's options, so each React-free package's block
    // repeats the deep-import pattern next to its React restriction.
    ...WORKSPACE_PACKAGES.filter(({ canImportReact }) => !canImportReact).map(
      createReactRestriction,
    ),
    // A separate rule id from the React restriction's, so neither replaces the other.
    ...WORKSPACE_PACKAGES.filter(({ typeOnlyImports = [] }) => typeOnlyImports.length > 0).map(
      createTypeOnlyRestriction,
    ),
  ];
}
