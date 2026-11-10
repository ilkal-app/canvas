// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextStyleContext } from '../../engine/document-text.js';

import { TextStyleSection } from './text-style-section.js';

vi.mock('../../text-input/page-fonts.js', () => ({
  pageNamedFaces: () => ['PrivateSans-Condensed'],
  pageFontStatus: () => 'ready',
  pageFontRevision: () => 0,
  subscribePageFonts: () => () => undefined,
  pageFontLoader: () => ({ status: () => 'ready', fonts: { resolve: () => undefined } }),
  loadRemoteFontCatalogue: () => Promise.resolve([]),
}));

afterEach(cleanup);

describe('text section face placement', () => {
  it('renders Face immediately after Font for a selected local family', () => {
    const context: TextStyleContext = {
      style: { fontFamily: 'Private Sans', postScriptName: undefined },
      align: 'left',
      isEditing: false,
    };
    render(<TextStyleSection context={context} onChange={() => undefined} />);
    const font = screen.getByRole('combobox', { name: 'Font' });
    const face = screen.getByRole('combobox', { name: 'Face' });
    expect(font.compareDocumentPosition(face) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('combobox').slice(0, 2)).toEqual([font, face]);
  });
});
