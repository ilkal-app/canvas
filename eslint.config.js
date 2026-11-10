// The single ESLint entry point. Rules live in tooling/eslint-config (a workspace package);
// ESLint finds this file from any package directory, so `eslint .` works everywhere.
import { createEslintConfig } from '@canvas/eslint-config';

export default createEslintConfig({ rootDir: import.meta.dirname });
