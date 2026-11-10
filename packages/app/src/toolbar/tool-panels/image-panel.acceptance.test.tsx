// @vitest-environment jsdom
// Image panel interaction through the floating dock host.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFloatingShortcutRegistry } from '../../keymap/floating-keymap.js';
import { INITIAL_SHELL_STATE } from '../../state/shell-reducer.js';
import { FloatingDock } from '../floating-dock.js';

import { ImagePanelActionsProvider, type ImagePanelActions } from './image-panel-actions.js';
import { toolPanel } from './image-panel.js';
import { toolPanelsOf } from './tool-panel-contribution.js';

const REGISTRY = createFloatingShortcutRegistry('mac');
const PANELS = toolPanelsOf([toolPanel]);

/**
 * Renders the Image panel in its real floating host with replaceable page actions.
 *
 * @param actions - The page actions, if images are available.
 * @returns The rendered panel.
 */
function renderPanel(actions?: ImagePanelActions) {
  const view = render(
    <ImagePanelActionsProvider value={actions}>
      <FloatingDock
        registry={REGISTRY}
        state={{ ...INITIAL_SHELL_STATE, toolPanelRequest: { panel: 'image', sequence: 1 } }}
        dispatch={vi.fn()}
        panels={PANELS}
      />
    </ImagePanelActionsProvider>,
  );
  return { view, panel: screen.getByRole('toolbar', { name: 'Image options' }) };
}

/**
 * Fake page actions whose calls can be asserted independently of the panel UI.
 *
 * @returns The actions and their spies.
 */
function fakeActions() {
  const upload = vi.fn();
  const fromLink = vi.fn(() => Promise.resolve(true));
  const actions: ImagePanelActions = { upload, fromLink };
  return { actions, upload, fromLink };
}

afterEach(() => {
  cleanup();
});

describe('Image panel', () => {
  it('opens the hidden multi-image picker and passes the selected files', () => {
    const { actions, upload } = fakeActions();
    const { panel } = renderPanel(actions);
    const input = within(panel).getByLabelText<HTMLInputElement>('Images to upload');
    expect(input.hidden).toBe(true);
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp,image/avif');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(within(panel).getByRole('button', { name: 'Upload' }));
    expect(click).toHaveBeenCalledOnce();
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.webp', { type: 'image/webp' }),
    ];
    fireEvent.change(input, { target: { files } });
    expect(upload).toHaveBeenCalledWith(files);
  });

  it('submits a link with Enter or Add, clears success, retains failure, and ignores empty input', async () => {
    const { actions, fromLink } = fakeActions();
    const { panel } = renderPanel(actions);
    const fromLinkButton = within(panel).getByRole('button', { name: 'From link' });
    expect(fromLinkButton.getAttribute('aria-expanded')).toBe('false');
    expect(within(panel).queryByRole('textbox', { name: 'Image link' })).toBeNull();
    fireEvent.click(fromLinkButton);
    expect(fromLinkButton.getAttribute('aria-expanded')).toBe('true');
    const field = within(panel).getByRole<HTMLInputElement>('textbox', { name: 'Image link' });
    expect(document.activeElement).toBe(field);
    fireEvent.click(fromLinkButton);
    expect(fromLinkButton.getAttribute('aria-expanded')).toBe('false');
    expect(within(panel).queryByRole('textbox', { name: 'Image link' })).toBeNull();
    fireEvent.click(fromLinkButton);
    expect(fromLinkButton.getAttribute('aria-expanded')).toBe('true');
    const reopenedField = within(panel).getByRole<HTMLInputElement>('textbox', {
      name: 'Image link',
    });
    const add = within(panel).getByRole('button', { name: 'Add' });
    expect(reopenedField.type).toBe('url');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(add);
    expect(fromLink).not.toHaveBeenCalled();
    fireEvent.change(reopenedField, { target: { value: 'https://example.test/one.png' } });
    const form = reopenedField.closest('form');
    if (form === null) throw new Error('Image link form missing');
    fireEvent.submit(form);
    await waitFor(() => {
      expect(reopenedField.value).toBe('');
    });
    expect(fromLink).toHaveBeenCalledWith('https://example.test/one.png');
    fromLink.mockResolvedValueOnce(false);
    fireEvent.change(reopenedField, { target: { value: 'https://example.test/two.png' } });
    fireEvent.click(add);
    await waitFor(() => {
      expect(fromLink).toHaveBeenCalledTimes(2);
    });
    expect(reopenedField.value).toBe('https://example.test/two.png');
  });

  it('shows Upload and From link alone: Recent is not in v1 (the owner’s ruling, 2026-10-21)', () => {
    const { panel } = renderPanel(fakeActions().actions);
    expect(
      within(panel)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Upload', 'From link']);
    expect(within(panel).queryByRole('group', { name: 'Recent images' })).toBeNull();
    expect(within(panel).queryByText('Recent')).toBeNull();
  });

  it('keeps every panel item in the arrow loop while typing stays in the link field', () => {
    const { panel } = renderPanel(fakeActions().actions);
    const fromLink = within(panel).getByRole('button', { name: 'From link' });
    fireEvent.click(fromLink);
    const field = within(panel).getByRole('textbox', { name: 'Image link' });
    const items = [
      within(panel).getByRole('button', { name: 'Upload' }),
      fromLink,
      within(panel).getByRole('button', { name: 'Add' }),
    ];
    expect([...panel.querySelectorAll('[data-dock-item]')]).toEqual(items);
    expect([...panel.querySelectorAll('button, input[type="url"]')]).toEqual([
      items[0],
      fromLink,
      field,
      ...items.slice(2),
    ]);
    items[0]?.focus();
    for (const [index, item] of items.entries()) {
      expect(document.activeElement).toBe(item);
      if (index + 1 < items.length) {
        fireEvent.keyDown(item, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(items[index + 1]);
      }
    }
    const last = items.at(-1);
    if (last === undefined) throw new Error('Last panel item missing');
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    field.focus();
    fireEvent.keyDown(field, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(field);
  });

  it('explains when image actions are unavailable', () => {
    const { panel } = renderPanel();
    expect(within(panel).getByText('Images can’t be added here')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Upload' })).toBeNull();
  });
});
