// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog, type DialogProps } from './dialog.js';
import dialogCss from './dialog.module.css?raw';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/**
 * Renders a dialog with a field, a select, a link and a button inside.
 *
 * @param props - Props to change.
 * @returns The close handler and the render's result.
 */
function renderDialog(props: Partial<DialogProps> = {}) {
  const onClose = vi.fn();
  const view = render(
    <Dialog title="Share “Plans”" onClose={onClose} {...props}>
      <input aria-label="Email address" />
      <select aria-label="Role">
        <option>Editor</option>
      </select>
      <a href="/">Home</a>
      <button type="button">Invite</button>
    </Dialog>,
  );
  return { onClose, view, dialog: screen.getByRole('dialog') };
}

describe('Dialog', () => {
  it('is a modal dialog named by its title', () => {
    const { dialog } = renderDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Share “Plans”' })).toBe(dialog);
    expect(screen.getByRole('heading', { level: 2, name: 'Share “Plans”' })).toBeTruthy();
  });

  it('moves focus to its Close button when it opens', () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('moves focus to the element it is given when it opens', () => {
    /**
     * A dialog that focuses its field first.
     *
     * @returns The dialog.
     */
    function FocusField() {
      const fieldRef = useRef<HTMLInputElement>(null);
      return (
        <Dialog title="Rename" onClose={() => undefined} initialFocusRef={fieldRef}>
          <input ref={fieldRef} aria-label="Title" />
        </Dialog>
      );
    }
    render(<FocusField />);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }));
  });

  it('returns focus to where it was when it closes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { view } = renderDialog();
    expect(document.activeElement).not.toBe(opener);
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape, from a field too, and keeps the key from the page', () => {
    const { onClose } = renderDialog();
    const field = screen.getByRole('textbox', { name: 'Email address' });
    const isNotCancelled = fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(isNotCancelled).toBe(false);
  });

  it('closes once for a held Escape', () => {
    const { onClose, dialog } = renderDialog();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', repeat: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on another key it is given', () => {
    const isCloseKey = (event: KeyboardEvent<HTMLElement>) => event.key === '?';
    const { onClose, dialog } = renderDialog({ isCloseKey });
    fireEvent.keyDown(dialog, { key: 'a', code: 'KeyA' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: '?', code: 'Slash', shiftKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps every key press inside from the page’s own listeners (the canvas shortcuts)', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      renderDialog();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Invite' }), { key: 'Delete' });
      fireEvent.keyDown(screen.getByRole('button', { name: 'Invite' }), { key: 'r' });
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('closes from its Close button', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a press on the backdrop but not inside the dialog', () => {
    const { onClose, dialog } = renderDialog();
    fireEvent.mouseDown(dialog);
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Email address' }));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = dialog.parentElement;
    if (backdrop === null) throw new Error('The dialog has no backdrop');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside, over fields, selects and links as well as buttons', () => {
    const { dialog } = renderDialog();
    const close = screen.getByRole('button', { name: 'Close' });
    const invite = screen.getByRole('button', { name: 'Invite' });
    invite.focus();
    fireEvent.keyDown(invite, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(invite);
    // Between the ends, Tab is the browser's.
    const field = screen.getByRole('textbox', { name: 'Email address' });
    field.focus();
    expect(fireEvent.keyDown(field, { key: 'Tab', code: 'Tab' })).toBe(true);
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('skips disabled controls when keeping Tab inside', () => {
    render(
      <Dialog title="Share" onClose={() => undefined}>
        <button type="button">Invite</button>
        <button type="button" disabled>
          Resend
        </button>
      </Dialog>,
    );
    const invite = screen.getByRole('button', { name: 'Invite' });
    invite.focus();
    fireEvent.keyDown(invite, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('skips a control that is not rendered, as the page form hides Close', () => {
    render(
      <Dialog title="Board settings" onClose={() => undefined} compact="page">
        <input aria-label="Name" />
        <button type="button">Save</button>
      </Dialog>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    close.checkVisibility = () => false;
    const name = screen.getByRole('textbox', { name: 'Name' });
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(name);
    fireEvent.keyDown(name, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('takes focus itself when dead space inside it is clicked, so Escape still closes it', () => {
    const { onClose, dialog } = renderDialog();
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes focus itself when the focused element goes away, so Escape still closes it', async () => {
    /**
     * A dialog whose button removes itself, as Remove removes its person's row.
     *
     * @param props - The close handler.
     * @param props.onClose - Called on close.
     * @returns The dialog.
     */
    function Vanishing(props: { readonly onClose: () => void }) {
      const [isShown, setShown] = useState(true);
      return (
        <Dialog title="Share" onClose={props.onClose}>
          {isShown ? (
            <button
              type="button"
              onClick={() => {
                setShown(false);
              }}
            >
              Remove
            </button>
          ) : null}
        </Dialog>
      );
    }
    const onClose = vi.fn();
    render(<Vanishing onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    const remove = screen.getByRole('button', { name: 'Remove' });
    remove.focus();
    fireEvent.click(remove);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(dialog);
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes focus back on the next frame when the browser drops it from a disabled control', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      /**
       * A dialog whose button is disabled while its action runs, as Invite and Resend are.
       *
       * @returns The dialog.
       */
      function Busy() {
        const [isBusy, setBusy] = useState(false);
        return (
          <Dialog title="Share" onClose={() => undefined}>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setBusy(true);
              }}
            >
              Resend
            </button>
          </Dialog>
        );
      }
      render(<Busy />);
      const dialog = screen.getByRole('dialog');
      const resend = screen.getByRole('button', { name: 'Resend' });
      resend.focus();
      fireEvent.click(resend);
      // The observer's microtask runs while the disabled control still holds focus.
      await Promise.resolve();
      expect(document.activeElement).toBe(resend);
      // Then the browser's focus fix-up drops focus to the body (jsdom has none, so the test
      // plays it by what the document reports).
      const activeElement = vi
        .spyOn(document, 'activeElement', 'get')
        .mockReturnValue(document.body);
      vi.advanceTimersToNextFrame();
      activeElement.mockRestore();
      expect(document.activeElement).toBe(dialog);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks how it shows below 768 px wide, a sheet or a page, on it and its backdrop', () => {
    const { dialog, view } = renderDialog();
    expect(dialog.hasAttribute('data-compact')).toBe(false);
    view.unmount();
    for (const compact of ['sheet', 'page'] as const) {
      const { dialog: shown, view: next } = renderDialog({ compact });
      expect(shown.getAttribute('data-compact')).toBe(compact);
      expect(shown.parentElement?.getAttribute('data-compact')).toBe(compact);
      next.unmount();
    }
    // Only below 768 px wide: wider, both are the centred dialog. A page's own actions hide Close.
    const narrow = /@media \(width < 768px\) \{([\s\S]*)\}\s*$/.exec(dialogCss)?.[1] ?? '';
    expect(narrow).toContain(".dialog[data-compact='sheet']");
    expect(narrow).toContain(".dialog[data-compact='page']:has([data-dialog-actions]) .close");
    expect(dialogCss.split('@media (width < 768px)')[0]).not.toContain('data-compact');
  });
});
