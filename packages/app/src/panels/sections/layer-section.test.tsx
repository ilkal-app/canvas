// @vitest-environment jsdom
// The shared layer-opacity control over layers and images.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { createDefaultStylePanelRegistry } from '../default-style-sections.js';
import {
  sectionsShown,
  type SelectionContext,
  type StylePanelSectionProps,
} from '../panel-sections.js';
import { patchFor, type StyleToApply } from '../style-changes.js';

const registry = createDefaultStylePanelRegistry();

function object(id: string, type: BoardObject['type'], opacity?: number): BoardObject {
  return { id: id as ObjectId, type, ...(opacity === undefined ? {} : { opacity }) } as BoardObject;
}

function layerFor(selection: readonly BoardObject[], context: SelectionContext = 'mixed') {
  return sectionsShown(registry, context, true, selection).find(({ id }) => id === 'layer');
}

function renderLayer(selection: readonly BoardObject[], context: SelectionContext = 'mixed') {
  const section = layerFor(selection, context);
  if (section === undefined) throw new Error('Layer section is missing for opacity selection');
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const props = {
    context,
    selection,
    defaults: undefined,
    applyStyle,
    dispatch: vi.fn(),
  } as unknown as StylePanelSectionProps;
  render(<section.render {...props} />);
  return applyStyle;
}

function commitPercent(value: string): void {
  const field = screen.getByRole('spinbutton', { name: 'Opacity' });
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

function committedStyle(applyStyle: ReturnType<typeof renderLayer>): StyleToApply {
  const style = applyStyle.mock.lastCall?.[0];
  if (style === undefined) throw new Error('No opacity style change committed');
  return style;
}

afterEach(cleanup);

describe('the Layer section', () => {
  it('registers near the top after type-specific sections, only for opacity-capable selections', () => {
    const section = layerFor([object('shape', 'shape')], 'shape');
    expect(section).toMatchObject({ id: 'layer', title: 'Layer', isSelectionOnly: true });
    const shown = sectionsShown(registry, 'shape', true, [object('shape', 'shape')]);
    expect(shown.findIndex(({ id }) => id === 'layer')).toBeGreaterThan(
      shown.findIndex(({ id }) => id === 'shape'),
    );
    for (const type of [
      'text',
      'sticky',
      'shape',
      'line',
      'connector',
      'path',
      'group',
      'frame',
      'component',
      'instance',
      'image',
    ] as const) {
      expect(layerFor([object(type, type)], 'mixed')?.id).toBe('layer');
    }
    expect(layerFor([object('comment', 'comment'), object('video', 'video')])).toBeUndefined();
    expect(sectionsShown(registry, 'shape', false).some(({ id }) => id === 'layer')).toBe(false);
  });

  it('shows absent layer opacity as 100 and differing image and layer values as Mixed', () => {
    renderLayer([object('shape', 'shape')], 'shape');
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Opacity' }).value).toBe('100');
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Opacity' }).value).toBe('100');
    cleanup();
    renderLayer([object('image', 'image', 0.4), object('shape', 'shape', 0.7)]);
    expect(screen.getAllByText('Mixed').length).toBeGreaterThan(0);
    expect(screen.getByRole('spinbutton', { name: /Opacity.*mixed/i })).toBeDefined();
  });

  it('previews a slider drag and commits one 0–1 style change on release', () => {
    const applyStyle = renderLayer([object('group', 'group')], 'group');
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Opacity' });
    fireEvent.input(slider, { target: { value: '40' } });
    expect(screen.getByText('40%')).toBeDefined();
    expect(applyStyle).not.toHaveBeenCalled();
    slider.dispatchEvent(new Event('change', { bubbles: false }));
    expect(applyStyle).toHaveBeenCalledTimes(1);
    expect(patchFor(committedStyle(applyStyle), object('group', 'group'))).toEqual({
      opacity: 0.4,
    });
  });

  it('commits a percent on Enter for both an image and a shape through one style change', () => {
    const image = object('image', 'image', 1);
    const shape = object('shape', 'shape');
    const applyStyle = renderLayer([image, shape]);
    commitPercent('35');
    expect(applyStyle).toHaveBeenCalledTimes(1);
    expect(
      [image, shape].map((selected) => patchFor(committedStyle(applyStyle), selected)),
    ).toEqual([{ opacity: 0.35 }, { opacity: 0.35 }]);
  });

  it('removes layer opacity at 100%, but writes 1 for an image', () => {
    const image = object('image', 'image', 0.5);
    const shape = object('shape', 'shape', 0.5);
    const applyStyle = renderLayer([image, shape]);
    commitPercent('100');
    expect(applyStyle).toHaveBeenCalledTimes(1);
    expect(patchFor(committedStyle(applyStyle), image)).toEqual({ opacity: 1 });
    expect(patchFor(committedStyle(applyStyle), shape)).toEqual({ opacity: undefined });
  });

  it('refuses numbers outside 0–100', () => {
    const applyStyle = renderLayer([object('shape', 'shape')], 'shape');
    for (const outside of ['-1', '101']) {
      commitPercent(outside);
      expect(screen.getByRole('spinbutton', { name: 'Opacity' }).getAttribute('aria-invalid')).toBe(
        'true',
      );
    }
    expect(applyStyle).not.toHaveBeenCalled();
  });
});
