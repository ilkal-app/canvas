// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FontPicker } from './font-picker.js';
import { isLocalFamily } from './local-fonts.js';

vi.mock('./local-fonts.js', () => ({
  isLocalFamily: vi.fn((family: string) => family === 'Private Mono'),
  supportsLocalFonts: () => false,
}));
vi.mock('./page-fonts.js', () => ({
  pageFontStatus: () => 'ready',
  ensurePageFont: () => Promise.resolve(true),
  subscribePageFonts: () => () => undefined,
}));
afterEach(cleanup);

it('marks a selected local family while keeping its stored value', () => {
  render(<FontPicker value="Private Mono" onChange={() => undefined} />);
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Font' });
  expect(isLocalFamily).toHaveBeenCalledWith('Private Mono');
  expect(select.value).toBe('Private Mono');
  expect(select.selectedOptions[0]?.textContent).toBe('Private Mono (on this computer)');
});

it('keeps the bundled family label unchanged', () => {
  render(<FontPicker value="Liberation Sans" onChange={() => undefined} />);
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Font' });
  expect(select.value).toBe('Liberation Sans');
  expect(select.selectedOptions[0]?.textContent).toBe('Liberation Sans');
});
