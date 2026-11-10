import { describe, expect, it } from 'vitest';

import { describeDevice } from './device-description.js';

function scope(deviceMemory: unknown, matching: readonly string[]) {
  return {
    navigator: { deviceMemory },
    matchMedia: (query: string) => ({ matches: matching.includes(query) }),
  };
}

describe('describeDevice', () => {
  it('reports the device memory the browser gives', () => {
    expect(describeDevice(scope(8, ['(any-pointer: fine)']))).toEqual({
      deviceMemoryGb: 8,
      isMobile: false,
    });
  });

  it('leaves the memory out where the browser does not say', () => {
    expect(describeDevice(scope(undefined, []))).toEqual({ isMobile: false });
  });

  it('calls a device whose only pointer is coarse a phone or tablet', () => {
    expect(describeDevice(scope(4, ['(pointer: coarse)']))).toEqual({
      deviceMemoryGb: 4,
      isMobile: true,
    });
  });

  it('calls a touch laptop with a trackpad a desktop', () => {
    expect(describeDevice(scope(4, ['(pointer: coarse)', '(any-pointer: fine)'])).isMobile).toBe(
      false,
    );
  });

  it('reads a scope without matchMedia as a desktop', () => {
    expect(describeDevice({ navigator: {} })).toEqual({ isMobile: false });
  });
});
