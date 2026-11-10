// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createStylePanelRegistry } from '../panels/panel-sections.js';
import { createToolbarActionRegistry } from '../toolbar/toolbar-actions.js';

import { loadDefaultStylePanelRegistry, useShellRegistries } from './use-shell-registries.js';

afterEach(() => {
  cleanup();
});

describe('useShellRegistries', () => {
  it('makes the default registries once, the sections once loaded, and keeps them', async () => {
    const { result, rerender } = renderHook(() => useShellRegistries('mac', undefined, undefined));
    const first = result.current;
    expect(first.actions.actions.map(({ id }) => id)).toEqual(['toggle-grid', 'toggle-snapping']);
    // The default sections load apart from the page's first script.
    expect(first.sections).toBeUndefined();
    // Loading every section file can take over a second on a busy machine.
    await waitFor(
      () => {
        expect(result.current.sections?.sections.map(({ id }) => id)).toContain('fill-stroke');
      },
      { timeout: 10_000 },
    );
    const loaded = result.current;
    rerender();
    expect(result.current.registry).toBe(first.registry);
    expect(result.current.actions).toBe(first.actions);
    expect(result.current.sections).toBe(loaded.sections);
  });

  it('gives a shell mounted after the load the default sections at once', async () => {
    const sections = await loadDefaultStylePanelRegistry();
    const { result } = renderHook(() => useShellRegistries('mac', undefined, undefined));
    expect(result.current.sections).toBe(sections);
  });

  it('uses the registries it is given instead of the defaults', () => {
    const actions = createToolbarActionRegistry();
    const sections = createStylePanelRegistry();
    const { result } = renderHook(() => useShellRegistries('other', actions, sections));
    expect(result.current.actions).toBe(actions);
    expect(result.current.sections).toBe(sections);
  });
});
