// The one Vitest configuration for the workspace. Every package under packages/ and tooling/
// becomes a Vitest project named after its package.json `name`, so `pnpm test` runs them all in
// one process and `pnpm vitest --project @canvas/schema` runs one.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultClientConditions, defaultServerConditions } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

const WORKSPACE_FOLDERS = ['packages', 'tooling'];
const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));

interface WorkspacePackage {
  /** Directory relative to the repository root, e.g. `packages/schema`. */
  dir: string;
  /** The package.json `name`, e.g. `@canvas/schema`; also the Vitest project name. */
  name: string;
}

function listWorkspacePackages(): WorkspacePackage[] {
  return WORKSPACE_FOLDERS.flatMap((folder) =>
    readdirSync(join(ROOT_DIR, folder), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(ROOT_DIR, folder, entry.name, 'package.json')),
      )
      .map((entry) => {
        const dir = join(folder, entry.name);
        const manifest = JSON.parse(readFileSync(join(ROOT_DIR, dir, 'package.json'), 'utf8')) as {
          name: string;
        };
        return { dir, name: manifest.name };
      }),
  );
}

const workspacePackages = listWorkspacePackages();

declare module 'vitest' {
  interface ProvidedContext {
    /** Whether `pnpm bench` is a smoke run (`BENCH_SMOKE=1`) that builds small boards. */
    isBenchSmoke: boolean;
  }
}

export default defineConfig({
  // Resolve `@canvas/*` imports to `src/` through the `development` export condition, so tests
  // never need a build.
  resolve: { conditions: ['development', ...defaultClientConditions] },
  ssr: {
    resolve: {
      conditions: [
        'development',
        ...defaultServerConditions.filter((condition) => condition !== 'module'),
      ],
    },
  },
  test: {
    environment: 'node',
    provide: { isBenchSmoke: process.env.BENCH_SMOKE === '1' },
    restoreMocks: true,
    // Let `?raw` stylesheet imports through as text, so a test can read a stylesheet's source.
    css: { include: [/\.css\?raw$/] },
    projects: workspacePackages.map(({ dir, name }) => ({
      extends: true,
      test: {
        name,
        root: join(ROOT_DIR, dir),
        include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
        exclude: [...configDefaults.exclude],
        benchmark: { include: ['src/**/*.bench.ts'] },
        // The shell fails a test on a browser error.
        ...(name === '@canvas/app' ? { setupFiles: ['src/__fixtures__/browser-errors.ts'] } : {}),
      },
    })),
    coverage: {
      provider: 'v8',
      include: workspacePackages.map(({ dir }) => `${dir}/src/**/*.{ts,tsx}`),
      exclude: ['**/src/index.ts', '**/*.test.{ts,tsx}', '**/*.bench.ts', '**/__fixtures__/**'],
      reporter: ['text-summary', 'html'],
    },
  },
});
