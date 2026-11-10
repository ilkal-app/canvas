// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FontReplacementDialog } from './font-replacement-dialog.js';
import { readFontReplacement, setFontReplacement } from './font-replacement.js';

vi.mock('./page-fonts.js', () => ({
  pageFontStatus: () => 'ready',
  subscribePageFonts: () => () => undefined,
}));
afterEach(() => {
  cleanup();
  setFontReplacement(undefined);
});

it('keeps failed replacement open, then dismisses on a successful explicit choice', async () => {
  const replace = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  setFontReplacement({ owner: {}, families: ['Private Mono'], replace });
  render(<FontReplacementDialog />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Font' }), { target: { value: 'Lora' } });
  expect(await screen.findByRole('status')).toHaveProperty(
    'textContent',
    expect.stringContaining('could not be applied'),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Font' }), { target: { value: 'Inter' } });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(replace.mock.calls).toEqual([['Lora'], ['Inter']]);
});

it('does not reopen or dismiss a later request when a cancelled choice settles', async () => {
  let settle: (value: boolean) => void = () => undefined;
  const pending = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  setFontReplacement({ owner: {}, families: ['Private Mono'], replace: () => pending });
  render(<FontReplacementDialog />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Font' }), { target: { value: 'Lora' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(readFontReplacement()).toBeUndefined();
  await act(async () => {
    settle(true);
    await pending;
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('says a board-wide replacement changes the family everywhere, in one undoable step', () => {
  setFontReplacement({ owner: {}, families: ['Private Mono'], scope: 'board', replace: vi.fn() });
  render(<FontReplacementDialog />);
  expect(screen.getByRole('dialog', { name: 'Replace a missing font' }).textContent).toContain(
    'replaces it everywhere on this board',
  );
});
