// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';

const fonts = vi.hoisted(() => ({
  names: [] as string[],
  listeners: new Set<() => void>(),
}));

vi.mock('../../text-input/page-fonts.js', () => ({
  pageNamedFaces: () => fonts.names,
  subscribePageFonts: (listener: () => void) => {
    fonts.listeners.add(listener);
    return () => fonts.listeners.delete(listener);
  },
}));

/**
 * Makes the shared style the row receives from the inspector.
 *
 * @param style - Shared fields.
 * @returns An inspector context.
 */
function context(style: TextStyleContext['style']): TextStyleContext {
  return { style, align: 'left', isEditing: false };
}

interface RowProps {
  context: TextStyleContext;
  onChange: (change: TextStyleChange) => void;
}

/**
 * Loads the row through a runtime path while its module may still be absent.
 *
 * @returns Its React component.
 */
async function faceRow(): Promise<ComponentType<RowProps>> {
  const path = './text-face-row.js';
  const module = (await import(path)) as Record<string, ComponentType<RowProps>>;
  const row = module.FaceRow;
  if (row === undefined) throw new Error('FaceRow export is missing.');
  return row;
}

afterEach(() => {
  cleanup();
  fonts.names = [];
  fonts.listeners.clear();
});

describe('FaceRow', () => {
  it('hides without a shared family or any available or selected named face', async () => {
    const row = await faceRow();
    const { rerender } = render(
      createElement(row, { context: context({}), onChange: () => undefined }),
    );
    expect(screen.queryByRole('combobox', { name: 'Face' })).toBeNull();
    rerender(
      createElement(row, {
        context: context({ fontFamily: 'Private Sans', postScriptName: undefined }),
        onChange: () => undefined,
      }),
    );
    expect(screen.queryByRole('combobox', { name: 'Face' })).toBeNull();
  });

  it('offers Regular then installed names, chooses a name and clears it with Regular', async () => {
    const row = await faceRow();
    fonts.names = ['PrivateSans-CondensedBold', 'PrivateSans-Display'];
    const onChange = vi.fn<(change: TextStyleChange) => void>();
    render(
      createElement(row, {
        context: context({ fontFamily: 'Private Sans', postScriptName: undefined }),
        onChange,
      }),
    );
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Face' });
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ['regular', 'Regular'],
      ['PrivateSans-CondensedBold', 'Condensed Bold'],
      ['PrivateSans-Display', 'Display'],
    ]);
    fireEvent.change(select, { target: { value: 'PrivateSans-CondensedBold' } });
    fireEvent.change(select, { target: { value: 'regular' } });
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'style', patch: { postScriptName: 'PrivateSans-CondensedBold' } },
      { kind: 'style', patch: { postScriptName: null } },
    ]);
  });

  it('shows a missing shared face and a mixed face', async () => {
    const row = await faceRow();
    fonts.names = ['PrivateSans-Condensed'];
    const { rerender } = render(
      createElement(row, {
        context: context({ fontFamily: 'Private Sans', postScriptName: 'PrivateSans-Display' }),
        onChange: () => undefined,
      }),
    );
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Face' });
    expect(select.value).toBe('PrivateSans-Display');
    expect(within(select).getByRole('option', { name: 'Display' })).toBeDefined();
    rerender(
      createElement(row, {
        context: context({ fontFamily: 'Private Sans' }),
        onChange: () => undefined,
      }),
    );
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Face' }).value).toBe('');
  });

  it('updates when the page installs a family after mounting', async () => {
    const row = await faceRow();
    render(
      createElement(row, {
        context: context({ fontFamily: 'Private Sans', postScriptName: undefined }),
        onChange: () => undefined,
      }),
    );
    expect(screen.queryByRole('combobox', { name: 'Face' })).toBeNull();
    fonts.names = ['PrivateSans-Condensed'];
    act(() => {
      for (const listener of fonts.listeners) listener();
    });
    expect(screen.getByRole('option', { name: 'Condensed' })).toBeDefined();
  });
});
