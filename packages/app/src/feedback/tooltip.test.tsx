// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tooltip } from './tooltip.js';
import tooltipCss from './tooltip.module.css?raw';

afterEach(cleanup);

describe('Tooltip', () => {
  it('describes its control with its text, the key beside it but not in the description', () => {
    render(
      <Tooltip text="Note" shortcut="N">
        {(id) => (
          <button type="button" aria-describedby={id} aria-keyshortcuts="N">
            Note
          </button>
        )}
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Note' });
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.firstChild?.textContent).toBe('Note');
    const key = tooltip.querySelector('kbd');
    expect(key?.textContent).toBe('N');
    expect(key?.getAttribute('aria-hidden')).toBe('true');
    expect(tooltip.dataset.placement).toBe('above');
  });

  it('shows no key without a shortcut (Show key off), and opens below at the end when asked', () => {
    render(
      <Tooltip text="Pen — not available yet" placement="below-end">
        {(id) => (
          <button type="button" aria-describedby={id} aria-disabled="true">
            Pen
          </button>
        )}
      </Tooltip>,
    );
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toBe('Pen — not available yet');
    expect(tooltip.querySelector('kbd')).toBeNull();
    expect(tooltip.dataset.placement).toBe('below-end');
  });

  it('shows on hover and on keyboard focus, not over a menu its control opened', () => {
    expect(tooltipCss).toMatch(/\.tooltip \{[^}]*display: none;/);
    expect(tooltipCss).toMatch(
      /\.slot:hover > \.tooltip,\s*\.slot:has\(> :focus-visible\) > \.tooltip \{\s*display: inline-flex;/,
    );
    expect(tooltipCss).toMatch(/\.slot:has\(> \[role='menu'\]\) > \.tooltip \{\s*display: none;/);
  });

  it('is the inverse chip of the design: primary ink, the mat’s colour, caption type', () => {
    expect(tooltipCss).toMatch(
      /\.tooltip \{[^}]*background: var\(--color-ink-primary\);[^}]*color: var\(--color-ground-mat\);[^}]*font: var\(--text-caption\);/,
    );
  });
});
