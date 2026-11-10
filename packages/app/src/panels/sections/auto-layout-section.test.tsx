// @vitest-environment jsdom
// The inspector's auto-layout section in jsdom: add, edit and remove a frame's or
// main's live auto-layout, one `autoLayout` canvas action each. In Chrome:
// tooling/scenario/specs/app/inspector-auto-layout.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_AUTO_LAYOUT,
  type AutoLayout,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './auto-layout-section.js';

/** A row with some gap and padding. */
const ROW: AutoLayout = {
  ...DEFAULT_AUTO_LAYOUT,
  gap: 8,
  padding: { top: 1, right: 2, bottom: 3, left: 4 },
};

/**
 * A frame or main, with or without an auto-layout.
 *
 * @param id - Its id.
 * @param autoLayout - Its auto-layout, if any.
 * @param type - Frame or component.
 * @returns The container.
 */
function container(
  id: string,
  autoLayout?: AutoLayout,
  type: 'frame' | 'component' = 'frame',
): BoardObject {
  return {
    id: id as ObjectId,
    type,
    ...(autoLayout === undefined ? {} : { autoLayout }),
  } as BoardObject;
}

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected containers.
 * @returns The dispatch spy.
 */
function renderSection(selection: readonly BoardObject[]) {
  const dispatch = vi.fn();
  const objects = new Map(selection.map((object) => [object.id, object]));
  const props = {
    context: 'frame',
    selection,
    board: { get: (id: ObjectId) => objects.get(id) },
    defaults: undefined,
    applyStyle: vi.fn(),
    dispatch,
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { dispatch };
}

/**
 * Commits a number field as the person does: a new value, then its `change` event.
 *
 * @param name - The field's accessible name.
 * @param value - The value typed.
 */
function commitNumber(name: string, value: string): void {
  const field = screen.getByRole('spinbutton', { name: new RegExp(`^${name}`) });
  (field as HTMLInputElement).value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(cleanup);

describe('the auto-layout section', () => {
  it('registers for frames and mains, after the frame section and before fill', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'auto-layout',
      title: 'Auto layout',
      context: ['frame', 'component', 'mixed'],
      order: 6,
      isSelectionOnly: true,
    });
  });

  it('shows in a mixed selection only when every object is a frame or a main', () => {
    const shape = { id: 's' as ObjectId, type: 'shape' } as BoardObject;
    expect(
      stylePanelSection.isShownFor?.([container('f'), container('m', undefined, 'component')]),
    ).toBe(true);
    expect(stylePanelSection.isShownFor?.([container('f'), shape])).toBe(false);
  });

  it('offers only to add one when no container has one, adding the default', () => {
    const { dispatch } = renderSection([container('f'), container('m', undefined, 'component')]);
    expect(screen.queryByRole('spinbutton', { name: /^Gap/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add auto layout' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'autoLayout',
      ids: ['f', 'm'],
      change: { kind: 'set', autoLayout: DEFAULT_AUTO_LAYOUT },
    });
  });

  it('shows the layout, and patches one field across the containers that have one', () => {
    const { dispatch } = renderSection([
      container('a', ROW),
      container('b', { ...ROW, direction: 'column', gap: 3 }),
    ]);
    expect(screen.getByRole('combobox', { name: 'Direction' })).toHaveProperty('value', '');
    expect(screen.getByRole('spinbutton', { name: /^Gap/ })).toHaveProperty('value', '');
    expect(screen.getByRole('spinbutton', { name: /^Padding top/ })).toHaveProperty('value', '1');
    commitNumber('Gap', '12');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'autoLayout',
      ids: ['a', 'b'],
      change: { kind: 'patch', patch: { gap: 12 } },
    });
    commitNumber('Padding left', '6');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'autoLayout',
      ids: ['a', 'b'],
      change: { kind: 'patch', patch: { padding: { left: 6 } } },
    });
  });

  it.each([
    ['Direction', 'column', { direction: 'column' }],
    ['Align', 'stretch', { align: 'stretch' }],
    ['Justify', 'space-between', { justify: 'space-between' }],
    ['Width', 'fixed', { width: 'fixed' }],
    ['Height', 'fixed', { height: 'fixed' }],
  ])('patches %s from its list', (name, value, patch) => {
    const { dispatch } = renderSection([container('a', ROW)]);
    fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'autoLayout',
      ids: ['a'],
      change: { kind: 'patch', patch },
    });
  });

  it('removes the layouts it shows, and adds one to the containers without', () => {
    const { dispatch } = renderSection([container('a', ROW), container('b')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove auto layout' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'autoLayout',
      ids: ['a'],
      change: { kind: 'set', autoLayout: null },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add auto layout' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'autoLayout',
      ids: ['b'],
      change: { kind: 'set', autoLayout: DEFAULT_AUTO_LAYOUT },
    });
  });

  it('summarises the layout when collapsed', () => {
    const summary = stylePanelSection.summary?.({
      selection: [container('a', { ...ROW, direction: 'column' })],
    } as unknown as StylePanelSectionProps);
    expect(summary).toBe('Column, gap 8');
    expect(
      stylePanelSection.summary?.({
        selection: [container('a')],
      } as unknown as StylePanelSectionProps),
    ).toBe('None');
  });
});
