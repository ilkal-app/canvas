// @vitest-environment jsdom
// The style panel's shape section in jsdom, as the panel mounts it: the kind, a rectangle's
// corner radius and a polygon's sides or a star's points, for shapes, a mixed selection and the
// shape tool's style; each committed choice is one `applyStyle` setting that field alone, and a
// kind picked for shapes becomes the tool's. In Chrome: tooling/scenario/specs/tools/shape.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId, ShapeObject } from '@canvas/schema';

import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';
import { patchFor, type StyleToApply } from '../style-changes.js';

import { stylePanelSection } from './shape-section.js';

/**
 * A shape.
 *
 * @param id - Its id.
 * @param overrides - Fields to change.
 * @returns The shape.
 */
function shape(id: string, overrides: Partial<ShapeObject> = {}): ShapeObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 0,
    updatedAt: 0,
    width: 100,
    height: 60,
    kind: 'rectangle',
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 8,
    sides: 5,
    label: null,
    ...overrides,
  };
}

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected objects; none for the shape tool's style.
 * @param defaults - The shape tool's style, with nothing selected.
 * @returns What `applyStyle` and `dispatch` received.
 */
function renderSection(
  selection: readonly BoardObject[],
  defaults?: StylePanelSectionProps['defaults'],
) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props = {
    context: 'shape',
    selection,
    board: { get: () => undefined },
    defaults,
    dispatch,
    applyStyle,
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { applyStyle, dispatch };
}

/**
 * The value of the field with a label.
 *
 * @param label - The label.
 * @returns The input's or select's value.
 */
function valueOf(label: string): string {
  const element = screen.getByLabelText(label);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? element.value
    : '';
}

/**
 * Commits a number the way the browser does: the input's value, then its `change` event.
 *
 * @param label - The field's label.
 * @param value - The value.
 */
function commit(label: string, value: string): void {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(cleanup);

describe('the shape section', () => {
  it('registers first for shapes and the shape tool', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'shape',
      title: 'Shape',
      context: 'shape',
      order: 5,
    });
  });

  it("shows a rectangle's kind and corner radius, and no sides", () => {
    renderSection([shape('a')]);
    expect(valueOf('Kind')).toBe('rectangle');
    expect(valueOf('Corner radius')).toBe('8');
    expect(screen.queryByLabelText('Sides')).toBeNull();
  });

  it("shows a star's points and a polygon's sides, and no corner radius", () => {
    renderSection([shape('s', { kind: 'star', sides: 6 })]);
    expect(valueOf('Points')).toBe('6');
    expect(screen.queryByLabelText('Corner radius')).toBeNull();
    cleanup();
    renderSection([shape('p', { kind: 'polygon', sides: 3 })]);
    expect(valueOf('Sides')).toBe('3');
  });

  it('picks a kind for the selection as one change, and makes it the tool’s next kind', () => {
    const { applyStyle, dispatch } = renderSection([shape('a'), shape('b')]);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'ellipse' } });
    expect(applyStyle).toHaveBeenCalledExactlyOnceWith({ kind: 'ellipse' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'setToolStyle',
      tool: 'shape',
      style: { kind: 'ellipse' },
    });
  });

  it('shows Mixed for kinds that differ, and sets a radius or a count only where it applies', () => {
    const star = shape('s', { kind: 'star', sides: 5 });
    const polygon = shape('p', { kind: 'polygon', sides: 8 });
    const rectangle = shape('r');
    const { applyStyle } = renderSection([star, polygon, rectangle]);
    expect(screen.getByLabelText('Kind').textContent).toContain('Mixed');
    expect(valueOf('Sides (mixed)')).toBe('');
    commit('Sides (mixed)', '7');
    const sides = applyStyle.mock.lastCall?.[0];
    expect(sides && patchFor(sides, star)).toEqual({ sides: 7 });
    expect(sides && patchFor(sides, polygon)).toEqual({ sides: 7 });
    expect(sides && patchFor(sides, rectangle)).toEqual({});
    commit('Corner radius', '20');
    const radius = applyStyle.mock.lastCall?.[0];
    expect(radius && patchFor(radius, rectangle)).toEqual({ cornerRadius: 20 });
    expect(radius && patchFor(radius, star)).toEqual({});
    expect(applyStyle).toHaveBeenCalledTimes(2);
  });

  it("shows and edits the shape tool's style with nothing selected, the tool's kind alone", () => {
    const { applyStyle, dispatch } = renderSection([], { kind: 'polygon', sides: 6 });
    expect(valueOf('Kind')).toBe('polygon');
    expect(valueOf('Sides')).toBe('6');
    commit('Sides', '9');
    const sides = applyStyle.mock.lastCall?.[0];
    expect(sides && patchFor(sides, undefined)).toEqual({ sides: 9 });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'rectangle' } });
    expect(applyStyle).toHaveBeenLastCalledWith({ kind: 'rectangle' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('shows the default style while the tool has none of its own', () => {
    renderSection([]);
    expect(valueOf('Kind')).toBe('rectangle');
    expect(valueOf('Corner radius')).toBe('0');
  });

  it('ignores selected objects that are not shapes', () => {
    renderSection([shape('a'), { ...shape('f'), type: 'frame' } as unknown as BoardObject]);
    expect(valueOf('Kind')).toBe('rectangle');
  });
});
