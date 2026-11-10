// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MIXED } from '../panels/controls/mixed-value.js';

import { AlignDropdown } from './align-dropdown.js';

afterEach(cleanup);

describe('alignment dropdown acceptance', () => {
  it.each([
    ['left', 'text-left'],
    ['center', 'text-centre'],
    ['right', 'text-right'],
  ] as const)('draws the current %s icon and check', (align, icon) => {
    render(<AlignDropdown align={align} onAlign={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Alignment' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.querySelector('svg')?.dataset.icon).toBe(icon);
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Alignment' });
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
    const label = align === 'center' ? 'Centre' : align === 'left' ? 'Left' : 'Right';
    expect(
      within(menu).getByRole('menuitemradio', { name: label }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows no horizontal check for Mixed and sends one horizontal change', () => {
    const onAlign = vi.fn();
    render(<AlignDropdown align={MIXED} onAlign={onAlign} />);
    const trigger = screen.getByRole('button', { name: 'Alignment' });
    expect(trigger.querySelector('svg')?.dataset.icon).toBe('text-left');
    fireEvent.click(trigger);
    expect(
      screen
        .getAllByRole('menuitemradio')
        .every((item) => item.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Centre' }));
    expect(onAlign).toHaveBeenCalledExactlyOnceWith('center');
  });

  it('adds vertical choices only when supplied and routes one vertical change', () => {
    const onAlign = vi.fn();
    const onVerticalAlign = vi.fn();
    render(
      <AlignDropdown
        align="left"
        verticalAlign="middle"
        onAlign={onAlign}
        onVerticalAlign={onVerticalAlign}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Alignment' }));
    const menu = screen.getByRole('menu', { name: 'Alignment' });
    expect(within(menu).getByRole('separator')).not.toBeNull();
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Middle' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Bottom' }));
    expect(onVerticalAlign).toHaveBeenCalledExactlyOnceWith('bottom');
    expect(onAlign).not.toHaveBeenCalled();
  });
});
