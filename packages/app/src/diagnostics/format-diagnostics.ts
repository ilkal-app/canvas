const BINARY_UNITS = ['KiB', 'MiB', 'GiB'] as const;
const BYTES_PER_KIB = 1024;

/**
 * A duration for the developer overlay: two decimals, so a 0.05 ms stage is still visible.
 *
 * @param ms - The duration in ms.
 * @returns For example `1.23 ms`.
 */
export function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

/**
 * A GPU memory size for the developer overlay: bytes below 1 KiB, else KiB, MiB or GiB with one
 * decimal (binary units, as GPU budgets are).
 *
 * @param bytes - The size in bytes.
 * @returns For example `640.0 KiB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KIB) return `${String(bytes)} B`;
  let value = bytes / BYTES_PER_KIB;
  let unit: (typeof BINARY_UNITS)[number] = 'KiB';
  for (const next of BINARY_UNITS.slice(1)) {
    if (value < BYTES_PER_KIB) break;
    value /= BYTES_PER_KIB;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}

/**
 * A count for the developer overlay, with thousands grouped the same way whatever the
 * browser's locale.
 *
 * @param count - The count.
 * @returns For example `50,000`.
 */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * A frames-per-second figure for the developer overlay: `'idle'` rather than `0 fps`, so a
 * quiet board (the engine draws only when something changed) does not look broken.
 *
 * @param fps - The figure, or `'idle'` where nothing was drawn to measure it.
 * @returns For example `60 fps`, or `idle`.
 */
export function formatFps(fps: number | 'idle'): string {
  return fps === 'idle' ? 'idle' : `${String(fps)} fps`;
}
