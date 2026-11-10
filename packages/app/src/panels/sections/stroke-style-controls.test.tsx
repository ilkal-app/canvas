// @vitest-environment jsdom
// The stroke style controls in jsdom: what the Dash, Join, Miter limit and Cap lists
// show for paths, lines and mixed selections, and that each choice is one `applyStyle` setting
// those fields alone. In Chrome, over the real document: tooling/scenario/specs/app/stroke-style.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, LineObject, ObjectId, PathObject, PrincipalId } from '@canvas/schema';

import type { StylePanelSectionProps } from '../panel-sections.js';
import { patchFor, type StyleToApply } from '../style-changes.js';

import { stylePanelSection as fillStrokeSection } from './fill-stroke-section.js';
import { stylePanelSection as lineSection } from './line-section.js';
import { StrokeStyleControls } from './stroke-style-controls.js';

const BASE = {
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 0,
  updatedAt: 0,
};

/**
 * A pen path.
 *
 * @param id - Its id.
 * @param overrides - Fields to change.
 * @returns The path.
 */
function path(id: string, overrides: Partial<PathObject> = {}): PathObject {
  return {
    ...BASE,
    id: id as ObjectId,
    type: 'path',
    vertices: [],
    segments: [],
    stroke: { color: [0, 0, 0, 1], width: 2 },
    fill: null,
    ...overrides,
  };
}

/**
 * A line.
 *
 * @param id - Its id.
 * @param overrides - Fields to change.
 * @returns The line.
 */
function line(id: string, overrides: Partial<LineObject> = {}): LineObject {
  return {
    ...BASE,
    id: id as ObjectId,
    type: 'line',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    route: 'straight',
    stroke: { color: [1, 0, 0, 1], width: 3 },
    startCap: 'none',
    endCap: 'arrow',
    ...overrides,
  };
}

/**
 * Renders the controls over a selection.
 *
 * @param selection - The selected objects.
 * @returns What `applyStyle` received.
 */
function renderControls(selection: readonly BoardObject[]) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  render(<StrokeStyleControls selection={selection} applyStyle={applyStyle} />);
  return applyStyle;
}

/**
 * The value of the field with a label.
 *
 * @param label - The label.
 * @returns The select's or input's value.
 */
function valueOf(label: string): string {
  const element = screen.getByLabelText(label);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? element.value
    : '';
}

/**
 * Chooses a value in a list.
 *
 * @param label - The list's label.
 * @param value - The value.
 */
function choose(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(cleanup);

describe('StrokeStyleControls', () => {
  it('shows an unstyled path as solid, round-joined and round-capped', () => {
    renderControls([path('p')]);
    expect(valueOf('Dash')).toBe('solid');
    expect(valueOf('Join')).toBe('round');
    expect(valueOf('Cap')).toBe('round');
    expect(screen.queryByLabelText('Miter limit')).toBeNull();
  });

  it('shows nothing without a path, line or connector', () => {
    const { container } = render(
      <StrokeStyleControls selection={[]} applyStyle={() => undefined} />,
    );
    expect(container.childElementCount).toBe(0);
  });

  it('sets a preset dash scaled by each object’s width, and solid as null', () => {
    const thick = path('thick', { stroke: { color: [0, 0, 0, 1], width: 5 } });
    const applyStyle = renderControls([path('p'), thick]);
    choose('Dash', 'dashed');
    expect(applyStyle).toHaveBeenCalledTimes(1);
    const style = applyStyle.mock.lastCall?.[0];
    expect(style && patchFor(style, path('p'))).toEqual({ strokeDash: { pattern: [8, 8] } });
    expect(style && patchFor(style, thick)).toEqual({ strokeDash: { pattern: [20, 20] } });
    // A tool's style and other types take none.
    expect(style && patchFor(style, undefined)).toEqual({});
    choose('Dash', 'solid');
    const solid = applyStyle.mock.lastCall?.[0];
    expect(solid && patchFor(solid, thick)).toEqual({ strokeDash: null });
  });

  it('rounds a butt-capped stroke made dotted, so its dots show', () => {
    const butt = path('b', { strokeCap: 'butt' });
    const applyStyle = renderControls([butt]);
    choose('Dash', 'dotted');
    const style = applyStyle.mock.lastCall?.[0];
    expect(style && patchFor(style, butt)).toEqual({
      strokeDash: { pattern: [0, 4] },
      strokeCap: 'round',
    });
    expect(style && patchFor(style, path('p'))).toEqual({ strokeDash: { pattern: [0, 4] } });
  });

  it('recognises the presets and shows a pattern set elsewhere as Custom', () => {
    renderControls([path('p', { strokeDash: { pattern: [0, 4] } })]);
    expect(valueOf('Dash')).toBe('dotted');
    cleanup();
    const applyStyle = renderControls([path('p', { strokeDash: { pattern: [8, 8], offset: 2 } })]);
    expect(valueOf('Dash')).toBe('custom');
    choose('Dash', 'custom');
    expect(applyStyle).not.toHaveBeenCalled();
  });

  it('shows Mixed where the selection disagrees', () => {
    renderControls([
      path('p'),
      path('q', { strokeJoin: 'bevel', strokeDash: { pattern: [8, 8] } }),
    ]);
    expect(screen.getByLabelText('Join').textContent).toContain('Mixed');
    expect(screen.getByLabelText('Dash').textContent).toContain('Mixed');
  });

  it('sets the join, and shows and sets the miter limit only for miter joins', () => {
    const applyStyle = renderControls([path('p')]);
    choose('Join', 'miter');
    expect(applyStyle).toHaveBeenLastCalledWith({ strokeJoin: 'miter' });
    cleanup();
    const mitred = renderControls([path('p', { strokeJoin: 'miter' })]);
    expect(valueOf('Miter limit')).toBe('4');
    const input = screen.getByLabelText<HTMLInputElement>('Miter limit');
    input.value = '10';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(mitred).toHaveBeenLastCalledWith({ strokeMiterLimit: 10 });
  });

  it('sets the cap', () => {
    const applyStyle = renderControls([path('p')]);
    choose('Cap', 'square');
    expect(applyStyle).toHaveBeenLastCalledWith({ strokeCap: 'square' });
  });

  it('shows the Cap on a line only while an end is undecorated or the shaft is dashed', () => {
    renderControls([line('l', { startCap: 'arrow', endCap: 'triangle' })]);
    expect(screen.queryByLabelText('Cap')).toBeNull();
    cleanup();
    renderControls([
      line('l', { startCap: 'arrow', endCap: 'triangle', strokeDash: { pattern: [1, 1] } }),
    ]);
    expect(valueOf('Cap')).toBe('round');
    cleanup();
    renderControls([line('l', { strokeCap: 'butt' })]);
    expect(valueOf('Cap')).toBe('butt');
  });
});

describe('in the sections', () => {
  const props = (selection: readonly BoardObject[], context: string): StylePanelSectionProps =>
    ({
      context,
      selection,
      board: { get: () => undefined },
      defaults: undefined,
      activeTool: 'select',
      dispatch: () => undefined,
      applyStyle: () => undefined,
    }) as unknown as StylePanelSectionProps;

  it('shows in the line section for lines, not for the line tool’s style', () => {
    render(<lineSection.render {...props([line('l')], 'line')} />);
    expect(screen.getByLabelText('Dash')).toBeTruthy();
    cleanup();
    render(<lineSection.render {...props([], 'line')} />);
    expect(screen.queryByLabelText('Dash')).toBeNull();
  });

  it('shows in the fill and stroke section for paths, not for shapes', () => {
    render(<fillStrokeSection.render {...props([path('p')], 'vector')} />);
    expect(screen.getByLabelText('Join')).toBeTruthy();
    cleanup();
    render(<fillStrokeSection.render {...props([], 'shape')} />);
    expect(screen.queryByLabelText('Join')).toBeNull();
  });
});
