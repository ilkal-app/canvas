// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VariationAxes } from '@canvas/text';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { MIXED } from '../controls/mixed-value.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection, TextStyleSection } from './text-style-section.js';

const mock = vi.hoisted(() => ({ loading: false, hiddenOptical: false }));

const VARIABLE_AXES: VariationAxes = {
  axes: [
    { tag: 'wght', minimum: 100, default: 400, maximum: 900, name: 'Weight', isHidden: false },
    { tag: 'opsz', minimum: 14, default: 14, maximum: 32, name: 'Optical size', isHidden: false },
  ],
  instances: [
    { name: 'Regular', coordinates: { wght: 400, opsz: 14 } },
    { name: 'Medium', coordinates: { wght: 500, opsz: 14 } },
    { name: 'Bold', coordinates: { wght: 700, opsz: 14 } },
  ],
};

vi.mock('../../text-input/family-axes.js', () => ({
  useFamilyAxes: (family: string | undefined) =>
    mock.loading && family === 'Inter Variable'
      ? undefined
      : family === 'Inter Variable'
        ? mock.hiddenOptical
          ? {
              ...VARIABLE_AXES,
              axes: VARIABLE_AXES.axes.map((axis) =>
                axis.tag === 'opsz' ? { ...axis, isHidden: true } : axis,
              ),
            }
          : VARIABLE_AXES
        : { axes: [], instances: [] },
}));

const BASE: TextStyleContext = {
  style: {
    fontFamily: 'Inter Variable',
    fontSize: 20,
    weight: 400,
    italic: false,
    color: [0, 0, 0, 1],
  },
  align: 'left',
  isEditing: false,
};

function renderStyle(style: TextStyleContext['style']) {
  const onChange = vi.fn<(change: TextStyleChange) => void>();
  render(<TextStyleSection context={{ ...BASE, style }} onChange={onChange} />);
  return onChange;
}

function weightOptions() {
  return Array.from(
    screen.getByRole('combobox', { name: 'Weight' }).querySelectorAll('option'),
  ).map((option) => ({ value: option.value, label: option.textContent }));
}

afterEach(() => {
  cleanup();
  mock.loading = false;
  mock.hiddenOptical = false;
});

describe('variable family inspector choices', () => {
  it('shows visible axes with drawn coordinates and fvar bounds', () => {
    renderStyle({ ...BASE.style, fontVariations: { opsz: 20 }, weight: 700 });
    const group = screen.getByRole('group', { name: 'Variable axes' });
    expect(
      Boolean(
        screen.getByRole('group', { name: 'Spacing' }).compareDocumentPosition(group) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    const optical = screen.getByRole<HTMLInputElement>('slider', { name: 'Optical size' });
    expect(group.contains(optical)).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Weight' }).value).toBe('700');
    expect(optical.value).toBe('20');
    expect([optical.min, optical.max, optical.step]).toEqual(['14', '32', '1']);
  });

  it('previews each input and commits one axis patch on release', () => {
    const onChange = renderStyle({ ...BASE.style, fontVariations: { opsz: 18 } });
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Weight' });
    fireEvent.input(slider, { target: { value: '600' } });
    fireEvent.input(slider, { target: { value: '650' } });
    expect(onChange).toHaveBeenNthCalledWith(1, {
      kind: 'preview',
      patch: { fontVariationsAxes: { wght: 600 } },
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      kind: 'preview',
      patch: { fontVariationsAxes: { wght: 650 } },
    });
    fireEvent.change(slider, { target: { value: '650' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'endPreview' });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'style',
      patch: { fontVariationsAxes: { wght: 650 } },
    });
    expect(onChange.mock.calls.filter(([change]) => change.kind === 'style')).toHaveLength(1);
  });

  it('shows mixed axes and hides the group for a static family', () => {
    // Mixed coordinates and weight: both left out of the shown style.
    renderStyle({ fontFamily: 'Inter Variable', fontSize: 20, italic: false, color: [0, 0, 0, 1] });
    expect(screen.getByRole('slider', { name: 'Weight' }).getAttribute('aria-valuetext')).toBe(
      'Mixed',
    );
    cleanup();
    renderStyle({ ...BASE.style, fontFamily: 'Inter' });
    expect(screen.queryByRole('group', { name: 'Variable axes' })).toBeNull();
  });

  it('shows each axis from its per-axis common value', () => {
    const onChange = vi.fn<(change: TextStyleChange) => void>();
    const context = {
      ...BASE,
      style: { ...BASE.style, fontVariations: undefined },
      axisValues: { opsz: MIXED, wght: 650 } as const,
    };
    render(<TextStyleSection context={context} onChange={onChange} />);
    expect(screen.getByRole('slider', { name: 'Weight' }).getAttribute('aria-valuetext')).toBe(
      '650',
    );
    expect(
      screen.getByRole('slider', { name: 'Optical size' }).getAttribute('aria-valuetext'),
    ).toBe('Mixed');
  });

  it('omits axes the font marks hidden', () => {
    mock.hiddenOptical = true;
    renderStyle(BASE.style);
    expect(screen.getByRole('slider', { name: 'Weight' })).toBeDefined();
    expect(screen.queryByRole('slider', { name: 'Optical size' })).toBeNull();
  });

  it('shows the selected instance in font order and commits its coordinates and weight together', () => {
    const onChange = renderStyle({
      ...BASE.style,
      fontVariations: { wght: 700 },
      weight: 700,
    });
    const weight = screen.getByRole('combobox', { name: 'Weight' });
    expect((weight as HTMLSelectElement).value).toBe('Bold');
    expect(weightOptions()).toEqual([
      { value: 'Regular', label: 'Regular' },
      { value: 'Medium', label: 'Medium' },
      { value: 'Bold', label: 'Bold' },
    ]);
    fireEvent.change(weight, { target: { value: 'Medium' } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { fontVariations: {}, weight: 500 },
    });
  });

  it('shows Custom for coordinates outside the named instances', () => {
    renderStyle({ ...BASE.style, fontVariations: { wght: 650 }, weight: 700 });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Weight' }).value).toBe(
      'Custom',
    );
  });

  it('shows Bold when weight supplies the omitted wght coordinate', () => {
    renderStyle({ ...BASE.style, fontVariations: {}, weight: 700 });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Weight' }).value).toBe('Bold');
  });

  it('shows Bold for the text tool’s weight-only defaults', () => {
    const props = {
      defaults: { textStyle: { fontFamily: 'Inter Variable', weight: 700 } },
      applyStyle: vi.fn(),
    } as unknown as StylePanelSectionProps;
    render(<stylePanelSection.render {...props} />);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Weight' }).value).toBe('Bold');
  });

  it('makes the Bold toggle clear an explicit weight axis on a bundled variable family', () => {
    const onChange = renderStyle({ ...BASE.style, fontVariations: { wght: 650 } });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { weight: 700, fontVariationsAxes: { wght: null } },
    });
  });

  it('keeps static weight choices and the static Bold patch', () => {
    const onChange = renderStyle({ ...BASE.style, fontFamily: 'Inter', fontVariations: {} });
    expect(weightOptions()).toContainEqual({ value: '700', label: 'Bold 700' });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ kind: 'style', patch: { weight: 700 } });
  });

  it('uses static weight choices while variable axes load', () => {
    mock.loading = true;
    renderStyle({ ...BASE.style, fontVariations: {} });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Weight' }).value).toBe('400');
    expect(weightOptions()).toContainEqual({ value: '400', label: 'Regular 400' });
  });
});
