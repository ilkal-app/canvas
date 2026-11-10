// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FONT_FAMILIES } from './font-catalogue.js';
import { FontPicker } from './font-picker.js';
import { configureFontCatalogue, disableFontCatalogue } from './remote-font-catalogue.js';

vi.mock('./page-fonts.js', () => ({
  pageFontStatus: () => 'ready',
  ensurePageFont: vi.fn(() => Promise.resolve(true)),
  subscribePageFonts: () => () => undefined,
  pageFontLoader: () => ({ status: () => 'ready', fonts: { resolve: () => undefined } }),
  loadRemoteFontCatalogue: vi.fn(() => Promise.resolve([])),
}));
afterEach(() => {
  cleanup();
  configureFontCatalogue(undefined);
});
it('releases browser focus before applying a font during text editing', () => {
  const onChange = vi.fn(() => document.activeElement);
  render(<FontPicker value="Liberation Sans" shouldReleaseFocus onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse fonts' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search fonts' }), {
    target: { value: 'JetBrains' },
  });
  const choice = screen.getByRole('button', { name: 'Use JetBrains Mono' });
  choice.focus();
  fireEvent.click(choice);
  expect(onChange).toHaveBeenCalledWith('JetBrains Mono');
  expect(onChange).toHaveReturnedWith(document.body);
});
it('searches the library and applies one explicit choice; cancelling preserves text', async () => {
  const onChange = vi.fn();
  render(<FontPicker value="Liberation Sans" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse fonts' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search fonts' }), {
    target: { value: 'JetBrains' },
  });
  expect(screen.getByRole('button', { name: 'Use JetBrains Mono' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Use JetBrains Mono' }));
  await waitFor(() => {
    expect(onChange).toHaveBeenCalledWith('JetBrains Mono');
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Browse fonts' }));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(onChange).toHaveBeenCalledTimes(1);
});
it('explains a catalogue that has not been uploaded and offers retry', async () => {
  render(<FontPicker value="Lora" onChange={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse fonts' }));
  fireEvent.click(screen.getByRole('button', { name: 'All fonts' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Retry catalogue' })).toBeDefined();
  });
});
it('offers no catalogue on a page without a font service', () => {
  disableFontCatalogue();
  render(<FontPicker value="Lora" onChange={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse fonts' }));
  expect(screen.getByRole('button', { name: 'Library' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'All fonts' })).toBeNull();
});
it('filters the library by category and pages further results on request', () => {
  const sans = FONT_FAMILIES.filter((entry) => entry.category === 'sans').map(
    (entry) => `Use ${entry.family}`,
  );
  expect(sans.length).toBeGreaterThan(8);
  render(<FontPicker value="Lora" onChange={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse fonts' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Font category' }), {
    target: { value: 'sans' },
  });
  const shown = () =>
    screen
      .getAllByRole('button', { name: /^Use / })
      .map((choice) => choice.getAttribute('aria-label'));
  expect(shown()).toEqual(sans.slice(0, 8));
  fireEvent.click(screen.getByRole('button', { name: 'Show more fonts' }));
  expect(shown()).toEqual(sans.slice(0, 16));
});
it('retries an unavailable catalogue explicitly', async () => {
  const { loadRemoteFontCatalogue } = await import('./page-fonts.js');
  vi.mocked(loadRemoteFontCatalogue).mockClear();
  render(<FontPicker value="Lora" onChange={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse fonts' }));
  fireEvent.click(screen.getByRole('button', { name: 'All fonts' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry catalogue' }));
  expect(loadRemoteFontCatalogue).toHaveBeenLastCalledWith(true);
  expect(await screen.findByRole('button', { name: 'Retry catalogue' })).toBeDefined();
});
