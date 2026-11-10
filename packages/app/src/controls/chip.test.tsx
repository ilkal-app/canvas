// @vitest-environment jsdom
// The chip (the Library page's Chip): a toggle button, default and active.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Chip } from './chip.js';
import chipCss from './chip.module.css?raw';

afterEach(cleanup);

describe('Chip', () => {
  it('is a toggle button named by its words, off then on', () => {
    const onToggle = vi.fn<(isActive: boolean) => void>();
    const { rerender } = render(<Chip label="Square" isActive={false} onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: 'Square' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(true);
    rerender(<Chip label="Square" isActive onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Square' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Square' }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it('when disabled, is announced and takes no press', () => {
    const onToggle = vi.fn();
    render(<Chip label="Wide" isActive={false} isDisabled onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: 'Wide' });
    expect(chip).toHaveProperty('disabled', true);
    fireEvent.click(chip);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('is 24 px with round ends in the caption type, the active one on the pressed surface', () => {
    expect(chipCss).toMatch(/\.chip \{[^}]*height: 24px;[^}]*border-radius: 12px;/);
    expect(chipCss).toMatch(/\.chip \{[^}]*font: var\(--text-caption\);/);
    expect(chipCss).toMatch(
      /\.chip\[aria-pressed='true'\] \{[^}]*background: var\(--color-surface-pressed\);/,
    );
    expect(chipCss).toMatch(/\.chip:disabled \{[^}]*opacity: 0\.38;/);
    // A 48 px target on a touch screen, without growing.
    expect(chipCss).toMatch(
      /@media \(pointer: coarse\) \{\s*\.chip::before \{[^}]*inset: -12px 0;/,
    );
  });
});
