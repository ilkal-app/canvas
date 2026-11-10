// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorObject, LineObject } from '@canvas/schema';

import type { ShellAction } from '../state/shell-action.js';

import {
  CONNECTOR,
  CONNECTOR_2,
  LINE,
  mount,
  preparePopover,
  propsOf,
  rowOf,
  SHAPE,
} from './popover-shape-connector-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Chooses one entry from a named dropdown.
 *
 * @param trigger - The dropdown's accessible name.
 * @param choice - The radio item's accessible name.
 */
function chooseMenu(trigger: RegExp | string, choice: string): void {
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: choice }));
}

describe('connector and legacy line popover acceptance', () => {
  it('orders line controls, route toggles, ends, label and common actions', () => {
    expect(rowOf(mount(propsOf([CONNECTOR])))).toEqual([
      expect.stringMatching(/^Line colour: /),
      'Line width: 2 px',
      '|',
      'Straight',
      'Elbow',
      'Curved',
      'Ends: End',
      '|',
      'Label',
      // Item 2: a labelled connector's label text controls.
      'Font: Lora',
      'Font size: 16',
      expect.stringMatching(/^Text colour: /),
      'Comment',
      'More',
    ]);
  });

  it('allows a connector and a legacy line together, showing mixed values and disabling Curved and Label', () => {
    const toolbar = mount(propsOf([CONNECTOR, LINE]));
    expect(rowOf(toolbar)).toEqual([
      'Line colour: Mixed',
      'Line width: Mixed',
      '|',
      'Straight',
      'Elbow',
      'Curved',
      'Ends: Mixed',
      '|',
      'Label',
      // Two lines also get arrange and Group (item 13).
      '|',
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
      'Comment',
      'More',
    ]);
    expect(screen.getByRole('button', { name: 'Curved' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Label' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('reports the common route and disables Curved for a line alone', () => {
    mount(propsOf([LINE]));
    expect(screen.getByRole('button', { name: 'Straight' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Elbow' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Curved' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Label' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('shows no pressed route when the selection differs and offers all three Ends choices', () => {
    mount(propsOf([CONNECTOR, CONNECTOR_2]));
    for (const route of ['Straight', 'Elbow', 'Curved']) {
      expect(screen.getByRole('button', { name: route }).getAttribute('aria-pressed')).toBe(
        'false',
      );
    }
    fireEvent.click(screen.getByRole('button', { name: 'Ends: Mixed' }));
    expect(
      within(screen.getByRole('menu', { name: 'Ends' }))
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['None—', 'End→', 'Both↔']);
  });

  it('dispatches one colour action that preserves each stroke width and has no None palette choice', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CONNECTOR, LINE], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: /^Line colour:/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'None' })).toBeNull();
    const custom = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Hex' });
    fireEvent.change(custom, { target: { value: '#ff8040' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        {
          id: CONNECTOR.id,
          style: { stroke: { ...CONNECTOR.stroke, color: [1, 128 / 255, 64 / 255, 1] } },
        },
        { id: LINE.id, style: { stroke: { ...LINE.stroke, color: [1, 128 / 255, 64 / 255, 1] } } },
      ],
    });
  });

  it('dispatches one width action, keeping each existing line colour', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CONNECTOR, LINE], { dispatch }));
    chooseMenu('Line width: Mixed', '8 px');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { stroke: { ...CONNECTOR.stroke, width: 8 } } },
        { id: LINE.id, style: { stroke: { ...LINE.stroke, width: 8 } } },
      ],
    });
  });

  it('offers widths 1, 2, 4 and 8 px', () => {
    mount(propsOf([CONNECTOR]));
    fireEvent.click(screen.getByRole('button', { name: 'Line width: 2 px' }));
    expect(
      within(screen.getByRole('menu', { name: 'Line width' }))
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['1 px', '2 px', '4 px', '8 px']);
  });

  it('changes only route for every selected connector, retaining both bindings', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CONNECTOR, CONNECTOR_2], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Curved' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { route: 'curved' } },
        { id: CONNECTOR_2.id, style: { route: 'curved' } },
      ],
    });
  });

  it('changes straight and elbow across mixed connector and line selections in one action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CONNECTOR, LINE], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Elbow' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { route: 'elbow' } },
        { id: LINE.id, style: { route: 'elbow' } },
      ],
    });
    dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Straight' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { route: 'straight' } },
        { id: LINE.id, style: { route: 'straight' } },
      ],
    });
  });

  it('keeps disabled Curved inert when any legacy line is selected', () => {
    const dispatch = vi.fn();
    mount(propsOf([CONNECTOR, LINE], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Curved' }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sets None, End and Both caps, preserving a shared non-none cap or using arrow', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CONNECTOR, CONNECTOR_2], { dispatch }));
    chooseMenu('Ends: Mixed', 'None—');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { startCap: 'none', endCap: 'none' } },
        { id: CONNECTOR_2.id, style: { startCap: 'none', endCap: 'none' } },
      ],
    });
    dispatch.mockClear();
    chooseMenu('Ends: Mixed', 'Both↔');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { startCap: 'arrow', endCap: 'arrow' } },
        { id: CONNECTOR_2.id, style: { startCap: 'arrow', endCap: 'arrow' } },
      ],
    });
    cleanup();
    dispatch.mockClear();
    const matching = { ...CONNECTOR_2, startCap: 'none', endCap: 'triangle' } as ConnectorObject;
    mount(propsOf([CONNECTOR, matching], { dispatch }));
    chooseMenu('Ends: End', 'Both↔');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { startCap: 'triangle', endCap: 'triangle' } },
        { id: matching.id, style: { startCap: 'triangle', endCap: 'triangle' } },
      ],
    });
  });

  it('maps asymmetric caps to Mixed and End to a retained shared cap', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const asymmetric = { ...LINE, startCap: 'circle', endCap: 'diamond' } as LineObject;
    mount(propsOf([CONNECTOR, asymmetric], { dispatch }));
    expect(screen.getByRole('button', { name: 'Ends: Mixed' })).not.toBeNull();
    chooseMenu('Ends: Mixed', 'End→');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: CONNECTOR.id, style: { startCap: 'none', endCap: 'arrow' } },
        { id: asymmetric.id, style: { startCap: 'none', endCap: 'arrow' } },
      ],
    });
  });

  it('calls onEditLabel once only for exactly one connector and leaves lines inert', () => {
    const onEditLabel = vi.fn();
    const dispatch = vi.fn();
    mount(propsOf([CONNECTOR], { onEditLabel, dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Label' }));
    expect(onEditLabel).toHaveBeenCalledExactlyOnceWith(CONNECTOR.id);
    expect(dispatch).not.toHaveBeenCalled();
    cleanup();
    onEditLabel.mockClear();
    mount(propsOf([LINE], { onEditLabel, dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Label' }));
    expect(onEditLabel).not.toHaveBeenCalled();
  });

  it('keeps connector controls off other mixed types and commenters', () => {
    // A mixed selection takes the several-objects row instead.
    expect(rowOf(mount(propsOf([CONNECTOR, SHAPE])))).toEqual([
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
    expect(rowOf(mount(propsOf([CONNECTOR], { canEdit: false })))).toEqual(['Comment']);
    expect(
      screen.getByRole('button', { name: 'Comment' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });
});
