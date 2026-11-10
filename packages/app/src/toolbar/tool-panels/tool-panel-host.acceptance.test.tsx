// @vitest-environment jsdom
// Floating dock tool panel host acceptance.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFloatingShortcutRegistry } from '../../keymap/floating-keymap.js';
import type { ShellAction } from '../../state/shell-action.js';
import { INITIAL_SHELL_STATE, type ShellState } from '../../state/shell-reducer.js';
import { storedField } from '../../state/tool-panel-choices.js';
import type { ToolPanelId } from '../../state/tool-panel-state.js';
import { FloatingDock } from '../floating-dock.js';

import {
  defineToolPanel,
  isToolPanelContribution,
  toolPanelsOf,
  type AnyToolPanel,
  type ToolPanelContentsProps,
} from './tool-panel-contribution.js';

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

function fixturePanel(id: ToolPanelId, label: string): AnyToolPanel {
  return defineToolPanel<Choices>({
    id,
    label,
    codec: {
      id,
      defaults: { size: 'square' },
      parse: (stored) => ({
        size: storedField(
          stored,
          'size',
          (value): value is Choices['size'] => value === 'square' || value === 'wide',
          'square',
        ),
      }),
    },
    toolStyle: (choices) => ({
      tool: 'sticky',
      style: { aspect: choices.size },
    }),
    contents: ChoicesContents,
  });
}

const STICKY = fixturePanel('sticky', 'Sticky');
const SHAPES = fixturePanel('shapes', 'Shapes');
const PANELS = toolPanelsOf([STICKY, SHAPES]);
const REGISTRY = createFloatingShortcutRegistry('mac');

function renderHost(
  options: {
    activeTool?: ShellState['activeTool'];
    canEdit?: boolean;
    panels?: ReadonlyMap<ToolPanelId, AnyToolPanel>;
  } = {},
) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const panels = options.panels ?? PANELS;
  const state = (activeTool: ShellState['activeTool'], canEdit = options.canEdit ?? true) => ({
    ...INITIAL_SHELL_STATE,
    activeTool,
    canEdit,
  });
  const view = render(
    <FloatingDock
      registry={REGISTRY}
      state={state(options.activeTool ?? 'select')}
      dispatch={dispatch}
      panels={panels}
    />,
  );
  return {
    dispatch,
    view,
    dock: screen.getByRole('toolbar', { name: 'Tools' }),
    update: (activeTool: ShellState['activeTool'], canEdit?: boolean) => {
      view.rerender(
        <FloatingDock
          registry={REGISTRY}
          state={state(activeTool, canEdit)}
          dispatch={dispatch}
          panels={panels}
        />,
      );
    },
  };
}

function dockButton(dock: HTMLElement, name: string): HTMLElement {
  return within(dock).getByRole('button', { name: new RegExp(`^${name}(?: \\(| —|$)`) });
}

function panel(name = 'Sticky'): HTMLElement {
  return screen.getByRole('toolbar', { name: `${name} options` });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the floating tool panel host', () => {
  it('opens for an active tool chosen by key and exposes the sheet after the dock', () => {
    const { dock, update } = renderHost();
    expect(screen.queryByRole('toolbar', { name: 'Sticky options' })).toBeNull();
    update('sticky');
    const sheet = panel();
    expect(sheet.getAttribute('data-tool-panel')).toBe('sticky');
    expect(sheet.hasAttribute('data-popover-avoid')).toBe(true);
    expect(dock.hasAttribute('data-popover-avoid')).toBe(true);
    expect(sheet.hasAttribute('data-floating-sheet')).toBe(true);
    expect(sheet.getAttribute('data-shape')).toBe('toolbar');
    expect(dock.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'square' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens on a dock choice, toggles on repeat presses, and retains the selected tool', () => {
    const { dock, dispatch, update } = renderHost();
    fireEvent.click(dockButton(dock, 'Sticky note'));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'selectTool', tool: 'sticky' });
    update('sticky');
    expect(panel().isConnected).toBe(true);
    fireEvent.click(dockButton(dock, 'Sticky note'));
    expect(screen.queryByRole('toolbar', { name: 'Sticky options' })).toBeNull();
    expect(dockButton(dock, 'Sticky note').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(dockButton(dock, 'Sticky note'));
    expect(panel().isConnected).toBe(true);
  });

  it('swaps registered panels and closes when an outside tool hands back to Select', () => {
    const { dock, update } = renderHost({ activeTool: 'sticky' });
    fireEvent.click(dockButton(dock, 'Shapes'));
    update('shape');
    expect(panel('Shapes').getAttribute('data-tool-panel')).toBe('shapes');
    expect(screen.queryByRole('toolbar', { name: 'Sticky options' })).toBeNull();
    update('select');
    expect(screen.queryByRole('toolbar', { name: 'Shapes options' })).toBeNull();
  });

  it('closes on Escape from the panel or elsewhere while keeping the tool', () => {
    const { dock } = renderHost({ activeTool: 'sticky' });
    fireEvent.keyDown(within(panel()).getByRole('button', { name: 'square' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('toolbar', { name: 'Sticky options' })).toBeNull();
    expect(dockButton(dock, 'Sticky note').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(dockButton(dock, 'Sticky note'));
    expect(panel().isConnected).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Sticky options' })).toBeNull();
    expect(dockButton(dock, 'Sticky note').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps one panel tab stop and moves focus among choices with arrows', () => {
    const { dock } = renderHost({ activeTool: 'sticky' });
    const square = within(panel()).getByRole('button', { name: 'square' });
    const wide = within(panel()).getByRole('button', { name: 'wide' });
    expect(dock.querySelectorAll('[data-dock-item]')).not.toHaveLength(0);
    expect(square.hasAttribute('data-dock-item')).toBe(true);
    expect(wide.hasAttribute('data-dock-item')).toBe(true);
    expect([square.tabIndex, wide.tabIndex]).toEqual([0, -1]);
    square.focus();
    fireEvent.keyDown(square, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(wide);
    expect([square.tabIndex, wide.tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(wide, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(square);
  });

  it('loads per-user choices only when editing is allowed and applies each registered style', () => {
    localStorage.setItem('canvas.tool-panel.sticky', '{"size":"wide"}');
    const { dispatch, update } = renderHost({ activeTool: 'sticky', canEdit: false });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setToolStyle' }));
    update('sticky', true);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setToolStyle',
      tool: 'sticky',
      style: { aspect: 'wide' },
    });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'setToolStyle')).toHaveLength(
      2,
    );
    expect(within(panel()).getByRole('button', { name: 'wide' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('saves changed choices under the panel key and applies them to the next object', () => {
    const { dispatch, view } = renderHost({ activeTool: 'sticky' });
    dispatch.mockClear();
    fireEvent.click(within(panel()).getByRole('button', { name: 'wide' }));
    expect(localStorage.getItem('canvas.tool-panel.sticky')).toBe('{"size":"wide"}');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setToolStyle',
      tool: 'sticky',
      style: { aspect: 'wide' },
    });
    view.unmount();
    renderHost({ activeTool: 'sticky' });
    expect(within(panel()).getByRole('button', { name: 'wide' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it.each(['shape', 'image', 'line', 'sticky', 'select', 'hand', 'frame', 'text'] as const)(
    'opens nothing for %s without a registered panel',
    (activeTool) => {
      renderHost({ activeTool, panels: new Map() });
      expect(screen.queryByRole('toolbar', { name: /options$/ })).toBeNull();
    },
  );

  it('rejects duplicate registrations', () => {
    expect(() => toolPanelsOf([STICKY, fixturePanel('sticky', 'Another')])).toThrow(
      /Two files register the sticky tool panel/,
    );
  });

  it.each([
    ['null', null],
    ['empty object', {}],
    ['non-panel id', { ...STICKY, id: 'select' }],
    ['null codec', { ...STICKY, codec: null }],
    ['non-component contents', { ...STICKY, contents: 42 }],
  ] as const)('rejects a malformed contribution with %s', (caseName, value) => {
    expect(isToolPanelContribution(value), caseName).toBe(false);
  });

  it('accepts a complete contribution', () => {
    expect(isToolPanelContribution(STICKY)).toBe(true);
  });
});
