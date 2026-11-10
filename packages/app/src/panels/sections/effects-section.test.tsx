// @vitest-environment jsdom
// The style panel's effects section in jsdom: a drop shadow on the selected shapes
// and frames, turned on and off and edited field by field, one style change each. In Chrome:
// tooling/scenario/specs/app/effects-shadow.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SHADOW,
  type BoardObject,
  type ObjectId,
  type Shadow,
  type ShapeObject,
} from '@canvas/schema';

import type { StylePanelSectionProps } from '../panel-sections.js';
import type { StyleToApply } from '../style-changes.js';

import { stylePanelSection } from './effects-section.js';

const SHADOW: Shadow = { x: 2, y: 6, blur: 12, spread: -1, color: [0.2, 0.4, 0.6, 0.5] };

/**
 * A shape or frame with an optional shadow.
 *
 * @param id - Its id.
 * @param type - Shape or frame.
 * @param shadow - Its shadow, null or absent for none.
 * @returns The object.
 */
function shadowed(id: string, type: 'shape' | 'frame', shadow?: Shadow | null): BoardObject {
  return { id: id as ObjectId, type, ...(shadow === undefined ? {} : { shadow }) } as BoardObject;
}

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected objects.
 * @returns The style spy.
 */
function renderSection(selection: readonly BoardObject[]) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const props = {
    context: selection[0]?.type === 'frame' ? 'frame' : 'shape',
    selection,
    board: { get: () => undefined },
    defaults: undefined,
    applyStyle,
    dispatch: vi.fn(),
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { applyStyle };
}

/**
 * What the last style change did to each object: the patch a function change gives it.
 *
 * @param applyStyle - The spy.
 * @param objects - The objects.
 * @returns Each object's patch.
 * @throws {Error} When the last change was not a style change per object.
 */
function patchesOf(
  applyStyle: ReturnType<typeof renderSection>['applyStyle'],
  objects: readonly BoardObject[],
): unknown[] {
  const style = applyStyle.mock.lastCall?.[0];
  if (typeof style !== 'function') throw new Error('Expected a style change per object.');
  return objects.map((object) => style(object));
}

/**
 * Commits a number into a labelled field.
 *
 * @param label - The field's name, as a pattern (a short label shows before it).
 * @param value - What to type.
 */
function commitNumber(label: string, value: string): void {
  const input = screen.getByLabelText<HTMLInputElement>(new RegExp(label));
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * A labelled field's value.
 *
 * @param label - The field's name, as a pattern.
 * @returns Its value.
 */
function valueOf(label: string): string {
  return screen.getByLabelText<HTMLInputElement>(new RegExp(label)).value;
}

afterEach(cleanup);

describe('the effects section', () => {
  it('registers for shapes and frames at order 50, never for a tool’s style', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'effects',
      title: 'Effects',
      context: ['shape', 'frame'],
      order: 50,
      isSelectionOnly: true,
    });
  });

  it('turns the default shadow on for each object without one, as one style change', () => {
    const objects = [shadowed('a', 'shape'), shadowed('b', 'frame', null)];
    const { applyStyle } = renderSection(objects);
    const toggle = screen.getByRole('button', { name: 'Drop shadow' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByLabelText(/Shadow blur/)).toBeNull();
    fireEvent.click(toggle);
    expect(applyStyle).toHaveBeenCalledTimes(1);
    expect(patchesOf(applyStyle, objects)).toEqual([
      { shadow: DEFAULT_SHADOW },
      { shadow: DEFAULT_SHADOW },
    ]);
  });

  it('shows a mix as mixed; turning it on keeps the shadows there are', () => {
    const objects = [shadowed('a', 'shape', SHADOW), shadowed('b', 'shape')];
    const { applyStyle } = renderSection(objects);
    const toggle = screen.getByRole('button', { name: 'Drop shadow' });
    expect(toggle.getAttribute('aria-pressed')).toBe('mixed');
    fireEvent.click(toggle);
    expect(patchesOf(applyStyle, objects)).toEqual([{}, { shadow: DEFAULT_SHADOW }]);
  });

  it('turns shadows off with null, leaving objects without one alone', () => {
    const objects = [shadowed('a', 'frame', SHADOW), shadowed('b', 'frame', SHADOW)];
    const { applyStyle } = renderSection(objects);
    const toggle = screen.getByRole('button', { name: 'Drop shadow' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(patchesOf(applyStyle, [...objects, shadowed('c', 'shape')])).toEqual([
      { shadow: null },
      { shadow: null },
      {},
    ]);
  });

  it('shows one shadow’s fields and sets one field on every shadowed object', () => {
    const objects = [shadowed('a', 'shape', SHADOW), shadowed('b', 'shape')];
    const { applyStyle } = renderSection(objects);
    expect(valueOf('Shadow x')).toBe('2');
    expect(valueOf('Shadow y')).toBe('6');
    expect(valueOf('Shadow blur')).toBe('12');
    expect(valueOf('Shadow spread')).toBe('-1');
    expect(valueOf('Shadow opacity')).toBe('50');
    commitNumber('Shadow blur', '20');
    expect(patchesOf(applyStyle, objects)).toEqual([{ shadow: { ...SHADOW, blur: 20 } }, {}]);
    commitNumber('Shadow opacity', '80');
    expect(patchesOf(applyStyle, objects)).toEqual([
      { shadow: { ...SHADOW, color: [0.2, 0.4, 0.6, 0.8] } },
      {},
    ]);
  });

  it('shows differing fields as mixed, and a colour keeps each shadow’s own opacity', () => {
    const other: Shadow = { ...SHADOW, x: 9, color: [0, 0, 0, 0.25] };
    const objects = [shadowed('a', 'shape', SHADOW), shadowed('b', 'frame', other)];
    const { applyStyle } = renderSection(objects);
    expect(valueOf('Shadow x \\(mixed\\)')).toBe('');
    expect(valueOf('Shadow opacity \\(mixed\\)')).toBe('');
    expect(screen.getByLabelText('Shadow colour (mixed)')).toBeDefined();
    expect(valueOf('Shadow y')).toBe('6');
    commitNumber('Shadow x \\(mixed\\)', '3');
    expect(patchesOf(applyStyle, objects)).toEqual([
      { shadow: { ...SHADOW, x: 3 } },
      { shadow: { ...other, x: 3 } },
    ]);
    const picker = screen.getByLabelText('Shadow colour (mixed)');
    fireEvent.change(picker, { target: { value: '#ff0000' } });
    const patches = patchesOf(applyStyle, objects) as { shadow: Shadow }[];
    expect(patches.map(({ shadow }) => shadow.color)).toEqual([
      [1, 0, 0, 0.5],
      [1, 0, 0, 0.25],
    ]);
  });

  it('reads only shapes’ and frames’ shadows', () => {
    const sticky = { id: 'n' as ObjectId, type: 'sticky' } as BoardObject;
    const shape = shadowed('a', 'shape', SHADOW) as ShapeObject;
    const { applyStyle } = renderSection([shape, sticky]);
    commitNumber('Shadow x', '5');
    expect(patchesOf(applyStyle, [shape, sticky])).toEqual([{ shadow: { ...SHADOW, x: 5 } }, {}]);
  });
});
