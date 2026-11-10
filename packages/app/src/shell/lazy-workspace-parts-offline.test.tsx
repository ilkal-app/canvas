// @vitest-environment jsdom
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StylePanelProps } from '../panels/style-panel.js';

import {
  LazyStylePanel,
  preloadWorkspaceParts,
  usePreloadedWorkspaceParts,
} from './lazy-workspace-parts.js';

/** Whether the style panel's chunk can load (a dropped connection, then back). */
const network = vi.hoisted(() => ({ isUp: false }));

vi.mock('../panels/style-panel.js', () => {
  if (!network.isUp) throw new Error('offline');
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- the module's export is a component, PascalCase.
    StylePanel: (): ReactElement => <aside aria-label="Style" />,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the workspace lazy parts without their code', () => {
  it('shows no style panel and reports the failed load', async () => {
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    render(<LazyStylePanel {...({} as StylePanelProps)} />);
    await waitFor(() => {
      expect(reported).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole('complementary')).toBeNull();
    const [error] = reported.mock.calls[0] as [Error];
    expect(error.message).toBe('The style panel could not load.');
  });

  it('reports nothing when the load started at mount fails: the first use reports', async () => {
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    renderHook(() => {
      usePreloadedWorkspaceParts();
    });
    // The same load, in flight: once it has failed, the mount's own handler has run.
    await expect(preloadWorkspaceParts()).rejects.toThrow('The style panel could not load.');
    expect(reported).not.toHaveBeenCalled();
  });

  it('loads again after a failure, and shows the panel once the code arrives', async () => {
    await expect(preloadWorkspaceParts()).rejects.toThrow('The style panel could not load.');
    network.isUp = true;
    await preloadWorkspaceParts();
    render(<LazyStylePanel {...({} as StylePanelProps)} />);
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeTruthy();
  });
});
