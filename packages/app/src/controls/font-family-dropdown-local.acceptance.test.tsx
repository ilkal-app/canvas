// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { prepareFontPreview } from '../text-input/font-preview.js';
import {
  loadLocalFont,
  localFontPermission,
  requestLocalFonts,
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
  vi.mocked(localFontPermission).mockReset().mockResolvedValue('granted');
  vi.mocked(requestLocalFonts)
    .mockReset()
    .mockResolvedValue(['Private Mono', 'Other Private', 'Lora']);
  vi.mocked(loadLocalFont).mockReset().mockResolvedValue();
  vi.mocked(prepareFontPreview).mockReset().mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openMenu(onChange = vi.fn<(family: string) => void>()): Promise<HTMLElement> {
  render(<FontFamilyDropdown value="Lora" families={LIBRARY} onChange={onChange} />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  return screen.getByRole('menu');
}

it('renders local labels in their installed system family without reading bytes as rows appear or scroll', async () => {
  const menu = await openMenu();
  for (const family of ['Private Mono', 'Other Private']) {
    const row = within(menu).getByRole('menuitemradio', { name: family });
    const label = row.querySelector<HTMLElement>('[data-menu-label]');
    expect(label?.style.fontFamily).toBe(`${JSON.stringify(family)}, var(--font-ui)`);
    fireEvent.scroll(menu);
    fireEvent.scroll(row);
  }
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(loadLocalFont).not.toHaveBeenCalled();
});

it('keeps the library row preview family while local rows use system families', async () => {
  const menu = await openMenu();
  const library = within(menu).getByRole('menuitemradio', { name: 'Liberation Sans' });
  const label = library.querySelector<HTMLElement>('[data-menu-label]');
  expect(label?.style.fontFamily).toBe('"Canvas preview Liberation Sans", var(--font-ui)');
  expect(prepareFontPreview).toHaveBeenCalledWith('Liberation Sans');
  expect(loadLocalFont).not.toHaveBeenCalled();
});

it('loads only the chosen local family once and applies it after loading', async () => {
  const onChange = vi.fn<(family: string) => void>();
  const menu = await openMenu(onChange);
  expect(loadLocalFont).not.toHaveBeenCalled();
  let finishLoad: (() => void) | undefined;
  vi.mocked(loadLocalFont).mockImplementation(
    () => new Promise<void>((resolve) => (finishLoad = resolve)),
  );
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Private Mono' }));
  expect(loadLocalFont).toHaveBeenCalledExactlyOnceWith('Private Mono');
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => {
    finishLoad?.();
    await Promise.resolve();
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Private Mono');
});

it('marks a family Unavailable and disables it when its chosen load fails', async () => {
  const onChange = vi.fn<(family: string) => void>();
  const menu = await openMenu(onChange);
  expect(loadLocalFont).not.toHaveBeenCalled();
  vi.mocked(loadLocalFont).mockRejectedValue(new Error('Unsupported font'));
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Private Mono' }));
    await Promise.resolve();
  });
  expect(loadLocalFont).toHaveBeenCalledExactlyOnceWith('Private Mono');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  const failed = within(screen.getByRole('menu')).getByRole('menuitemradio', {
    name: /Private Mono/,
  });
  expect(failed.textContent).toContain('Unavailable');
  expect(failed.getAttribute('aria-disabled')).toBe('true');
});
