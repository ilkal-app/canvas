import { describe, expect, it } from 'vitest';

import { formatBytes, formatCount, formatFps, formatMs } from './format-diagnostics.js';

describe('formatMs', () => {
  it('shows milliseconds with two decimals', () => {
    expect(formatMs(0)).toBe('0.00 ms');
    expect(formatMs(1.234)).toBe('1.23 ms');
    expect(formatMs(16.666)).toBe('16.67 ms');
  });
});

describe('formatBytes', () => {
  it('shows small sizes in bytes and larger ones in binary units with one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(655_360)).toBe('640.0 KiB');
    expect(formatBytes(3 * 1024 * 1024 + 512 * 1024)).toBe('3.5 MiB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GiB');
  });
});

describe('formatCount', () => {
  it('groups thousands the same way on every machine', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(50_000)).toBe('50,000');
  });
});

describe('formatFps', () => {
  it('shows a figure with its unit', () => {
    expect(formatFps(60)).toBe('60 fps');
    expect(formatFps(1)).toBe('1 fps');
  });

  it('shows idle rather than 0 fps', () => {
    expect(formatFps('idle')).toBe('idle');
  });
});
