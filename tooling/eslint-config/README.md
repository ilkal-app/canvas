# @canvas/eslint-config

## Purpose

The shared ESLint flat config. The root `eslint.config.js` calls `createEslintConfig` once; packages have no ESLint config of their own.

## Public API

- `createEslintConfig(options)`: The flat config array for a repository root.
- `EslintConfigOptions`: Where the repository root is.

## Depends on

Nothing in the workspace. External: `typescript-eslint`, `eslint-plugin-import-x`, `eslint-plugin-jsdoc`, `eslint-import-resolver-typescript`.

## How to test

From the repo root: `pnpm test` runs every package; `pnpm vitest --project @canvas/eslint-config` watches this one.

## Design notes

Rules are grouped by concept in `src/rules/` (TypeScript, imports, TSDoc, naming, size, console) and `src/boundaries/` (dependency direction, deep and relative imports into other packages, React-free packages, type-only imports). `src/boundaries/workspace-packages.ts` is the one table of which package may import which. `src/config/create-eslint-config.test.ts` lints the fixture repo in `src/config/__fixtures__/repo/` through the ESLint Node API: one module that must pass, one that must fail on a missing TSDoc, a missing `@throws`, a deep import, a relative import into another package, a React import and an import against the dependency direction; and, in `tooling/scenario/`, an `import type` from `@canvas/app` that must pass and a value import that must fail (`typeOnlyImports`).

ESLint loads this package from `dist`, so it is built by the root `prepare` script (`pnpm install`) and before every `lint` task.
