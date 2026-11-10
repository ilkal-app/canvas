// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { MIXED } from '../controls/mixed-value.js';

import { TextStyleSection } from './text-style-section.js';

const BASE: TextStyleContext = {
  style: { fontFamily: 'DM Sans', fontSize: 20, weight: 400, italic: false, color: [0, 0, 0, 1] },
  align: 'left',
  isEditing: false,
};

/**
 * Renders the inspector at one shared language value.
 *
 * @param lang - A tag, absent for Auto, or MIXED.
 * @returns The change spy.
 */
function renderLanguage(lang: string | typeof MIXED | undefined) {
  const onChange = vi.fn<(change: TextStyleChange) => void>();
  render(
    <TextStyleSection
      context={{ ...BASE, style: { ...BASE.style, lang } } as TextStyleContext}
      onChange={onChange}
    />,
  );
  return onChange;
}

afterEach(cleanup);

describe('inspector run language', () => {
  it('offers the six specified choices with Auto selected for an absent tag', () => {
    renderLanguage(undefined);
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect((select as HTMLSelectElement).value).toBe('auto');
    expect(
      Array.from((select as HTMLSelectElement).options, ({ text, value }) => [text, value]),
    ).toEqual([
      ['Auto', 'auto'],
      ['English', 'en'],
      ['\u65e5\u672c\u8a9e', 'ja'],
      ['\u7b80\u4f53\u4e2d\u6587', 'zh-Hans'],
      ['\u7e41\u9ad4\u4e2d\u6587', 'zh-Hant'],
      ['\ud55c\uad6d\uc5b4', 'ko'],
    ]);
  });

  it('shows the shared tag and emits a style patch for a choice and Auto removal', () => {
    const onChange = renderLanguage('ja');
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect((select as HTMLSelectElement).value).toBe('ja');
    fireEvent.change(select, { target: { value: 'zh-Hant' } });
    fireEvent.change(select, { target: { value: 'auto' } });
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'style', patch: { lang: 'zh-Hant' } },
      { kind: 'style', patch: { lang: null } },
    ]);
  });

  it('shows Mixed when selected runs have different tags', () => {
    renderLanguage(MIXED);
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select).toHaveProperty('value', '');
    // The spacing selects are mixed too (the base style has neither): look in this select.
    expect(within(select).getByRole('option', { name: 'Mixed' })).toBeDefined();
  });
});
