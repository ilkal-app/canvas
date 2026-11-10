// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShellAction } from '../state/shell-action.js';

import {
  CONNECTOR,
  CONNECTOR_2,
  mount,
  preparePopover,
  propsOf,
  SHAPE,
} from './popover-shape-connector-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Opens the width menu and returns its custom number field.
 *
 * @param trigger - The width button name.
 * @returns The custom input.
 */
function customWidth(trigger: RegExp): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(4);
  // A footer puts the field in the dialog round the menu, outside its list (font size's too).
  return screen.getByRole('spinbutton', { name: 'Custom stroke width' });
}

/**
 * Enters a candidate width using the menu's Enter contract.
 *
 * @param field - The custom input.
 * @param value - The candidate text.
 */
function enter(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

describe('custom stroke width', () => {
  it('sets both selected connectors to 12 px in one style action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CONNECTOR, CONNECTOR_2], { dispatch }));
    enter(customWidth(/^Line width:/), '12');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { stroke: { ...CONNECTOR.stroke, width: 12 } } },
        { id: CONNECTOR_2.id, style: { stroke: { ...CONNECTOR_2.stroke, width: 12 } } },
      ],
    });
  });

  it.each(['0', '65', '', 'abc', '1.5'])('marks %j invalid and dispatches nothing', (value) => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CONNECTOR], { dispatch }));
    const field = customWidth(/^Line width:/);
    enter(field, value);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('shows a typed non-preset width on the trigger', () => {
    mount(propsOf([{ ...CONNECTOR, stroke: { ...CONNECTOR.stroke, width: 12 } }]));
    expect(screen.getByRole('button', { name: 'Line width: 12 px' })).toBeTruthy();
  });

  it('gives a selected shape the same custom field and a single style action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE], { dispatch }));
    enter(customWidth(/^Stroke width:/), '64');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: SHAPE.id, style: { stroke: { ...SHAPE.stroke, width: 64 } } }],
    });
  });
});
