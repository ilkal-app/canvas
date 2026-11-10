// @vitest-environment jsdom
// Focus trap, focus restore and backdrop dismissal with real pointer and keyboard input:
// tooling/scenario/specs/app/cheat-sheet.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { formatChordParts } from '../shortcuts/chord-format.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import { listShortcuts } from '../shortcuts/shortcut-registry.js';

import { ShortcutCheatSheet } from './shortcut-cheat-sheet.js';

function renderSheet(platform: KeyboardPlatform = 'mac') {
  const registry = createDefaultShortcutRegistry(platform);
  const onClose = vi.fn();
  const view = render(<ShortcutCheatSheet registry={registry} onClose={onClose} />);
  return { registry, onClose, view, dialog: screen.getByRole('dialog') };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ShortcutCheatSheet', () => {
  it('is a modal dialog titled Keyboard shortcuts', () => {
    const { dialog } = renderSheet();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBe(dialog);
  });

  it.each(['mac', 'other'] as const)(
    'lists every registered shortcut under its category with its chords (%s)',
    (platform) => {
      const { registry, dialog } = renderSheet(platform);
      for (const group of listShortcuts(registry)) {
        const section = within(dialog).getByRole('region', { name: group.label });
        const rows = section.querySelectorAll('dt');
        expect([...rows].map((row) => row.textContent)).toEqual(
          group.entries.map((entry) => entry.description),
        );
        group.entries.forEach((entry, index) => {
          const chords = rows[index]?.nextElementSibling?.textContent ?? '';
          for (const chord of entry.parsedChords) {
            expect(chords, entry.id).toContain(formatChordParts(chord, platform).join(''));
          }
        });
      }
    },
  );

  it('writes chords the mac way on mac and with words elsewhere', () => {
    const mac = renderSheet('mac').dialog;
    expect(within(mac).getByText('Redo').nextElementSibling?.textContent).toBe('⇧⌘Z');
    cleanup();
    const other = renderSheet('other').dialog;
    expect(within(other).getByText('Redo').nextElementSibling?.textContent).toBe('CtrlShiftZ');
  });

  it('separates alternative chords with "or"', () => {
    const { dialog } = renderSheet('other');
    expect(within(dialog).getByText('Delete').nextElementSibling?.textContent).toBe(
      'DelorBackspace',
    );
  });

  it('moves focus to the Close button when it opens', () => {
    renderSheet();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('returns focus to where it was when it closes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { view } = renderSheet();
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it.each([
    { key: 'Escape', code: 'Escape', shiftKey: false },
    { key: '?', code: 'Slash', shiftKey: true },
  ])('closes on $key and keeps the key from the canvas', (keyInit) => {
    const { onClose, dialog } = renderSheet();
    const isNotCancelled = fireEvent.keyDown(dialog, keyInit);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(isNotCancelled).toBe(false);
  });

  it('ignores an auto-repeated ?, so holding it does not open then close the sheet', () => {
    const { onClose, dialog } = renderSheet();
    fireEvent.keyDown(dialog, { key: '?', code: 'Slash', shiftKey: true, repeat: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('takes focus itself when dead space inside it is clicked, so Escape still closes it', () => {
    const { onClose, dialog } = renderSheet();
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    dialog.focus();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside when the dialog itself has focus', () => {
    const { dialog } = renderSheet();
    const close = screen.getByRole('button', { name: 'Close' });
    const list = dialog.querySelector<HTMLElement>('[tabindex="0"]');
    dialog.focus();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(list);
    dialog.focus();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('closes from the Close button', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a press on the backdrop but not inside the dialog', () => {
    const { onClose, dialog } = renderSheet();
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = dialog.parentElement;
    if (backdrop === null) throw new Error('The dialog has no backdrop');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog', () => {
    const { dialog } = renderSheet();
    const close = screen.getByRole('button', { name: 'Close' });
    const list = dialog.querySelector<HTMLElement>('[tabindex="0"]');
    list?.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(list);
  });
});
