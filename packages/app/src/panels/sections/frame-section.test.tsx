// @vitest-environment jsdom
// The style panel's frame section in jsdom: the selected frames' background,
// clipping and name display, one style change each. In Chrome: tooling/scenario/specs/tools/frame.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, FrameObject, ObjectId, Rgba } from '@canvas/schema';

import type { StylePanelSectionProps } from '../panel-sections.js';
import type { StyleToApply } from '../style-changes.js';

import { stylePanelSection } from './frame-section.js';

/**
 * A frame with a background and clipping.
 *
 * @param id - Its id.
 * @param background - Its background.
 * @param isClipped - Whether it clips.
 * @returns The frame.
 */
function frame(id: string, background: Rgba | null, isClipped: boolean): FrameObject {
  return { id: id as ObjectId, type: 'frame', background, clip: isClipped } as FrameObject;
}

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected objects.
 * @param others - Other objects on the board (a selected frame's ancestors).
 * @returns The style spy.
 */
function renderSection(selection: readonly BoardObject[], others: readonly BoardObject[] = []) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const objects = new Map([...selection, ...others].map((object) => [object.id, object]));
  const props = {
    context: 'frame',
    selection,
    board: { get: (id: ObjectId) => objects.get(id) },
    defaults: undefined,
    applyStyle,
    dispatch: vi.fn(),
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { applyStyle };
}

/**
 * Commits a number the way the browser does: the input's value, then its `change` event.
 *
 * @param label - The field's label.
 * @param value - The value.
 */
function commit(label: string | RegExp, value: string): void {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The patch a style to apply gives an object.
 *
 * @param style - The style.
 * @param object - The object.
 * @returns Its patch.
 */
function patchFor(style: StyleToApply, object: BoardObject): unknown {
  return typeof style === 'function' ? style(object) : style;
}

afterEach(cleanup);

describe('the frame section', () => {
  it('registers for frames only, never for a tool’s style', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'frame',
      title: 'Frame',
      context: 'frame',
      isSelectionOnly: true,
    });
  });

  it('shows the clipping pressed, and toggles it as one style change', () => {
    const { applyStyle } = renderSection([frame('a', [1, 1, 1, 1], true)]);
    const toggle = screen.getByRole('button', { name: 'Clip content' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(applyStyle).toHaveBeenCalledWith({ clip: false });
  });

  it('shows mixed clipping as mixed, and turns it on', () => {
    const { applyStyle } = renderSection([frame('a', null, true), frame('b', null, false)]);
    const toggle = screen.getByRole('button', { name: 'Clip content' });
    expect(toggle.getAttribute('aria-pressed')).toBe('mixed');
    fireEvent.click(toggle);
    expect(applyStyle).toHaveBeenCalledWith({ clip: true });
  });

  it('shows a root frame’s name as shown by default, and hides it explicitly', () => {
    const root = { ...frame('a', null, false), parentId: null };
    const { applyStyle } = renderSection([root]);
    const toggle = screen.getByRole('button', { name: 'Show name' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(applyStyle).toHaveBeenCalledWith({ showName: false });
  });

  it('shows the name of a frame inside a frame as hidden by default, and shows it explicitly', () => {
    const outer = { ...frame('outer', null, false), parentId: null };
    const nested = { ...frame('a', null, false), parentId: 'outer' as ObjectId };
    const { applyStyle } = renderSection([nested], [outer]);
    const toggle = screen.getByRole('button', { name: 'Show name' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(applyStyle).toHaveBeenCalledWith({ showName: true });
  });

  it('shows the name of a frame in a group at the root as shown by default', () => {
    const grouped = { ...frame('a', null, false), parentId: 'g' as ObjectId };
    const group = { id: 'g' as ObjectId, type: 'group', parentId: null } as BoardObject;
    renderSection([grouped], [group]);
    const toggle = screen.getByRole('button', { name: 'Show name' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('follows an explicit showName, and shows a mix as mixed', () => {
    const shown = { ...frame('a', null, false), parentId: 'outer' as ObjectId, showName: true };
    const hidden = { ...frame('b', null, false), parentId: null, showName: false };
    renderSection([shown]);
    expect(screen.getByRole('button', { name: 'Show name' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    cleanup();
    const { applyStyle } = renderSection([shown, hidden]);
    const toggle = screen.getByRole('button', { name: 'Show name' });
    expect(toggle.getAttribute('aria-pressed')).toBe('mixed');
    fireEvent.click(toggle);
    expect(applyStyle).toHaveBeenCalledWith({ showName: true });
  });

  it('shows an absent corner radius as 0 and sets one radius for every frame', () => {
    const { applyStyle } = renderSection([frame('a', null, false), frame('b', null, false)]);
    const field = screen.getByLabelText<HTMLInputElement>('Corner radius');
    expect(field.value).toBe('0');
    expect(field.hasAttribute('data-mixed')).toBe(false);
    commit('Corner radius', '12');
    expect(applyStyle).toHaveBeenCalledWith({ cornerRadius: 12 });
  });

  it('reads Mixed when frames or one frame’s corners differ', () => {
    renderSection([{ ...frame('a', null, false), cornerRadius: [4, 8, 12, 16] }]);
    expect(screen.getByLabelText(/^Corner radius/).hasAttribute('data-mixed')).toBe(true);
    cleanup();
    renderSection([
      { ...frame('a', null, false), cornerRadius: 4 },
      { ...frame('b', null, false), cornerRadius: [4, 4, 4, 4] },
    ]);
    expect(screen.getByLabelText<HTMLInputElement>('Corner radius').value).toBe('4');
    cleanup();
    renderSection([
      { ...frame('a', null, false), cornerRadius: 4 },
      { ...frame('b', null, false), cornerRadius: 6 },
    ]);
    expect(screen.getByLabelText(/^Corner radius/).hasAttribute('data-mixed')).toBe(true);
  });

  it('edits each corner behind Independent corners, keeping the others', () => {
    const rounded = { ...frame('a', null, false), cornerRadius: [4, 8, 12, 16] as const };
    const sharp = frame('b', null, false);
    const { applyStyle } = renderSection([rounded, sharp]);
    expect(screen.queryByLabelText('Top left radius')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Independent corners' }));
    expect(screen.getByLabelText(/Top left radius/).hasAttribute('data-mixed')).toBe(true);
    commit(/Bottom right radius/, '30');
    const style = applyStyle.mock.lastCall?.[0];
    expect(style && patchFor(style, rounded)).toEqual({ cornerRadius: [4, 8, 30, 16] });
    expect(style && patchFor(style, sharp)).toEqual({ cornerRadius: [0, 0, 30, 0] });
    expect(style && patchFor(style, { id: 's', type: 'shape' } as BoardObject)).toEqual({});
  });

  it('takes the background away with None, as one style change', () => {
    const { applyStyle } = renderSection([frame('a', [1, 1, 1, 1], false)]);
    const none = screen.getByRole('button', { name: 'No background' });
    expect(none.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(none);
    expect(applyStyle).toHaveBeenCalledWith({ background: null });
  });
});
