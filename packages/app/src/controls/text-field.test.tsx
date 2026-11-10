// @vitest-environment jsdom
// The shared text field's states (the control states sheet, 35:1786; UI-18 item 1).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextField } from './text-field.js';
import fieldCss from './text-field.module.css?raw';

afterEach(cleanup);

/**
 * The CSS of every rule whose selector contains a fragment, joined.
 *
 * @param fragment - Part of the selector.
 * @returns The rules' bodies.
 */
function rulesFor(fragment: string): string {
  return [...fieldCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector = '']) => selector.includes(fragment))
    .map(([, , body = '']) => body)
    .join('\n');
}

describe('TextField', () => {
  it('is empty with its placeholder, labelled, and valid', () => {
    render(
      <TextField label="Description" value="" placeholder="Add a description" onChange={vi.fn()} />,
    );
    const field = screen.getByRole('textbox', { name: 'Description' });
    expect(field.getAttribute('placeholder')).toBe('Add a description');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(field.getAttribute('aria-describedby')).toBeNull();
    expect(rulesFor('::placeholder')).toContain('color: var(--color-ink-faint)');
  });

  it('is filled, and gives each edit to its handler', () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<TextField label="Name" value="Q4 launch pl" onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field).toHaveProperty('value', 'Q4 launch pl');
    fireEvent.change(field, { target: { value: 'Q4 launch plan' } });
    expect(onChange).toHaveBeenCalledWith('Q4 launch plan');
  });

  it('in error, is invalid and described by the message that says how to fix it', () => {
    render(
      <TextField
        label="Email"
        type="email"
        value="sam@exmple"
        error="Enter a full email address"
        onChange={vi.fn()}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Email' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const message = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(message?.textContent).toBe('Enter a full email address');
    expect(message?.getAttribute('aria-live')).toBe('polite');
    expect(rulesFor("[aria-invalid='true']")).toContain(
      'border-color: var(--color-mark-red-pencil)',
    );
  });

  it('when disabled, is announced as disabled, faded to 38% with no hover', () => {
    render(<TextField label="Name" value="Q4 launch plan" isDisabled onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('disabled', true);
    expect(rulesFor('.input:disabled')).toContain('opacity: 0.38');
    expect(fieldCss).toMatch(/\.input:hover:not\(:disabled\)/);
  });

  it('on hover strengthens its edge; on focus shows the hand-colour caret and the ring outside', () => {
    expect(rulesFor('.input:hover')).toContain('border-color: var(--color-ink-secondary)');
    expect(fieldCss).toMatch(
      /\.input \{[^}]*height: 36px;[^}]*caret-color: var\(--color-hand-you\);/,
    );
    expect(rulesFor(':focus-visible')).toContain('outline: 2px solid var(--color-focus-ring)');
    expect(rulesFor(':focus-visible')).toContain('outline-offset: 2px');
  });
});
