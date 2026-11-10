// Checks the SDK's bundle against its budget: builds the bundle in memory as
// `pnpm build` does, measures the main script and each lazy part gzipped (bundle-budget.ts), and
// fails when one grew past its figure in bundle-budget.json, or a worker, the wasm or a font loads
// with the main script.
//   pnpm --filter @ilkal/sdk test:bundle    with the boundary check; CI's `static (build)` runs it
//   node --experimental-strip-types scripts/check-bundle-budget.ts --update
//                                            writes the measured figures: raising one needs the
//                                            owner's yes, recorded on the PR
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build, type Rollup } from 'vite';

import {
  budgetOf,
  budgetProblems,
  budgetReport,
  measureBundle,
  type BundleBudget,
  type BundleFile,
} from './bundle-budget.ts';

/** The SDK's package folder. */
const SDK_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The locked figures. */
const BUDGET_FILE = fileURLToPath(new URL('bundle-budget.json', import.meta.url));

const result = await build({
  root: SDK_DIR,
  configFile: `${SDK_DIR}vite.config.ts`,
  logLevel: 'silent',
  build: { write: false },
});
const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
const files: BundleFile[] = outputs
  .flatMap(({ output }) => output)
  .map((file) =>
    file.type === 'chunk'
      ? {
          fileName: file.fileName,
          contents: file.code,
          isEntry: file.isEntry,
          imports: file.imports,
        }
      : { fileName: file.fileName, contents: file.source, isEntry: false, imports: [] },
  );
const measure = measureBundle(files);
if (process.argv.includes('--update')) {
  writeFileSync(BUDGET_FILE, `${JSON.stringify(budgetOf(measure), null, 2)}\n`);
  process.stdout.write(`check-bundle-budget: wrote the measured figures to bundle-budget.json\n`);
} else {
  const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) as BundleBudget;
  const problems = budgetProblems(measure, budget);
  const report = budgetReport(measure, budget).join('\n');
  if (problems.length > 0) {
    process.stderr.write(
      `check-bundle-budget: the SDK's bundle is over its budget:\n${problems.map((problem) => `  ${problem}\n`).join('')}${report}\nRaising the budget needs the owner's yes, recorded on the PR.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`check-bundle-budget: within budget\n${report}\n`);
  }
}
