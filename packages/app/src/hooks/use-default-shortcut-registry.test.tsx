// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDefaultShortcutRegistry } from './use-default-shortcut-registry.js';

afterEach(() => {
  cleanup();
});

describe('useDefaultShortcutRegistry', () => {
  it('builds the registry for the given platform once, and again when it changes', () => {
    const { result, rerender } = renderHook(
      ({ platform }: { platform: 'mac' | 'other' }) => useDefaultShortcutRegistry(platform),
      { initialProps: { platform: 'mac' as 'mac' | 'other' } },
    );
    const mac = result.current;
    expect(mac.platform).toBe('mac');
    rerender({ platform: 'mac' });
    expect(result.current).toBe(mac);
    rerender({ platform: 'other' });
    expect(result.current.platform).toBe('other');
  });

  it('detects the platform from the browser when none is given', () => {
    const { result } = renderHook(() => useDefaultShortcutRegistry());
    expect(['mac', 'other']).toContain(result.current.platform);
  });
});
