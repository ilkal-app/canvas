// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardMode } from '@canvas/schema';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderShell(mode?: BoardMode): HTMLElement {
  const { mount } = createFakeMount();
  const view = render(
    <AppShell platform="mac" mountEngine={mount} {...(mode === undefined ? {} : { mode })} />,
  );
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error('AppShell rendered no root element');
  return root;
}

describe('AppShell chrome after the whiteboard cutover', () => {
  it('opens a whiteboard with floating chrome when no mode is given', () => {
    expect(renderShell().getAttribute('data-whiteboard-chrome')).toBe('floating');
  });

  it.each(['diagram', 'uiux', 'slides'] as const)(
    'keeps the classic tools and reachable layers drawer in %s mode',
    (mode) => {
      const root = renderShell(mode);
      expect(root.hasAttribute('data-whiteboard-chrome')).toBe(false);
      expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
      expect(screen.getByRole('complementary', { name: 'Layers' })).toBeTruthy();
    },
  );
});
