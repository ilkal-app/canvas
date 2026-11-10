// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShapeObject } from '@canvas/schema';

import type { ShellAction } from '../state/shell-action.js';

import {
  mount,
  preparePopover,
  propsOf,
  rowOf,
  SHAPE,
  SHAPE_2,
  CONNECTOR,
  TEXT,
  TEXT_STYLE,
} from './popover-shape-connector-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Opens a named compact menu and chooses its radio item.
 *
 * @param trigger - The dropdown's accessible name.
 * @param choice - The radio item's accessible name.
 */
function chooseMenu(trigger: RegExp | string, choice: string): void {
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: choice }));
}

/**
 * Opens a named colour palette and chooses its swatch.
 *
 * @param trigger - The colour button's accessible name.
 * @param choice - The swatch's accessible name.
 */
function chooseColour(trigger: RegExp, choice: string): void {
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: choice }));
}

describe('shape selection popover acceptance', () => {
  it('orders shape controls, label controls, Comment and More with one rule', () => {
    const toolbar = mount(propsOf([SHAPE]));
    expect(rowOf(toolbar)).toEqual([
      expect.stringMatching(/^Fill: /),
      expect.stringMatching(/^Stroke: /),
      'Stroke width: 2 px',
      'Shape: Rectangle',
      '|',
      'Font: Lora',
      'Font size: 16',
      'Comment',
      'More',
    ]);
    expect(toolbar.querySelectorAll('[data-popover-divider]')).toHaveLength(1);
  });

  it('shows Mixed for different shape values and hides label controls unless every shape has a label', () => {
    const toolbar = mount(propsOf([SHAPE, { ...SHAPE_2, label: null }]));
    expect(rowOf(toolbar)).toEqual([
      'Fill: Mixed',
      'Stroke: Mixed',
      'Stroke width: Mixed',
      'Shape: Mixed',
      '|',
      // Two shapes also get arrange and Group (item 13), after the row's own rule.
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
      'Comment',
      'More',
    ]);
  });

  it('offers the six shape kinds and all four stroke widths', () => {
    mount(propsOf([SHAPE]));
    fireEvent.click(screen.getByRole('button', { name: 'Shape: Rectangle' }));
    expect(
      within(screen.getByRole('menu', { name: 'Shape' }))
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Rectangle', 'Ellipse', 'Triangle', 'Diamond', 'Polygon', 'Star']);
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Shape' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Stroke width: 2 px' }));
    expect(
      within(screen.getByRole('menu', { name: 'Stroke width' }))
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['1 px', '2 px', '4 px', '8 px']);
  });

  it('dispatches one fill patch per selected shape, including None', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE, SHAPE_2], { dispatch }));
    chooseColour(/^Fill:/, 'None');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: SHAPE.id, style: { fill: null } },
        { id: SHAPE_2.id, style: { fill: null } },
      ],
    });
  });

  it('dispatches normalized RGBA fill once for the whole selection', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE, SHAPE_2], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: /^Fill:/ }));
    const custom = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Hex' });
    fireEvent.change(custom, { target: { value: '#ff8040' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: SHAPE.id, style: { fill: [1, 128 / 255, 64 / 255, 1] } },
        { id: SHAPE_2.id, style: { fill: [1, 128 / 255, 64 / 255, 1] } },
      ],
    });
  });

  it('offers board tokens and dispatches a token reference for fill', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: /^Fill:/ }));
    const boardColours = within(screen.getByRole('dialog')).getByRole('group', {
      name: 'Board colours',
    });
    fireEvent.click(within(boardColours).getByRole('button', { name: 'accent' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: SHAPE.id, style: { fill: { token: 'accent' } } }],
    });
  });

  it('keeps each shape stroke width on colour change and clears strokes with None', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE, SHAPE_2], { dispatch }));
    chooseColour(/^Stroke:/, 'None');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: SHAPE.id, style: { stroke: null } },
        { id: SHAPE_2.id, style: { stroke: null } },
      ],
    });
    dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Stroke:/ }));
    const custom = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Hex' });
    fireEvent.change(custom, { target: { value: '#ff8040' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        {
          id: SHAPE.id,
          style: { stroke: { ...SHAPE.stroke, color: [1, 128 / 255, 64 / 255, 1] } },
        },
        {
          id: SHAPE_2.id,
          style: { stroke: { ...SHAPE_2.stroke, color: [1, 128 / 255, 64 / 255, 1] } },
        },
      ],
    });
  });

  it('adds a default 2 px stroke to a shape without one when a stroke colour is chosen', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const bare = { ...SHAPE, stroke: null };
    mount(propsOf([bare], { dispatch }));
    chooseColour(/^Stroke:/, 'accent');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: bare.id, style: { stroke: { width: 2, color: { token: 'accent' } } } }],
    });
  });

  it('changes width only on stroked shapes, and does nothing if none has a stroke', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const bare = { ...SHAPE_2, stroke: null };
    mount(propsOf([SHAPE, bare], { dispatch }));
    chooseMenu('Stroke width: Mixed', '8 px');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: SHAPE.id, style: { stroke: { ...SHAPE.stroke, width: 8 } } }],
    });
    cleanup();
    dispatch.mockClear();
    mount(propsOf([{ ...SHAPE, stroke: null }, bare], { dispatch }));
    chooseMenu('Stroke width: Mixed', '4 px');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('swaps kinds with only kind and sides patches, retaining size, label and connections', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE, SHAPE_2], { dispatch }));
    chooseMenu('Shape: Mixed', 'Triangle');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: SHAPE.id, style: { kind: 'polygon', sides: 3 } },
        { id: SHAPE_2.id, style: { kind: 'polygon', sides: 3 } },
      ],
    });
    expect(JSON.stringify(dispatch.mock.calls[0])).not.toMatch(
      /width|height|label|from|to|\"x\"|\"y\"/,
    );
  });

  it('preserves a polygon side count above three when Polygon is chosen', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const polygon = { ...SHAPE, kind: 'polygon', sides: 7 } as ShapeObject;
    mount(propsOf([polygon, SHAPE_2], { dispatch }));
    chooseMenu('Shape: Mixed', 'Polygon');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: polygon.id, style: { kind: 'polygon', sides: 7 } },
        { id: SHAPE_2.id, style: { kind: 'polygon', sides: 5 } },
      ],
    });
  });

  it('uses onTextStyle for a shape label font and size without dispatching', () => {
    const onTextStyle = vi.fn();
    const dispatch = vi.fn();
    mount(propsOf([SHAPE], { onTextStyle, dispatch, textStyle: TEXT_STYLE }));
    chooseMenu('Font: Lora', 'Liberation Sans');
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({
      kind: 'style',
      patch: { fontFamily: 'Liberation Sans' },
    });
    onTextStyle.mockClear();
    chooseMenu('Font size: 16', 'Large24');
    expect(onTextStyle).toHaveBeenCalledExactlyOnceWith({ kind: 'style', patch: { fontSize: 24 } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps shape controls off mixed groups and hides them from commenters', () => {
    // A mixed selection takes the several-objects row instead.
    expect(rowOf(mount(propsOf([SHAPE, CONNECTOR])))).toEqual([
      '|',
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      '|',
      expect.stringMatching(/^Colour: /),
      'Group',
      'More',
    ]);
    cleanup();
    expect(rowOf(mount(propsOf([SHAPE, TEXT])))).toEqual([
      '|',
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      '|',
      expect.stringMatching(/^Colour: /),
      'Group',
      'More',
    ]);
    cleanup();
    expect(rowOf(mount(propsOf([SHAPE], { canEdit: false })))).toEqual(['Comment']);
    expect(
      screen.getByRole('button', { name: 'Comment' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });
});
