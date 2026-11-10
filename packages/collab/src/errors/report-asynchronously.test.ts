import { describe, expect, it, vi } from 'vitest';

import { reportAsynchronously } from './report-asynchronously.js';

describe('reportAsynchronously', () => {
  it('rethrows the error from a microtask, not from the call', () => {
    const tasks: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => tasks.push(task));
    const error = new Error('cache write failed');
    expect(() => {
      reportAsynchronously(error);
    }).not.toThrow();
    expect(tasks).toHaveLength(1);
    expect(() => tasks[0]?.()).toThrow(error);
  });
});
