// @vitest-environment jsdom
import { cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardMode } from '@canvas/schema';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';
import { useWhiteboardChrome, whiteboardChromeContext } from './whiteboard-chrome.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.innerHTML = '';
});

function shellRootFor(mode?: BoardMode): HTMLElement {
  const { mount } = createFakeMount();
  const view = render(
    <AppShell platform="mac" mountEngine={mount} {...(mode === undefined ? {} : { mode })} />,
  );
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error('AppShell rendered no root element');
  return root;
}

describe('whiteboard chrome flag', () => {
  it('is classic outside a shell', () => {
    expect(renderHook(() => useWhiteboardChrome()).result.current).toBe('classic');
  });

  it('reads the chrome its provider gives', () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <whiteboardChromeContext.Provider value="floating">
        {children}
      </whiteboardChromeContext.Provider>
    );
    expect(renderHook(() => useWhiteboardChrome(), { wrapper }).result.current).toBe('floating');
  });

  it('marks the root of a whiteboard board’s shell only, so the classic DOM is unchanged', () => {
    expect(shellRootFor().dataset.whiteboardChrome).toBe('floating');
    cleanup();
    expect(shellRootFor('diagram').hasAttribute('data-whiteboard-chrome')).toBe(false);
  });
});
