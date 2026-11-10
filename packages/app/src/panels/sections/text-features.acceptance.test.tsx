// @vitest-environment jsdom
// Inspector controls for OpenType features.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { isSameStyleContext } from '../../engine/text-style-context.js';
import type { StylePanelSectionProps } from '../panel-sections.js';
import { TextStyleProvider } from '../text-style-control.js';

import { stylePanelSection, TextStyleSection } from './text-style-section.js';

const BASE: TextStyleContext = {
  style: { fontFamily: 'DM Sans', fontSize: 20, weight: 400, italic: false, color: [0, 0, 0, 1] },
  align: 'left',
  isEditing: false,
};

/**
 * Renders the text section with the supplied shown features and records its style changes.
 *
 * @param fontFeatures - The shared feature record, or undefined for no record.
 * @param isMixed - Whether the feature field is absent because the selection disagrees.
 * @returns The change spy.
 */
function renderFeatures(fontFeatures: Record<string, number> | undefined, isMixed = false) {
  const onChange = vi.fn<(change: TextStyleChange) => void>();
  const style = isMixed ? BASE.style : { ...BASE.style, fontFeatures };
  render(<TextStyleSection context={{ ...BASE, style }} onChange={onChange} />);
  return onChange;
}

/**
 * Reads a named feature's pressed state from its accessible toggle.
 *
 * @param name - The toggle's accessible name.
 * @returns Its aria-pressed value.
 */
function pressed(name: string): string | null {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed');
}

afterEach(cleanup);

describe('inspector font features', () => {
  it('exports the FeaturesRow component', async () => {
    // A string path lets this acceptance test typecheck before the module exists.
    const path = ['./text-features-row.js'].join('');
    const module = (await import(path)) as Record<string, unknown>;
    expect(module).toHaveProperty('FeaturesRow', expect.any(Function));
  });

  it.each([
    [undefined, ['true', 'true', 'false', 'false']],
    [{ liga: 0 }, ['false', 'true', 'false', 'false']],
    [{ tnum: 1 }, ['true', 'true', 'true', 'false']],
  ] as const)('shows defaults and explicit feature values for %j', (features, expected) => {
    renderFeatures(features);
    expect(['Ligatures', 'Kerning', 'Tabular figures', 'Small caps'].map(pressed)).toEqual(
      expected,
    );
  });

  it('marks all four toggles mixed when the shared record is omitted', () => {
    renderFeatures(undefined, true);
    expect(['Ligatures', 'Kerning', 'Tabular figures', 'Small caps'].map(pressed)).toEqual([
      'mixed',
      'mixed',
      'mixed',
      'mixed',
    ]);
  });

  it.each([
    ['Ligatures', undefined, { liga: 0 }],
    ['Kerning', undefined, { kern: 0 }],
    ['Tabular figures', undefined, { tnum: 1 }],
    ['Small caps', undefined, { smcp: 1 }],
    ['Ligatures', { liga: 0 }, null],
    ['Kerning', { kern: 0 }, null],
    ['Tabular figures', { tnum: 1 }, null],
    ['Small caps', { smcp: 1 }, null],
    ['Ligatures', { liga: 0, ss01: 1 }, { ss01: 1 }],
    ['Tabular figures', { ss01: 1 }, { ss01: 1, tnum: 1 }],
  ] as const)('pressing %s with %j emits %j', (name, features, expected) => {
    const onChange = renderFeatures(features);
    fireEvent.click(screen.getByRole('button', { name }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { fontFeatures: expected },
    });
  });

  it.each([
    ['Ligatures', null],
    ['Kerning', null],
    ['Tabular figures', { tnum: 1 }],
    ['Small caps', { smcp: 1 }],
  ] as const)('pressing mixed %s starts a fresh record', (name, expected) => {
    const onChange = renderFeatures(undefined, true);
    fireEvent.click(screen.getByRole('button', { name }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { fontFeatures: expected },
    });
  });

  it('shows features during editing and for selected text', () => {
    render(<TextStyleSection context={{ ...BASE, isEditing: true }} onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Ligatures' })).toBeDefined();
    cleanup();
    renderFeatures(undefined);
    expect(screen.getByRole('button', { name: 'Ligatures' })).toBeDefined();
  });

  it('hides features for the text tool defaults', () => {
    const props = {
      defaults: { textStyle: BASE.style, align: 'left' },
      applyStyle: vi.fn(),
    } as unknown as StylePanelSectionProps;
    render(<stylePanelSection.render {...props} />);
    expect(screen.queryByRole('button', { name: 'Ligatures' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tabular figures' })).toBeNull();
  });

  it('hides features when the context explicitly disallows them', () => {
    const context = { ...BASE, canSetFeatures: false } as TextStyleContext & {
      canSetFeatures: false;
    };
    render(
      <TextStyleProvider value={{ context, onChange: () => undefined }}>
        <stylePanelSection.render
          {...({
            defaults: undefined,
            applyStyle: () => undefined,
          } as unknown as StylePanelSectionProps)}
        />
      </TextStyleProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Ligatures' })).toBeNull();
  });

  it('detects a change to the features capability or shown record', () => {
    const withCapability = { ...BASE, canSetFeatures: false } as TextStyleContext & {
      canSetFeatures: false;
    };
    expect(isSameStyleContext(BASE, withCapability)).toBe(false);
    expect(
      isSameStyleContext(
        { ...BASE, style: { ...BASE.style, fontFeatures: { liga: 0 } } },
        { ...BASE, style: { ...BASE.style, fontFeatures: { liga: 1 } } },
      ),
    ).toBe(false);
    expect(
      isSameStyleContext(
        { ...BASE, style: { ...BASE.style, fontFeatures: { liga: 0, ss01: 1 } } },
        { ...BASE, style: { ...BASE.style, fontFeatures: { ss01: 1, liga: 0 } } },
      ),
    ).toBe(true);
  });
});
