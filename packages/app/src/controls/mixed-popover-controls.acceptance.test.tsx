// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColourButton } from './colour-button.js';
import { CompactDropdown } from './compact-dropdown.js';

afterEach(cleanup);

describe('mixed primitive controls acceptance', () => {
  it('shows Mixed and leaves every compact choice unchecked', () => {
    render(
      <CompactDropdown
        label="Font"
        value="Lora"
        options={[
          { value: 'Lora', label: 'Lora' },
          { value: 'Inter', label: 'Inter' },
        ]}
        isMixed
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Font: Mixed' });
    expect(trigger.textContent).toContain('Mixed');
    fireEvent.click(trigger);
    expect(
      screen
        .getAllByRole('menuitemradio')
        .every((item) => item.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
  });

  it('shows recent colours after supplied groups, with no pressed choice when Mixed', () => {
    render(
      <ColourButton
        label="Text colour"
        value="#123456"
        valueLabel="#123456"
        swatch="#123456"
        groups={[
          {
            label: 'Board colours',
            choices: [{ value: '#123456', label: 'Blue', swatch: '#123456' }],
          },
        ]}
        recent={[{ value: '#abcdef', label: 'Recent pale blue', swatch: '#abcdef' }]}
        isMixed
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Text colour: Mixed' }));
    const dialog = screen.getByRole('dialog', { name: 'Text colour colours' });
    expect(
      within(dialog)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Board colours', 'Recent']);
    expect(
      within(dialog)
        .getAllByRole('button')
        .every((choice) => choice.getAttribute('aria-pressed') !== 'true'),
    ).toBe(true);
  });
});
