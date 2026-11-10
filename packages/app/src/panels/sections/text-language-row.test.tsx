// @vitest-environment jsdom
// A language the list does not offer still shows, as its tag.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TextStyleContext } from '../../engine/document-text.js';

import { LanguageRow } from './text-language-row.js';

afterEach(cleanup);

describe('LanguageRow', () => {
  it('shows a tag the list lacks as an option of its own', () => {
    const context: TextStyleContext = { style: { lang: 'fr-CA' }, align: 'left', isEditing: false };
    render(<LanguageRow context={context} onChange={() => undefined} />);
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select).toHaveProperty('value', 'fr-CA');
    expect(screen.getByRole('option', { name: 'fr-CA' })).toBeDefined();
  });
});
