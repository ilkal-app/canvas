// @vitest-environment jsdom
// Acceptance (Claude): the inspector marks a selected text whose family this page cannot
// draw (missing, or failed to load) and says what to do; it stays quiet for a family that is
// ready, idle or still loading; it follows the page's fonts, so the marker leaves when the family
// arrives (the owner installs it) and comes when it goes; the family field still shows the stored
// name, so the shared document is never rewritten by looking at it.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FontPicker } from './font-picker.js';
import { MissingFontMarker } from './missing-font-marker.js';

/** The page's font states and who listens to them. */
const page = vi.hoisted(() => ({
  status: new Map<string, 'idle' | 'loading' | 'ready' | 'failed' | 'missing'>(),
  listeners: new Set<() => void>(),
}));

vi.mock('./page-fonts.js', () => ({
  pageFontStatus: (family: string) => page.status.get(family) ?? 'ready',
  subscribePageFonts: (listener: () => void) => {
    page.listeners.add(listener);
    return () => {
      page.listeners.delete(listener);
    };
  },
  ensurePageFont: vi.fn(() => Promise.resolve(true)),
  pageFontLoader: () => ({ status: () => 'ready', fonts: { resolve: () => undefined } }),
  loadRemoteFontCatalogue: vi.fn(() => Promise.resolve([])),
}));

/**
 * Announces a font change to the page's listeners, inside React's act.
 */
function fontsChanged(): void {
  act(() => {
    for (const listener of page.listeners) listener();
  });
}

afterEach(() => {
  cleanup();
  page.status.clear();
  page.listeners.clear();
});

const MARKER = /Missing font: Private Mono\. Choose an available font before editing its words\./;

describe('the inspector’s missing-font marker', () => {
  it('marks a missing or failed family and says what to do; nothing for ready, idle or loading', () => {
    page.status.set('Private Mono', 'missing');
    const { rerender } = render(<MissingFontMarker family="Private Mono" />);
    expect(screen.getByRole('status')).toHaveProperty('textContent', expect.stringMatching(MARKER));

    page.status.set('Private Mono', 'failed');
    rerender(<MissingFontMarker family="Private Mono" />);
    fontsChanged();
    expect(screen.getByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('Missing font: Private Mono'),
    );

    for (const state of ['ready', 'idle', 'loading'] as const) {
      page.status.set('Lora', state);
      rerender(<MissingFontMarker family="Lora" />);
      fontsChanged();
      expect(screen.queryByRole('status'), state).toBeNull();
    }
    rerender(<MissingFontMarker family={undefined} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('follows the page’s fonts: the marker leaves when the family arrives and returns when it is lost', () => {
    page.status.set('Private Mono', 'missing');
    render(<MissingFontMarker family="Private Mono" />);
    expect(screen.getByRole('status')).toBeDefined();
    expect(page.listeners.size).toBe(1);

    page.status.set('Private Mono', 'ready');
    fontsChanged();
    expect(screen.queryByRole('status')).toBeNull();

    page.status.set('Private Mono', 'missing');
    fontsChanged();
    expect(screen.getByRole('status')).toBeDefined();

    cleanup();
    expect(page.listeners.size).toBe(0);
  });

  it('shows the stored family name in the field beside the marker, unchanged', () => {
    page.status.set('Private Mono', 'missing');
    const onChange = vi.fn();
    render(<FontPicker value="Private Mono" onChange={onChange} />);
    expect(screen.getByRole('status')).toHaveProperty('textContent', expect.stringMatching(MARKER));
    const field = screen.getByRole('combobox', { name: 'Font' });
    expect(field).toHaveProperty('value', 'Private Mono');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks nothing for a mixed selection or a library family', () => {
    render(<FontPicker value="Lora" onChange={() => undefined} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
