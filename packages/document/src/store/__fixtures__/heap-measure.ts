/** The parts of Node's `process` the measurement reads, when running under Node. */
interface NodeProcess {
  /** Node's memory report. */
  memoryUsage(): { readonly heapUsed: number };
}

/**
 * Measures roughly how many heap bytes a value built by `build` retains: the change in
 * `process.memoryUsage().heapUsed` across the build, after a full garbage collection on each side
 * (`node --expose-gc`). Without a collector to call the figure would mix in garbage, and a
 * collection during the build can make it negative, so it is `null` then, as it is outside
 * Node.
 *
 * @param build - Builds the value to measure; its result is kept alive until the second reading.
 * @returns The retained bytes, and the value (so the caller can keep using it).
 */
export function measureRetainedHeap<Value>(build: () => Value): {
  readonly bytes: number | null;
  readonly value: Value;
} {
  const runtime = globalThis as { process?: NodeProcess; gc?: () => void };
  const collect = (): void => runtime.gc?.();
  collect();
  const before = runtime.process?.memoryUsage().heapUsed;
  const value = build();
  collect();
  const after = runtime.process?.memoryUsage().heapUsed;
  const isMeasured = runtime.gc !== undefined && before !== undefined && after !== undefined;
  return { bytes: isMeasured ? after - before : null, value };
}

/**
 * Formats a byte count in MiB with one decimal, for bench titles.
 *
 * @param bytes - The byte count, or `null` when unknown.
 * @returns The formatted size, e.g. `"12.3 MiB"`, or `"n/a"`.
 */
export function formatMebibytes(bytes: number | null): string {
  return bytes === null ? 'n/a' : `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
