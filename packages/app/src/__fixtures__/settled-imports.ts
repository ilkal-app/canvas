import { afterEach, vi } from 'vitest';

// The workspace starts loading its lazy parts when it mounts. A test that ends with
// such a load in flight leaves it to finish after the test file is gone, and coverage merged
// from the CI shards then counts a second, unmapped copy of each module it loads, whose
// functions no test runs. Each test waits for the dynamic imports it started.
afterEach(async () => {
  await vi.dynamicImportSettled();
});
