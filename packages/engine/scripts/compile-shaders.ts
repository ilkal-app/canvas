// Transpiles the engine's WGSL shaders to GLSL ES 3.0 (see shader-build.ts).
//   pnpm --filter @canvas/engine shaders          regenerate the committed outputs
//   pnpm --filter @canvas/engine shaders:check    fail when a committed output is stale
import { fileURLToPath } from 'node:url';

import { buildShaderDirectory } from './shader-build.ts';

const SHADER_DIR = fileURLToPath(new URL('../src/gpu/shaders/', import.meta.url));

const mode = process.argv.includes('--check') ? 'check' : 'write';
const { shaderCount, staleFiles } = buildShaderDirectory(SHADER_DIR, mode);
if (staleFiles.length > 0) {
  process.stderr.write(
    `compile-shaders: stale generated shader files (run pnpm --filter @canvas/engine shaders and commit):\n${staleFiles.map((fileName) => `  src/gpu/shaders/${fileName}\n`).join('')}`,
  );
  process.exitCode = 1;
} else {
  const verb = mode === 'check' ? 'up to date' : 'written';
  process.stdout.write(
    `compile-shaders: ${String(shaderCount)} WGSL shader(s), GLSL ES 3.0 ${verb}\n`,
  );
}
