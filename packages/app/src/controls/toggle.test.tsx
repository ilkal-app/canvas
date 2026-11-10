// @vitest-environment jsdom
// The shared toggle's states (the control states sheet, 35:1786; UI-18 item 1).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toggle } from './toggle.js';
import toggleCss from './toggle.module.css?raw';

afterEach(cleanup);

/**
 * The CSS of every rule whose selector contains a fragment, joined.
 *
 * @param fragment - Part of the selector.
 * @returns The rules' bodies.
 */
function rulesFor(fragment: string): string {
  return [...toggleCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector = '']) => selector.includes(fragment))
    .map(([, , body = '']) => body)
    .join('\n');
}

describe('Toggle', () => {
  it('is a switch named by its label, off then on', () => {
    const onChange = vi.fn<(isOn: boolean) => void>();
    const { rerender } = render(<Toggle label="Snap to grid" isOn={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Snap to grid' });
    expect(toggle).toHaveProperty('checked', false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Toggle label="Snap to grid" isOn onChange={onChange} />);
    expect(screen.getByRole('switch', { name: 'Snap to grid' })).toHaveProperty('checked', true);
  });

  it('takes the screen’s own label and hint', () => {
    render(
      <>
        <label htmlFor="agents">Agents can edit</label>
        <Toggle id="agents" describedBy="hint" isOn onChange={vi.fn()} />
        <span id="hint">While off, agents only read.</span>
      </>,
    );
    const toggle = screen.getByRole('switch', { name: 'Agents can edit' });
    expect(toggle.getAttribute('aria-describedby')).toBe('hint');
  });

  it('when disabled, is announced as disabled, faded to 38%', () => {
    render(<Toggle label="Snap" isOn isDisabled onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Snap' })).toHaveProperty('disabled', true);
    expect(rulesFor(':disabled')).toContain('opacity: 0.38');
  });

  it('is a 32 × 18 track: off pressed with a faint knob, on the action fill, focus ringed', () => {
    expect(toggleCss).toMatch(
      /\.toggle \{[^}]*width: 32px;[^}]*height: 18px;[^}]*background: var\(--color-surface-pressed\);/,
    );
    expect(rulesFor('.toggle::before')).toContain('background: var(--color-ink-faint)');
    expect(toggleCss).toMatch(/\.toggle:checked \{[^}]*background: var\(--color-action-fill\);/);
    expect(rulesFor(':focus-visible')).toContain('outline: 2px solid var(--color-focus-ring)');
    expect(rulesFor(':focus-visible')).toContain('outline-offset: 2px');
    expect(toggleCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.toggle::before \{\s*transition: none;/,
    );
  });
});
