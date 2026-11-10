// @vitest-environment jsdom
// The style panel's note section in jsdom: the palette over the selected notes or the sticky
// tool's style, one style change per pick, the pick also the next note's colour. In Chrome:
// tooling/scenario/specs/tools/sticky.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUILTIN_TOKEN_DEFAULTS,
  type BoardObject,
  type Color,
  type ObjectId,
  type Rgba,
  type StickyObject,
} from '@canvas/schema';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '@canvas/tools';

import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';
import { patchFor, type StyleToApply } from '../style-changes.js';

import { stylePanelSection } from './note-section.js';

const BLUE: Rgba = [0.66, 0.84, 0.98, 1];
const PINK: Rgba = [1, 0.74, 0.8, 1];

function note(id: string, color: Color): StickyObject {
  return { id: id as ObjectId, type: 'sticky', color } as StickyObject;
}

function renderSection(
  selection: readonly BoardObject[],
  defaults?: StylePanelSectionProps['defaults'],
) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props = {
    context: 'note',
    selection,
    defaults,
    applyStyle,
    dispatch,
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { applyStyle, dispatch };
}

function pressed(): string[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.getAttribute('aria-label') ?? '');
}

afterEach(cleanup);

describe('the note section', () => {
  it('registers for the note context, first among its sections, for notes and the sticky tool', () => {
    expect(stylePanelSection).toMatchObject({ id: 'note', title: 'Note', context: 'note' });
    expect(stylePanelSection.order).toBeLessThan(10);
    expect(stylePanelSection.isSelectionOnly).toBeUndefined();
  });

  it('shows one swatch per palette colour, named, the selected notes’ colour pressed', () => {
    renderSection([note('a', BLUE), note('b', BLUE)]);
    const palette = within(screen.getByRole('group', { name: 'Note colour' }));
    const names = palette.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(NOTE_COLORS.map(({ name }) => name));
    expect(pressed()).toEqual(['Blue']);
  });

  it('presses no swatch when the selected notes differ', () => {
    renderSection([note('a', BLUE), note('b', PINK)]);
    expect(pressed()).toEqual([]);
  });

  it('recolours the selected notes in one change, and makes the pick the next note’s colour', () => {
    const { applyStyle, dispatch } = renderSection([note('a', BLUE), note('b', PINK)]);
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(applyStyle).toHaveBeenCalledTimes(1);
    const [style] = applyStyle.mock.calls[0] ?? [];
    expect(style && patchFor(style, undefined)).toEqual({ color: [0.74, 0.91, 0.66, 1] });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setToolStyle',
      tool: 'sticky',
      style: { color: [0.74, 0.91, 0.66, 1] },
    });
  });

  it('with nothing selected, shows and sets the sticky tool’s colour alone', () => {
    const { applyStyle, dispatch } = renderSection([], { color: PINK });
    expect(pressed()).toEqual(['Pink']);
    fireEvent.click(screen.getByRole('button', { name: 'Yellow' }));
    expect(applyStyle).toHaveBeenCalledWith({ color: DEFAULT_NOTE_COLOR });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps the focus where it was when a swatch is pressed, so editing goes on', () => {
    renderSection([note('a', BLUE)]);
    const swatch = screen.getByRole('button', { name: 'Pink' });
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    swatch.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it('picks a colour token for the notes and the tool, and presses no swatch for it', () => {
    const { applyStyle, dispatch } = renderSection([note('a', BLUE)]);
    fireEvent.click(screen.getByRole('button', { name: 'Note colour tokens' }));
    fireEvent.click(screen.getByRole('button', { name: 'accent' }));
    expect(applyStyle).toHaveBeenCalledWith({ color: { token: 'accent' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setToolStyle',
      tool: 'sticky',
      style: { color: { token: 'accent' } },
    });
    cleanup();
    renderSection([note('a', { token: 'surface' })]);
    expect(pressed()).toEqual([]);
    expect(screen.getByText('surface')).toBeTruthy();
  });

  it('detaches a token to its value in the light mode by default', () => {
    const { applyStyle } = renderSection([note('a', { token: 'surface' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Detach colour' }));
    expect(applyStyle).toHaveBeenCalledWith({ color: BUILTIN_TOKEN_DEFAULTS.surface.light });
  });
});
