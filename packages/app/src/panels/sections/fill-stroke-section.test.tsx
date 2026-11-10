// @vitest-environment jsdom
// The style panel's fill and stroke section in jsdom, for frames and strokes: frames join it
// for their stroke (colour, width, alignment; a frame's fill is its background, the frame
// section's), and selected shapes and frames with a stroke get an Align list. In Chrome:
// tooling/scenario/specs/app/stroke-align.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, Stroke, StrokeAlign } from '@canvas/schema';

import type { SelectionContext, StylePanelSectionProps } from '../panel-sections.js';
import type { StyleToApply } from '../style-changes.js';

import { stylePanelSection } from './fill-stroke-section.js';

const STROKE: Stroke = { color: [0.2, 0.4, 0.6, 0.5], width: 3 };

/**
 * A shape or frame with an optional stroke and alignment.
 *
 * @param id - Its id.
 * @param type - Shape or frame.
 * @param stroke - Its stroke, null or absent for none.
 * @param strokeAlign - Its alignment, absent for inside.
 * @returns The object.
 */
function stroked(
  id: string,
  type: 'shape' | 'frame',
  stroke?: Stroke | null,
  strokeAlign?: StrokeAlign,
): BoardObject {
  return {
    id: id as ObjectId,
    type,
    fill: null,
    ...(stroke === undefined ? {} : { stroke }),
    ...(strokeAlign === undefined ? {} : { strokeAlign }),
  } as BoardObject;
}

/**
 * Renders the section over a selection, or over a tool's style when the selection is empty.
 *
 * @param selection - The selected objects.
 * @param context - What the panel shows; the first object's context by default.
 * @returns The style spy.
 */
function renderSection(selection: readonly BoardObject[], context?: SelectionContext) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const props = {
    context: context ?? (selection[0]?.type === 'frame' ? 'frame' : 'shape'),
    selection,
    board: { get: () => undefined },
    defaults: selection.length === 0 ? { stroke: STROKE } : undefined,
    applyStyle,
    dispatch: vi.fn(),
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { applyStyle };
}

/**
 * What the last style change did to each object (undefined: a creation tool's style): the patch
 * a function change gives it, or the one patch every object gets.
 *
 * @param applyStyle - The spy.
 * @param objects - The objects.
 * @returns Each object's patch.
 */
function patchesOf(
  applyStyle: ReturnType<typeof renderSection>['applyStyle'],
  objects: readonly (BoardObject | undefined)[],
): unknown[] {
  const style = applyStyle.mock.lastCall?.[0];
  return objects.map((object) => (typeof style === 'function' ? style(object) : style));
}

/**
 * The Align list, if shown.
 *
 * @returns The select element, or null.
 */
function alignList(): HTMLSelectElement | null {
  return screen.queryByLabelText<HTMLSelectElement>('Align');
}

afterEach(cleanup);

describe('the fill and stroke section', () => {
  it('registers for shapes, paths and frames at order 7', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'fill-stroke',
      context: ['shape', 'vector', 'frame'],
      order: 7,
    });
  });

  it('shows a frame its stroke and width but no fill, which is its background', () => {
    renderSection([stroked('f', 'frame', STROKE)]);
    expect(screen.queryByText('Fill')).toBeNull();
    expect(screen.getByText('Stroke')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Width/).value).toBe('3');
    renderSection([stroked('s', 'shape', STROKE)]);
    expect(screen.getByText('Fill')).toBeTruthy();
  });

  it('gives a frame without a stroke one from the stroke control, and removes it with none', () => {
    const frame = stroked('f', 'frame');
    const { applyStyle } = renderSection([frame]);
    expect(screen.queryByLabelText(/Width/)).toBeNull();
    expect(alignList()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ink/ }));
    expect(patchesOf(applyStyle, [frame])).toEqual([{ stroke: { color: 'ink', width: 1 } }]);
  });

  it('shows the alignment of stroked shapes and frames, inside when absent, and Mixed', () => {
    renderSection([stroked('a', 'shape', STROKE), stroked('b', 'shape', STROKE, 'inside')]);
    expect(alignList()?.value).toBe('inside');
    cleanup();
    renderSection([stroked('f', 'frame', STROKE, 'outside')]);
    expect(alignList()?.value).toBe('outside');
    cleanup();
    // An unstroked shape has nothing to align, so it does not make the list Mixed.
    renderSection([
      stroked('a', 'shape', STROKE, 'center'),
      stroked('b', 'shape', null, 'outside'),
    ]);
    expect(alignList()?.value).toBe('center');
    cleanup();
    renderSection([stroked('a', 'shape', STROKE), stroked('b', 'shape', STROKE, 'outside')]);
    expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Mixed' }).disabled).toBe(true);
  });

  it('sets the chosen alignment alone, as one style change', () => {
    const objects = [stroked('a', 'shape', STROKE), stroked('f', 'frame', STROKE, 'center')];
    const { applyStyle } = renderSection(objects, 'shape');
    const list = alignList();
    if (list === null) throw new Error('No Align list');
    fireEvent.change(list, { target: { value: 'outside' } });
    expect(applyStyle).toHaveBeenCalledTimes(1);
    expect(patchesOf(applyStyle, objects)).toEqual([
      { strokeAlign: 'outside' },
      { strokeAlign: 'outside' },
    ]);
  });

  it('sets the alignment only on the selected objects with a stroke', () => {
    const objects = [
      stroked('a', 'shape', STROKE),
      stroked('bare', 'shape', null),
      stroked('f', 'frame', STROKE),
    ];
    const { applyStyle } = renderSection(objects, 'shape');
    const list = alignList();
    if (list === null) throw new Error('No Align list');
    fireEvent.change(list, { target: { value: 'center' } });
    expect(patchesOf(applyStyle, [...objects, undefined])).toEqual([
      { strokeAlign: 'center' },
      {},
      { strokeAlign: 'center' },
      {},
    ]);
  });

  it('is titled Stroke for frames, which have no Fill here, and Fill and stroke otherwise', () => {
    const titleOf = (context: SelectionContext) =>
      stylePanelSection.titleFor?.({ context } as StylePanelSectionProps);
    expect(titleOf('frame')).toBe('Stroke');
    expect(titleOf('shape')).toBe('Fill and stroke');
    expect(titleOf('vector')).toBe('Fill and stroke');
    expect(stylePanelSection.title).toBe('Fill and stroke');
  });

  it('offers no alignment for paths, or for a creation tool’s style', () => {
    renderSection([{ ...stroked('p', 'shape', STROKE), type: 'path' } as BoardObject], 'vector');
    expect(alignList()).toBeNull();
    cleanup();
    renderSection([], 'shape');
    expect(screen.getByLabelText<HTMLInputElement>(/Width/).value).toBe('3');
    expect(alignList()).toBeNull();
  });
});
