// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Chip } from './chip.js';
import chipCss from './chip.module.css?raw';

afterEach(cleanup);

describe('Chip acceptance', () => {
  it.each([
    [false, 'false', true],
    [true, 'true', false],
  ])('reports the opposite state when isActive is %s', (isActive, pressed, isNextActive) => {
    const onToggle = vi.fn();
    render(<Chip label="Square" isActive={isActive} onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: 'Square' });
    expect(chip.getAttribute('aria-pressed')).toBe(pressed);
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(isNextActive);
  });

  it('is a disabled button that ignores presses', () => {
    const onToggle = vi.fn();
    render(<Chip label="Wide" isActive isDisabled onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: 'Wide' });
    expect(chip).toHaveProperty('disabled', true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('provides a 48 px touch target around a 24 px chip and uses theme colours', () => {
    expect(chipCss).toMatch(/\.chip\s*\{[^}]*height:\s*24px;/);
    expect(chipCss).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.chip::before\s*\{[^}]*inset:\s*-12px 0;/,
    );
    expect(chipCss).toMatch(
      /\.chip\[aria-pressed='true'\]\s*\{[^}]*background:\s*var\(--color-surface-pressed\);/,
    );
    expect(chipCss).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});
