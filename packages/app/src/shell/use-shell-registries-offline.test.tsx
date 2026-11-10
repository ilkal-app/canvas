// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDefaultStylePanelRegistry, useShellRegistries } from './use-shell-registries.js';

/** Whether the default sections' chunk can load (a dropped connection, then back). */
const network = vi.hoisted(() => ({ isUp: false }));

vi.mock('../panels/default-style-sections.js', async (importOriginal) => {
  if (!network.isUp) throw new Error('offline');
  return importOriginal();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useShellRegistries without the default sections', () => {
  it('shows no sections and reports the failed load', async () => {
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    const { result } = renderHook(() => useShellRegistries('mac', undefined, undefined));
    await waitFor(() => {
      expect(reported).toHaveBeenCalledOnce();
    });
    expect(result.current.sections).toBeUndefined();
    const [error] = reported.mock.calls[0] as [Error];
    expect(error.message).toBe('The style panel could not load its sections.');
  });

  it('loads again after a failure, and has the sections once the code arrives', async () => {
    await expect(loadDefaultStylePanelRegistry()).rejects.toThrow();
    network.isUp = true;
    const registry = await loadDefaultStylePanelRegistry();
    expect(registry.sections.map(({ id }) => id)).toContain('fill-stroke');
  });
});
