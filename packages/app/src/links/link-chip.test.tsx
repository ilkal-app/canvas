// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LINK_INVALID_MESSAGE } from '../selection-popover/popover-link.js';

import { LinkChip, type LinkChipProps } from './link-chip.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LINK = 'https://example.com/roadmap';

/**
 * Renders a chip with spies for its callbacks.
 *
 * @param overrides - Props to change.
 * @returns The spies.
 */
function chip(overrides: Partial<LinkChipProps> = {}) {
  const props = {
    onCopy: vi.fn(),
    onApply: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
  };
  render(<LinkChip link={LINK} left={10} top={20} isTouch={false} {...props} {...overrides} />);
  return props;
}

describe('LinkChip', () => {
  it('shows the address as plain text, never a link the page follows', () => {
    chip();
    const toolbar = screen.getByRole('toolbar', { name: 'Link' });
    expect(toolbar.querySelector('[data-link-chip-address]')?.textContent).toBe(
      'example.com/roadmap',
    );
    expect(toolbar.querySelector('a')).toBeNull();
    expect(toolbar.querySelector('[data-link-chip-address]')?.getAttribute('title')).toBe(LINK);
  });

  it('opens the link in a new tab with no opener or referrer, then closes', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { onClose } = chip();
    fireEvent.click(screen.getByRole('button', { name: `Open ${LINK}` }));
    expect(open).toHaveBeenCalledExactlyOnceWith(LINK, '_blank', 'noopener,noreferrer');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('opens nothing for a link normalizeLink would change', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    chip({ link: 'javascript:alert(1)' });
    fireEvent.click(screen.getByRole('button', { name: 'Open javascript:alert(1)' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('copies', () => {
    const { onCopy } = chip();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('edits the link in place, refusing an unsafe address', () => {
    const { onApply, onClose } = chip();
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Link address' });
    expect(field.value).toBe(LINK);
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe(LINK_INVALID_MESSAGE);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'HTTPS://Example.com/b' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledExactlyOnceWith('https://example.com/b');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('removes from the edit dialog, and shows Remove in the row only when asked', () => {
    const { onRemove } = chip();
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(onRemove).toHaveBeenCalledOnce();
    cleanup();
    const shown = chip({ hasRemoveButton: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(shown.onRemove).toHaveBeenCalledOnce();
  });

  it('offers no Edit to a person who cannot edit', () => {
    chip({ onApply: undefined, onRemove: undefined });
    expect(screen.queryByRole('button', { name: 'Edit link' })).toBeNull();
    expect(screen.getByRole('button', { name: `Open ${LINK}` })).toBeTruthy();
  });

  it('closes on Escape', () => {
    const { onClose } = chip();
    fireEvent.keyDown(screen.getByRole('toolbar', { name: 'Link' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("marks a finger's chip for its 44 px targets", () => {
    chip({ isTouch: true });
    expect(screen.getByRole('toolbar', { name: 'Link' }).hasAttribute('data-touch')).toBe(true);
  });
});
