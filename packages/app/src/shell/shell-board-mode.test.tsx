// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { panelLayoutFor } from '../state/dock-layout.js';

import {
  isMissingDrawer,
  shellBoardModeContext,
  useShellBoardModeValue,
  useShellDrawers,
} from './shell-board-mode.js';

const NONE = panelLayoutFor('whiteboard', 'floating');
const BOTH = panelLayoutFor('whiteboard', 'classic');

describe('isMissingDrawer', () => {
  it('refuses the layers and inspector toggles only where their drawer is missing', () => {
    expect(isMissingDrawer({ type: 'toggleLayersDrawer' }, NONE)).toBe(true);
    expect(isMissingDrawer({ type: 'toggleInspector' }, NONE)).toBe(true);
    expect(isMissingDrawer({ type: 'toggleLayersDrawer' }, BOTH)).toBe(false);
    expect(isMissingDrawer({ type: 'toggleInspector' }, BOTH)).toBe(false);
    expect(isMissingDrawer({ type: 'toggleCheatSheet' }, NONE)).toBe(false);
  });
});

describe('useShellBoardModeValue', () => {
  it('follows the mode it is switched to, with that mode’s drawers', () => {
    const onModeChange = vi.fn();
    const { result } = renderHook(() =>
      useShellBoardModeValue(undefined, onModeChange, 'floating'),
    );
    expect(result.current.mode).toBe('whiteboard');
    expect(result.current.drawers).toEqual(NONE);
    act(() => {
      result.current.changeMode('uiux');
    });
    expect(onModeChange).toHaveBeenCalledWith('uiux');
    expect(result.current.mode).toBe('uiux');
    expect(result.current.drawers).toEqual(BOTH);
  });
});

describe('useShellDrawers', () => {
  it('has both drawers outside a shell, and the shell’s inside one', () => {
    expect(renderHook(() => useShellDrawers()).result.current).toEqual(BOTH);
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <shellBoardModeContext.Provider
        value={{ mode: 'whiteboard', changeMode: () => undefined, drawers: NONE }}
      >
        {children}
      </shellBoardModeContext.Provider>
    );
    expect(renderHook(() => useShellDrawers(), { wrapper }).result.current).toEqual(NONE);
  });
});
