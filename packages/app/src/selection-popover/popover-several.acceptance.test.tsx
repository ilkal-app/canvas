// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import type { ShellAction } from '../state/shell-action.js';

import { ARRANGE_LAST_USED_STORAGE_KEY, resetArrangeLastUsed } from './arrange-last-used.js';
import {
  CONNECTOR,
  LINE,
  mount,
  preparePopover,
  propsOf,
  rowOf,
  SHAPE,
  SHAPE_2,
  TEXT,
} from './popover-shape-connector-fixtures.js';
import { FRAME, FREEHAND, GROUP, IMAGE, PATH, STICKY } from './popover-viv-629-fixtures.js';

beforeEach(() => {
  preparePopover();
  localStorage.clear();
  resetArrangeLastUsed();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function disabled(name: string | RegExp): void {
  expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
}

describe('several-object selection', () => {
  it('shows the count and controls in order without Comment', () => {
    const toolbar = mount(propsOf([SHAPE, TEXT, IMAGE]));
    expect(toolbar.textContent).toContain('3 selected');
    expect(rowOf(toolbar)).toEqual([
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
    expect(toolbar.querySelectorAll('[data-popover-divider]')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '3 selected' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });

  it.each([
    ['Tidy up', 'tidyUp'],
    ['Group', 'group'],
  ] as const)('dispatches %s as one arrange action', (label, command) => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE, TEXT, IMAGE], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'arrange', command });
  });

  // Item 2, round 2: three menus, each one arrange action per choice, each button showing
  // what it last ran.
  it.each([
    ['Align horizontally', 'Align left', 'alignLeft', 'align-left'],
    ['Align horizontally', 'Align centre', 'alignCentre', 'align-centre'],
    ['Align horizontally', 'Align right', 'alignRight', 'align-right'],
    ['Align vertically', 'Align top', 'alignTop', 'align-top'],
    ['Align vertically', 'Align middle', 'alignMiddle', 'align-middle'],
    ['Align vertically', 'Align bottom', 'alignBottom', 'align-bottom'],
    ['Distribute', 'Distribute horizontally', 'distributeHorizontally', 'distribute-horizontally'],
    ['Distribute', 'Distribute vertically', 'distributeVertically', 'distribute-vertically'],
  ] as const)(
    '%s: %s is one arrange action, and the button shows it',
    (menuName, label, command, icon) => {
      const dispatch = vi.fn<(action: ShellAction) => void>();
      mount(propsOf([SHAPE, TEXT, IMAGE], { dispatch }));
      const button = screen.getByRole('button', { name: menuName });
      fireEvent.click(button);
      const menu = screen.getByRole('menu', { name: menuName });
      fireEvent.click(within(menu).getByRole('menuitem', { name: label }));
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'arrange', command });
      expect(screen.queryByRole('menu', { name: menuName })).toBeNull();
      expect(button.getAttribute('data-last-used')).toBe(command);
      expect(button.getAttribute('aria-description')).toBe(label);
      expect(button.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(icon);
      expect(localStorage.getItem(ARRANGE_LAST_USED_STORAGE_KEY)).toContain(command);
    },
  );

  it('lists each menu’s choices in order', () => {
    mount(propsOf([SHAPE, TEXT, IMAGE]));
    for (const [menuName, labels] of [
      ['Align horizontally', ['Align left', 'Align centre', 'Align right']],
      ['Align vertically', ['Align top', 'Align middle', 'Align bottom']],
      ['Distribute', ['Distribute horizontally', 'Distribute vertically']],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: menuName }));
      const menu = screen.getByRole('menu', { name: menuName });
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent),
      ).toEqual(labels);
      fireEvent.keyDown(menu, { key: 'Escape' });
    }
  });

  it('disables Distribute below three objects, not the align menus', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([SHAPE, TEXT], { dispatch }));
    expect(screen.getByRole('toolbar', { name: 'Selection' }).textContent).toContain('2 selected');
    disabled('Distribute');
    fireEvent.click(screen.getByRole('button', { name: 'Distribute' }));
    expect(screen.queryByRole('menu', { name: 'Distribute' })).toBeNull();
    for (const name of ['Align horizontally', 'Align vertically']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull();
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('disables arrange, Group and Colour for a locked selection', () => {
    const selection = [SHAPE, TEXT, IMAGE].map((object) => ({
      ...object,
      locked: true,
    })) as BoardObject[];
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf(selection, { dispatch }));
    for (const name of [
      'Align horizontally',
      'Align vertically',
      'Distribute',
      'Tidy up',
      'Group',
    ]) {
      disabled(name);
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(screen.queryByRole('menu')).toBeNull();
    disabled(/^Colour:/);
    fireEvent.click(screen.getByRole('button', { name: /^Colour:/ }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('colours each supported type in one action and skips text, image and group', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(
      propsOf([STICKY, SHAPE, PATH, FRAME, CONNECTOR, LINE, FREEHAND, TEXT, IMAGE, GROUP], {
        dispatch,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Colour:/ }));
    const palette = screen.getByRole('dialog');
    expect(within(palette).queryByRole('button', { name: 'None' })).toBeNull();
    fireEvent.click(within(palette).getByRole('button', { name: 'accent' }));
    const color = { token: 'accent' };
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: STICKY.id, style: { color } },
        { id: SHAPE.id, style: { fill: color } },
        { id: PATH.id, style: { fill: color } },
        { id: FRAME.id, style: { background: color } },
        { id: CONNECTOR.id, style: { stroke: { ...CONNECTOR.stroke, color } } },
        { id: LINE.id, style: { stroke: { ...LINE.stroke, color } } },
        { id: FREEHAND.id, style: { stroke: { ...FREEHAND.stroke, color } } },
      ],
    });
  });

  it('omits Colour when no object accepts it', () => {
    const toolbar = mount(propsOf([TEXT, IMAGE, GROUP]));
    expect(toolbar.textContent).toContain('3 selected');
    expect(screen.queryByRole('button', { name: /^Colour:/ })).toBeNull();
  });

  it('keeps homogeneous sticky and shape selections on their own rows', () => {
    const secondSticky = { ...STICKY, id: 'sticky-2' as typeof STICKY.id };
    const stickyToolbar = mount(propsOf([STICKY, secondSticky]));
    expect(stickyToolbar.textContent).not.toContain('2 selected');
    screen.getByRole('button', { name: /^Note colour:/ });
    cleanup();
    const shapeToolbar = mount(propsOf([SHAPE, SHAPE_2]));
    expect(shapeToolbar.textContent).not.toContain('2 selected');
    screen.getByRole('button', { name: /^Fill:/ });
  });

  it('shows no several-object controls to a commenter or viewer', () => {
    const toolbar = mount(propsOf([SHAPE, TEXT], { canEdit: false }));
    expect(toolbar.textContent).not.toContain('2 selected');
    expect(screen.queryByRole('button', { name: 'Align horizontally' })).toBeNull();
    cleanup();
    mount(propsOf([SHAPE, TEXT], { canEdit: false }), undefined, false);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
  });
});
