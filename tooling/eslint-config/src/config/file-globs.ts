/** TypeScript sources, including React components. */
export const TYPESCRIPT_FILES = ['**/*.{ts,tsx}'];

/** Plain JavaScript files: in this repo, only root-level tool configs. */
export const JAVASCRIPT_FILES = ['**/*.{js,mjs,cjs}'];

/** Tool configs (eslint, vitest, vite, commitlint, ...), which those tools load by default export. */
export const CONFIG_FILES = ['**/*.config.{js,mjs,cjs,ts}'];

/** Playwright's global setup and teardown files, which Playwright loads by default export. */
export const PLAYWRIGHT_SETUP_FILES = ['**/global-setup.ts', '**/global-teardown.ts'];

/** Colocated tests and benchmarks. */
export const TEST_FILES = ['**/*.test.{ts,tsx}', '**/*.bench.ts'];

/** Folders where writing to the console is how the code talks to its operator. */
export const CONSOLE_ALLOWED_FILES = ['services/**', 'tooling/**'];
