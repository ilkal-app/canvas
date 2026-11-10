// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
 * Renders the text inspector with a direction value before its context type exists.
 *
 * @param direction - The selected direction.
 * @param align - The selected alignment.
 * @returns The change spy.
 */
function renderDirection(direction: 'auto' | 'ltr' | 'rtl' | undefined, align = 'left') {
  const onChange = vi.fn<(change: TextStyleChange) => void>();
  render(
    <TextStyleSection
      context={{ ...BASE, direction, align } as TextStyleContext}
      onChange={onChange}
    />,
  );
  return onChange;
}

afterEach(cleanup);

describe('inspector direction', () => {
  it('shows three direction toggles and emits explicit rtl and auto changes', () => {
    const onChange = renderDirection('auto');
    for (const name of ['Auto direction', 'Left to right', 'Right to left']) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
    expect(
      screen.getByRole('button', { name: 'Auto direction' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Right to left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Auto direction' }));
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'direction', direction: 'rtl' },
      { kind: 'direction', direction: 'auto' },
    ]);
  });

  it('treats absent direction as auto and a mixed selection as mixed', () => {
    renderDirection(undefined);
    expect(
      screen.getByRole('button', { name: 'Auto direction' }).getAttribute('aria-pressed'),
    ).toBe('true');
    cleanup();
    render(<TextStyleSection context={{ ...BASE, direction: MIXED }} onChange={() => undefined} />);
    for (const name of ['Auto direction', 'Left to right', 'Right to left']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('mixed');
    }
  });

  it('shows Text left pressed for end alignment in an rtl paragraph', () => {
    renderDirection('rtl', 'end');
    expect(screen.getByRole('button', { name: 'Text left' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Text right' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});
