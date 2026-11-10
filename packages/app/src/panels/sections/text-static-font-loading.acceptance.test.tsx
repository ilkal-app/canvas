// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextStyleContext } from '../../engine/document-text.js';
import type * as PageFonts from '../../text-input/page-fonts.js';

const page = vi.hoisted(() => ({
  read: vi.fn(() => ({ get: vi.fn() })),
  ensure: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../../text-input/page-fonts.js', async (original) => ({
  ...(await original<typeof PageFonts>()),
  pageTextFonts: page.read,
  ensurePageFont: page.ensure,
}));

import { TextStyleSection } from './text-style-section.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('static family weight control', () => {
  it('does not read or load page font faces to show static weight choices', () => {
    const context: TextStyleContext = {
      style: {
        fontFamily: 'Inter',
        fontSize: 20,
        weight: 700,
        italic: false,
        color: [0, 0, 0, 1],
      },
      align: 'left',
      isEditing: false,
    };
    render(<TextStyleSection context={context} onChange={() => undefined} />);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Weight' }).value).toBe('700');
    expect(page.read).not.toHaveBeenCalled();
    expect(page.ensure).not.toHaveBeenCalled();
  });
});
