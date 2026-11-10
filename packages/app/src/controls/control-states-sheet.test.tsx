// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ControlStatesSheet } from './control-states-sheet.js';

afterEach(cleanup);

/**
 * One row of the sheet.
 *
 * @param name - Its name.
 * @returns The row.
 */
function row(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('ControlStatesSheet', () => {
  it('shows each button kind default, disabled and busy, the busy one saying what it does', () => {
    render(<ControlStatesSheet />);
    for (const [name, label, busy] of [
      ['Primary button', 'Save', 'Saving…'],
      ['Secondary button', 'Duplicate', 'Duplicating…'],
      ['Ghost button', 'Cancel', 'Cancelling…'],
      ['Danger button', 'Move to trash', 'Moving…'],
    ] as const) {
      const buttons = within(row(name)).getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual([label, label, busy]);
      expect(buttons[1]).toHaveProperty('disabled', true);
      expect(buttons[2]?.getAttribute('aria-busy')).toBe('true');
    }
    expect(
      within(row('Not built yet')).getByRole('button', { name: 'Export — not available yet' }),
    ).toBeTruthy();
    // Its controls edit nothing: a press leaves the sheet as it was.
    const [save] = within(row('Primary button')).getAllByRole('button', { name: 'Save' });
    if (save === undefined) throw new Error('No Save button.');
    fireEvent.click(save);
    expect(within(row('Primary button')).getAllByRole('button')).toHaveLength(3);
  });

  it('shows the text field empty, filled, in error with its fix and disabled', () => {
    render(<ControlStatesSheet />);
    const fields = within(row('Text field'));
    expect(fields.getByRole('textbox', { name: 'Empty' })).toHaveProperty('value', '');
    expect(fields.getByRole('textbox', { name: 'Filled' })).toHaveProperty(
      'value',
      'Q4 launch plan',
    );
    expect(fields.getByRole('textbox', { name: 'Error' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(fields.getByText('Enter a full email address')).toBeTruthy();
    expect(fields.getByRole('textbox', { name: 'Disabled' })).toHaveProperty('disabled', true);
    fireEvent.change(fields.getByRole('textbox', { name: 'Empty' }), {
      target: { value: 'typed' },
    });
    expect(fields.getByRole('textbox', { name: 'Empty' })).toHaveProperty('value', 'typed');
  });

  it('shows the select, enabled and disabled, and the toggle on, off and disabled', () => {
    render(<ControlStatesSheet />);
    const controls = within(row('Select and toggle'));
    expect(controls.getByRole('combobox', { name: 'Role' }).textContent).toContain('Can edit');
    expect(controls.getByRole('combobox', { name: 'Role, disabled' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(controls.getByRole('switch', { name: 'Toggle on' })).toHaveProperty('checked', true);
    expect(controls.getByRole('switch', { name: 'Toggle off' })).toHaveProperty('checked', false);
    expect(controls.getByRole('switch', { name: 'Toggle disabled' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows the dock tool button default, active and not built yet', () => {
    render(<ControlStatesSheet />);
    const tools = within(row('Dock tool button'));
    expect(tools.getByRole('button', { name: 'Note (N)' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(tools.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      tools.getByRole('button', { name: 'Pen — not available yet' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('shows each toast kind, the error as an alert with Retry, and the spinners and skeleton', () => {
    render(<ControlStatesSheet />);
    const toasts = within(row('Toasts'));
    expect(toasts.getAllByRole('status').map((region) => region.textContent)).toEqual([
      'Link copied',
      'Invite sent to sam@example.com',
      'Can’t undo — Mira changed this since',
    ]);
    expect(toasts.getByRole('alert').textContent).toBe('Couldn’t save the name');
    expect(toasts.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(toasts.getByRole('button', { name: 'Undo' })).toBeTruthy();
    const loading = row('Progress and loading');
    expect(
      [...loading.querySelectorAll('[data-spinner]')].map((spinner) =>
        spinner.getAttribute('data-size'),
      ),
    ).toEqual(['12', '16', '24']);
    expect(loading.querySelectorAll('[data-shape]')).toHaveLength(3);
  });

  it('shows the floating primitives only with the floating chrome', () => {
    const { rerender } = render(<ControlStatesSheet />);
    expect(screen.queryByRole('region', { name: 'Floating sheet' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Anchored popover' })).toBeNull();
    rerender(<ControlStatesSheet chrome="classic" />);
    expect(screen.queryByRole('region', { name: 'Floating sheet' })).toBeNull();
    rerender(<ControlStatesSheet chrome="floating" />);
    const sheets = within(row('Floating sheet'));
    expect(
      ['Toolbar sheet', 'Bar sheet', 'Stack sheet'].map(
        (name) => sheets.getByRole('group', { name }).dataset.shape,
      ),
    ).toEqual(['toolbar', 'bar', 'stack']);
    const dropdowns = within(row('Compact dropdown'));
    expect(dropdowns.getByRole('button', { name: 'Font size: 16' })).toBeTruthy();
    expect(dropdowns.getByRole('button', { name: 'Kind: Primary' })).toBeTruthy();
    expect(dropdowns.getByRole('button', { name: 'Font size, disabled: 16' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(row('Menu')).getByRole('button', { name: 'Board menu' })).toBeTruthy();
    expect(
      within(row('Whiteboard icons'))
        .getAllByRole('img')
        .map((icon) => icon.getAttribute('aria-label')),
    ).toEqual([
      'Home',
      'Minimap',
      'Lasso',
      'Highlighter',
      'Reactions',
      'Section',
      'Timer',
      'Vote',
      'Pencil',
      'Marker',
      'Eraser',
    ]);
    const colours = within(row('Colour button and chip'));
    expect(colours.getByRole('button', { name: 'Fill: Pink' })).toBeTruthy();
    expect(colours.getByRole('button', { name: 'Square' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(colours.getByRole('button', { name: 'Wide' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('opens the sample popover from its button and closes it with Escape', () => {
    render(<ControlStatesSheet chrome="floating" />);
    const show = within(row('Anchored popover')).getByRole('button', { name: 'Show popover' });
    show.focus();
    fireEvent.click(show);
    const popover = screen.getByRole('toolbar', { name: 'Sample properties' });
    expect(document.activeElement).toBe(within(popover).getByRole('button', { name: 'Colour' }));
    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Sample properties' })).toBeNull();
    expect(document.activeElement).toBe(show);
    fireEvent.click(show);
    fireEvent.click(show);
    expect(screen.queryByRole('toolbar', { name: 'Sample properties' })).toBeNull();
  });
});
