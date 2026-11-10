// @vitest-environment jsdom
// A tool panel opened from its dock button by a key takes focus; Escape walks back.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import type { ShellAction } from '../state/shell-action.js';
import { INITIAL_SHELL_STATE, type ShellState } from '../state/shell-reducer.js';

import { FloatingDock } from './floating-dock.js';
import {
  defineToolPanel,
  toolPanelsOf,
  type ToolPanelContentsProps,
} from './tool-panels/tool-panel-contribution.js';

interface Choices {
  readonly size: 'square' | 'wide';
}

function ChoicesContents({ choices, onChange }: ToolPanelContentsProps<Choices>) {
  return (
    <>
      {(['square', 'wide'] as const).map((size) => (
        <button
          key={size}
          type="button"
          data-dock-item=""
          aria-pressed={choices.size === size}
          onClick={() => {
            onChange({ size });
          }}
        >
          {size}
        </button>
      ))}
    </>
  );
}

function fixturePanel(id: 'sticky' | 'shapes', label: string) {
  return defineToolPanel<Choices>({
    id,
    label,
    codec: { id, defaults: { size: 'square' }, parse: () => ({ size: 'square' }) },
    toolStyle: (choices) => ({ tool: 'sticky', style: { aspect: choices.size } }),
    contents: ChoicesContents,
  });
}

const STICKY = fixturePanel('sticky', 'Sticky');
const SHAPES = fixturePanel('shapes', 'Shapes');
const REGISTRY = createFloatingShortcutRegistry('mac');

function renderDock() {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const panels = toolPanelsOf([STICKY, SHAPES]);
  const dockOf = (activeTool: ShellState['activeTool']) => (
    <FloatingDock
      registry={REGISTRY}
      state={{ ...INITIAL_SHELL_STATE, activeTool, canEdit: true }}
      dispatch={dispatch}
      panels={panels}
    />
  );
  const view = render(dockOf('select'));
  const dock = screen.getByRole('toolbar', { name: 'Tools' });
  const sticky = within(dock).getByRole('button', { name: /^Sticky note \(/ });
  return {
    dock,
    sticky,
    // The shell makes the chosen tool active, which opens its panel.
    open: (tool: ShellState['activeTool'] = 'sticky') => {
      view.rerender(dockOf(tool));
    },
  };
}

function panelItem(name: string, panel = 'Sticky'): HTMLElement {
  return within(screen.getByRole('toolbar', { name: `${panel} options` })).getByRole('button', {
    name,
  });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('floating dock: tool panels by keyboard', () => {
  it.each(['Enter', ' '])('focuses the panel opened by %j on its dock button', (key) => {
    const { sticky, open } = renderDock();
    sticky.focus();
    fireEvent.keyDown(sticky, { key });
    fireEvent.click(sticky);
    open();
    expect(document.activeElement).toBe(panelItem('square'));
  });

  it('leaves focus where it was when a click opens the panel', () => {
    const { sticky, open } = renderDock();
    fireEvent.keyDown(sticky, { key: 'Enter' });
    fireEvent.pointerDown(sticky);
    fireEvent.click(sticky);
    open();
    expect(document.activeElement).toBe(document.body);
  });

  it('hands focus back to the dock button on Escape, then to the canvas', () => {
    const { sticky, open } = renderDock();
    sticky.focus();
    fireEvent.keyDown(sticky, { key: 'Enter' });
    fireEvent.click(sticky);
    open();
    fireEvent.keyDown(panelItem('square'), { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Sticky options' })).toBeNull();
    expect(document.activeElement).toBe(sticky);
    // Only the move to the canvas: the shell's own Escape (deselect) sees it already handled.
    expect(fireEvent.keyDown(sticky, { key: 'Escape' })).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('returns to the pressed button when a key switched to another panel since', () => {
    const { dock, sticky, open } = renderDock();
    sticky.focus();
    fireEvent.keyDown(sticky, { key: 'Enter' });
    fireEvent.click(sticky);
    open();
    // The Shapes key, typed in the Sticky panel: the shell makes Shapes the tool.
    open('shape');
    panelItem('wide', 'Shapes').focus();
    fireEvent.keyDown(panelItem('wide', 'Shapes'), { key: 'Escape' });
    expect(document.activeElement).toBe(within(dock).getByRole('button', { name: /^Shapes \(/ }));
  });

  it('hands focus to the pressed dock button when the panel was not opened by a key', () => {
    const { sticky, open } = renderDock();
    open();
    panelItem('wide').focus();
    fireEvent.keyDown(panelItem('wide'), { key: 'Escape' });
    expect(document.activeElement).toBe(sticky);
  });
});
