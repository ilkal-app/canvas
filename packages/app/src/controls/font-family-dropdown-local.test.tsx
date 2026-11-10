// @vitest-environment jsdom
// Item 6: the font menu's fonts on this computer, through a stubbed Local Font Access.
// Nothing is listed before permission; a press asks; granted families follow a rule and load
// before they are chosen; a family that will not load is disabled; denied and unsupported say so.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  loadLocalFont,
  localFontPermission,
  requestLocalFonts,
  type LocalFontPermission,
} from '../text-input/local-fonts.js';

import { FontFamilyDropdown } from './font-family-dropdown.js';

vi.mock('../text-input/local-fonts.js', () => ({
  localFontPermission: vi.fn(),
  requestLocalFonts: vi.fn(),
  loadLocalFont: vi.fn(),
}));
vi.mock('../text-input/font-preview.js', () => ({ prepareFontPreview: vi.fn() }));

const LIBRARY = ['Liberation Sans', 'Lora'];

beforeEach(() => {
  vi.mocked(requestLocalFonts).mockReset().mockResolvedValue(['Private Mono', 'Lora']);
  vi.mocked(loadLocalFont).mockReset().mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Renders the dropdown with a permission and opens its menu once the permission is read.
 *
 * @param permission - The page's Local Font Access permission.
 * @param onChange - Receives a family chosen.
 * @returns The menu.
 */
async function openWith(
  permission: LocalFontPermission,
  onChange = vi.fn<(family: string) => void>(),
): Promise<HTMLElement> {
  vi.mocked(localFontPermission).mockResolvedValue(permission);
  render(<FontFamilyDropdown value="Lora" families={LIBRARY} onChange={onChange} />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  return screen.getByRole('menu');
}

it('asks only on the press, then offers this computer’s families the library lacks', async () => {
  let menu = await openWith('prompt');
  expect(requestLocalFonts).not.toHaveBeenCalled();
  expect(within(menu).queryByRole('menuitemradio', { name: 'Private Mono' })).toBeNull();
  vi.mocked(localFontPermission).mockResolvedValue('granted');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Show fonts on this computer…' }));
    await Promise.resolve();
  });
  expect(requestLocalFonts).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  menu = screen.getByRole('menu');
  const names = within(menu)
    .getAllByRole('menuitemradio')
    .map((item) => item.textContent);
  expect(names).toEqual(['Liberation Sans', 'Lora', 'Private Mono']);
});

it('loads a local family before choosing it, and disables one that will not load', async () => {
  const onChange = vi.fn<(family: string) => void>();
  const menu = await openWith('granted', onChange);
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Private Mono' }));
    await Promise.resolve();
  });
  expect(loadLocalFont).toHaveBeenCalledWith('Private Mono');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Private Mono');
  vi.mocked(loadLocalFont).mockRejectedValue(new Error('CFF2 is not supported'));
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Private Mono' }),
    );
    await Promise.resolve();
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  const failed = within(screen.getByRole('menu')).getByRole('menuitemradio', {
    name: /Private Mono/,
  });
  expect(failed.getAttribute('aria-disabled')).toBe('true');
});

it.each([
  ['denied', "Fonts on this computer are blocked in this site's settings"],
  ['unsupported', 'Fonts on this computer need Chrome or Edge on a computer'],
] as const)('says why on a disabled row when %s, listing nothing', async (permission, label) => {
  const menu = await openWith(permission);
  expect(within(menu).getByRole('menuitem', { name: label }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  expect(requestLocalFonts).not.toHaveBeenCalled();
});

it('says the fonts are blocked once the person refuses at the browser’s prompt', async () => {
  const menu = await openWith('prompt');
  vi.mocked(requestLocalFonts).mockRejectedValue(new DOMException('No', 'NotAllowedError'));
  vi.mocked(localFontPermission).mockResolvedValue('denied');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Show fonts on this computer…' }));
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  await screen.findByRole('menuitem', { name: /blocked in this site's settings/ });
});

it('reads no font file for a shown local row, which is written in the installed font', async () => {
  const menu = await openWith('granted');
  // Without an IntersectionObserver every row counts as shown at once.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const row = within(menu).getByRole('menuitemradio', { name: /Private Mono/ });
  expect(row.getAttribute('aria-disabled')).not.toBe('true');
  const label = row.querySelector<HTMLElement>('[style*="Private Mono"]');
  expect(label?.style.fontFamily).toMatch(/^"Private Mono",/);
  expect(loadLocalFont).not.toHaveBeenCalled();
});
