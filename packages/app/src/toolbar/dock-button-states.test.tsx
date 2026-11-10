// @vitest-environment jsdom
// The dock tool button's states (the control states sheet, 35:1786, "Dock tool button"; UI-18
// item 1 and its sizes): hover with its tooltip, default, active, focus and not built yet, all
// a 40 px square with 6 px corners and its 24 px icon centred,
// the focus ring 2 px outside it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCALE_TOKENS } from '../theme/scale-tokens.js';

import { DockButton } from './dock-button.js';
import dockCss from './dock.module.css?raw';

afterEach(cleanup);

/**
 * The CSS of every rule whose selector list holds a selector starting with `.button`, by
 * selector.
 *
 * @returns Each rule's selector and body.
 */
function buttonRules(): [string, string][] {
  return [...dockCss.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector = '', body = '']): [string, string] => [selector.trim(), body])
    .filter(([selector]) => selector.split(',').some((part) => part.trim().startsWith('.button')));
}

/**
 * Renders one dock button.
 *
 * @param state - Whether its tool is active and whether it is built.
 * @param state.isPressed - Whether its tool is the active one.
 * @param state.isAvailable - Whether its feature exists.
 * @returns The button and its action.
 */
function renderButton(state: { isPressed: boolean; isAvailable: boolean }) {
  const onSelect = vi.fn<() => void>();
  render(
    <DockButton
      label={state.isAvailable ? 'Note' : 'Pen'}
      icon={state.isAvailable ? 'note' : 'pen'}
      hint={{ label: 'N', ariaKeyShortcuts: 'N' }}
      isPressed={state.isPressed}
      isAvailable={state.isAvailable}
      onSelect={onSelect}
    />,
  );
  return { button: screen.getByRole('button'), onSelect };
}

describe('the dock tool button’s states', () => {
  it('default: not pressed, its tooltip the tool’s name and key, which describes it', () => {
    const { button, onSelect } = renderButton({ isPressed: false, isAvailable: true });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    const tooltip = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.firstChild?.textContent).toBe('Note');
    expect(tooltip?.querySelector('kbd')?.textContent).toBe('N');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('active: pressed', () => {
    const { button } = renderButton({ isPressed: true, isAvailable: true });
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('not built yet: disabled but focusable, "<Tool> — not available yet", doing nothing', () => {
    const { button, onSelect } = renderButton({ isPressed: false, isAvailable: false });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button).toHaveProperty('disabled', false);
    expect(button.getAttribute('aria-label')).toBe('Pen — not available yet');
    const tooltip = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(tooltip?.textContent).toBe('Pen — not available yet');
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is a 40 px square with 6 px corners, and no state changes its size or corners', () => {
    const base = buttonRules().find(([selector]) => selector === '.button')?.[1] ?? '';
    expect(base).toMatch(/width: 40px;/);
    expect(base).toMatch(/height: 40px;/);
    // Its icon centred in it, the square's padding none: (40 − 24) / 2 = 8 px each side.
    expect(base).toMatch(/align-items: center;/);
    expect(base).toMatch(/justify-content: center;/);
    expect(base).toMatch(/padding: 0;/);
    expect(base).toMatch(/border-radius: var\(--radius-sheet\);/);
    expect(SCALE_TOKENS['--radius-sheet']).toBe('6px');
    for (const [selector, body] of buttonRules()) {
      if (selector === '.button') continue;
      expect(body, selector).not.toMatch(/\b(?:width|height|border-radius|padding):/);
    }
  });

  it.each([
    { isPressed: false, isAvailable: true },
    { isPressed: true, isAvailable: true },
    { isPressed: false, isAvailable: false },
  ])('draws its icon 24 px with the 1.5 px stroke, whatever its state (%o)', (state) => {
    const { button } = renderButton(state);
    const icons = button.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute('width')).toBe('24');
    expect(icons[0]?.getAttribute('height')).toBe('24');
    expect(icons[0]?.querySelector('path')?.getAttribute('stroke-width')).toBe('1.5');
    expect(icons[0]?.querySelector('path')?.getAttribute('vector-effect')).toBe(
      'non-scaling-stroke',
    );
  });

  it('keeps a flyout group’s caret in the 40 px square’s corner, whatever the icon’s size', () => {
    const rules = new Map(
      [...dockCss.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
        ([, selector = '', body = '']) => [selector.trim(), body],
      ),
    );
    // The caret is placed in the button's slot, as big as the button, not against the icon.
    expect(rules.get('.slot')).toMatch(/position: relative;/);
    expect(rules.get('.caret')).toMatch(/right: 3px;\s*bottom: 3px;/);
  });

  it('draws hover, active and focus: the raised surface, the pressed surface, the ring 2 px out', () => {
    const rules = new Map(buttonRules());
    expect(rules.get('.button:hover')).toMatch(/background: var\(--color-surface-raised\)/);
    expect(rules.get(".button[aria-pressed='true']")).toMatch(
      /background: var\(--color-surface-pressed\)/,
    );
    const focus = [...rules].find(([selector]) => selector.includes('.button:focus-visible'));
    expect(focus?.[1]).toMatch(/outline: 2px solid var\(--color-focus-ring\);/);
    expect(focus?.[1]).toMatch(/outline-offset: 2px;/);
    expect(rules.get(".button[aria-disabled='true']:hover")).toMatch(/background: transparent/);
  });
});
