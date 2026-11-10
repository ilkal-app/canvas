// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { LocalFontPicker } from './local-font-picker.js';
import { requestLocalFonts, supportsLocalFonts } from './local-fonts.js';

vi.mock('./local-fonts.js', () => ({
  supportsLocalFonts: vi.fn(() => true),
  requestLocalFonts: vi.fn(() => Promise.resolve(['Private Mono', 'CFF Font'])),
  loadLocalFont: (family: string) =>
    family === 'CFF Font' ? Promise.reject(new Error('CFF')) : Promise.resolve(),
}));
vi.mock('./font-preview.js', () => ({ prepareFontPreview: () => Promise.resolve() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('asks permission only on a click and disables unsupported faces', async () => {
  const choose = vi.fn();
  render(<LocalFontPicker choose={choose} />);
  expect(requestLocalFonts).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Allow local fonts' }));
  await waitFor(() => {
    expect(screen.getByText('Unavailable — static TrueType or CFF required')).toBeDefined();
  });
  expect(screen.getByRole('button', { name: /CFF Font/ }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Private Mono/ }));
  expect(choose).toHaveBeenCalledWith('Private Mono');
});
it('explains browsers without local font access', () => {
  vi.mocked(supportsLocalFonts).mockReturnValueOnce(false);
  render(<LocalFontPicker choose={() => undefined} />);
  expect(screen.getByText(/This browser cannot access installed fonts/)).toBeDefined();
  expect(requestLocalFonts).not.toHaveBeenCalled();
});

it('retries denied permission and searches beyond the first visible page', async () => {
  vi.mocked(requestLocalFonts)
    .mockRejectedValueOnce(new Error('Permission denied'))
    .mockResolvedValueOnce(
      Array.from({ length: 10 }, (unused, index) => `Private ${String(index)}`),
    );
  const choose = vi.fn();
  render(<LocalFontPicker choose={choose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Allow local fonts' }));
  expect(await screen.findByRole('status')).toHaveProperty(
    'textContent',
    expect.stringContaining('not granted'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Allow local fonts' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show more installed fonts' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Use Private 9' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'PRIVATE 9' } });
  expect(screen.queryByRole('button', { name: /Private 0/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Private 9/ }));
  expect(choose).toHaveBeenCalledWith('Private 9');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'not installed' } });
  expect(screen.getByText('No installed fonts match.')).toBeDefined();
});
