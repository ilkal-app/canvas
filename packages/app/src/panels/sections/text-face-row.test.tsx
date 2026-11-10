// @vitest-environment jsdom
// The Face row beside acceptance suite: a caret's or
// tool default's plain style reads Regular, not mixed, and a pointer choice while editing gives
// the keyboard back.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shownTextStyle } from '@canvas/tools';

import type { TextStyleContext } from '../../engine/document-text.js';

import { FaceRow } from './text-face-row.js';

const fonts = vi.hoisted(() => ({ names: [] as string[] }));

vi.mock('../../text-input/page-fonts.js', () => ({
  pageNamedFaces: () => fonts.names,
  subscribePageFonts: () => () => undefined,
}));

afterEach(() => {
  cleanup();
  fonts.names = [];
});

const PLAIN = shownTextStyle({
  fontFamily: 'Private Sans',
  fontSize: 24,
  color: 'ink',
  weight: 400,
  italic: false,
});

/**
 * A section context over a style.
 *
 * @param style - The shared style.
 * @param isEditing - Whether text is being edited.
 * @returns The context.
 */
function context(style: TextStyleContext['style'], isEditing = false): TextStyleContext {
  return { style, align: 'left', isEditing };
}

describe('FaceRow and shown styles', () => {
  it('hides for a plain caret style of a family without named faces', () => {
    render(<FaceRow context={context(PLAIN, true)} onChange={() => undefined} />);
    expect(screen.queryByRole('combobox', { name: 'Face' })).toBeNull();
  });

  it('shows Regular, not mixed, for a plain caret style of a family with named faces', () => {
    fonts.names = ['PrivateSans-Condensed'];
    render(<FaceRow context={context(PLAIN, true)} onChange={() => undefined} />);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Face' }).value).toBe('regular');
  });

  it('gives the keyboard back after a pointer choice while editing', () => {
    fonts.names = ['PrivateSans-Condensed'];
    const onChange = vi.fn();
    render(<FaceRow context={context(PLAIN, true)} onChange={onChange} />);
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Face' });
    select.focus();
    fireEvent.pointerDown(select);
    fireEvent.change(select, { target: { value: 'PrivateSans-Condensed' } });
    expect(document.activeElement).not.toBe(select);
    expect(onChange).toHaveBeenCalledWith({
      kind: 'style',
      patch: { postScriptName: 'PrivateSans-Condensed' },
    });
  });
});
