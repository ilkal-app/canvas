// @vitest-environment jsdom
// The shared button's states (the control states sheet, 35:1786; UI-18 items 1 and 2).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, type ButtonKind } from './button.js';
import buttonCss from './button.module.css?raw';

afterEach(cleanup);

const KINDS: readonly ButtonKind[] = ['primary', 'secondary', 'ghost', 'danger'];

/**
 * The CSS of every rule whose selector contains a fragment, joined.
 *
 * @param fragment - Part of the selector.
 * @returns The rules' bodies.
 */
function rulesFor(fragment: string): string {
  return [...buttonCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector = '']) => selector.includes(fragment))
    .map(([, , body = '']) => body)
    .join('\n');
}

describe('Button', () => {
  it.each(KINDS)('runs its action on a press by default, as a %s button', (kind) => {
    const onClick = vi.fn<() => void>();
    render(
      <Button kind={kind} onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.dataset.kind).toBe(kind);
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is secondary when no kind is given', () => {
    render(<Button>Duplicate</Button>);
    expect(screen.getByRole('button', { name: 'Duplicate' }).dataset.kind).toBe('secondary');
  });

  it('when disabled, is announced as disabled and does nothing', () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button isDisabled onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('when busy, says what is happening after a spinner, keeps focus and takes no second press', () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button kind="primary" busyLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button.textContent).toBe('Saving…');
    expect(button.querySelector('[data-spinner]')?.getAttribute('data-size')).toBe('14');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Not natively disabled, so focus stays on it while it works.
    expect(button).toHaveProperty('disabled', false);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('when busy, keeps focus even where its caller also disables it (Invite)', () => {
    render(
      <Button kind="primary" isDisabled busyLabel="Inviting…">
        Invite
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Inviting…' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('when busy in a form, does not submit it again', () => {
    const onSubmit = vi.fn((event: Event) => {
      event.preventDefault();
    });
    render(
      <form
        aria-label="Name"
        onSubmit={(event) => {
          onSubmit(event.nativeEvent);
        }}
      >
        <Button kind="primary" type="submit" busyLabel="Creating…">
          Create board
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Creating…' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('when its feature is not built, says so in its name and tooltip and does nothing', () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button isAvailable={false} onClick={onClick}>
        Duplicate
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Duplicate — not available yet' });
    expect(button.getAttribute('title')).toBe('Duplicate — not available yet');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('takes a name that says what it acts on, and a description', () => {
    render(
      <>
        <Button name="Remove Grace Hopper" describedBy="hint">
          Remove
        </Button>
        <span id="hint">Removes their access</span>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Remove Grace Hopper' });
    expect(button.getAttribute('aria-describedby')).toBe('hint');
  });

  it('is 32 px tall with the control’s corners and Label type', () => {
    expect(buttonCss).toMatch(
      /\.button \{[^}]*height: 32px;[^}]*border-radius: var\(--radius-control\);[^}]*font: var\(--text-label\);/,
    );
  });

  it('draws hover and pressed for each kind, and no hover while disabled', () => {
    expect(rulesFor("[data-kind='primary']:hover")).toContain('opacity: 0.88');
    expect(rulesFor("[data-kind='primary']:active")).toContain(
      'background: var(--color-ink-secondary)',
    );
    expect(rulesFor("[data-kind='secondary']:hover")).toContain(
      'background: var(--color-surface-pressed)',
    );
    expect(rulesFor("[data-kind='ghost']:hover")).toContain(
      'background: var(--color-surface-raised)',
    );
    expect(rulesFor("[data-kind='danger']:active")).toContain(
      'background: var(--color-surface-pressed)',
    );
    for (const selector of buttonCss.match(/[^{}]*:(?:hover|active)[^{}]*\{/g) ?? []) {
      expect(selector).toContain(":not(:disabled, [aria-disabled='true'])");
    }
  });

  it('rings keyboard focus 2 px outside, fades disabled to 38%, keeps a busy button’s look', () => {
    expect(rulesFor(':focus-visible')).toContain('outline: 2px solid var(--color-focus-ring)');
    expect(rulesFor(':focus-visible')).toContain('outline-offset: 2px');
    expect(rulesFor('.button:disabled')).toContain('opacity: 0.38');
    expect(rulesFor("[aria-busy='true']")).toContain('opacity: 1');
  });
});
