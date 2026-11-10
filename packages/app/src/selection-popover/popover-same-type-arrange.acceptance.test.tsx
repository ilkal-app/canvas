// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import type { ShellAction } from '../state/shell-action.js';

import {
  CONNECTOR,
  CONNECTOR_2,
  mount,
  preparePopover,
  propsOf,
  SHAPE,
  SHAPE_2,
  TEXT,
} from './popover-shape-connector-fixtures.js';
import { STICKY } from './popover-viv-629-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STICKY_2 = { ...STICKY, id: 'sticky-2' as typeof STICKY.id, x: 420 };
const STICKY_3 = { ...STICKY, id: 'sticky-3' as typeof STICKY.id, x: 560 };
const TEXT_2 = { ...TEXT, id: 'text-2' as typeof TEXT.id, x: 420 };
const ARRANGE = ['Align horizontally', 'Align vertically', 'Distribute', 'Tidy up', 'Group'];

describe('same-type arrange controls', () => {
  it.each([
    ['sticky', [STICKY, STICKY_2], /^Note colour:/],
    ['shape', [SHAPE, SHAPE_2], /^Fill:/],
    ['connector', [CONNECTOR, CONNECTOR_2], /^Line colour:/],
    ['text', [TEXT, TEXT_2], /^Font:/],
  ] as const)('keeps the %s row and adds arrange and Group', (type, objects, typeControl) => {
    expect(type).toBeTruthy();
    mount(propsOf(objects));
    screen.getByRole('button', { name: typeControl });
    for (const name of ARRANGE) screen.getByRole('button', { name });
    expect(screen.getByRole('button', { name: 'Distribute' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('dispatches each arrange command once for three stickies', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([STICKY, STICKY_2, STICKY_3], { dispatch }));
    for (const [menuName, name, command] of [
      ['Align horizontally', 'Align left', 'alignLeft'],
      ['Align vertically', 'Align middle', 'alignMiddle'],
      ['Distribute', 'Distribute horizontally', 'distributeHorizontally'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: menuName }));
      fireEvent.click(screen.getByRole('menuitem', { name }));
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'arrange', command });
    }
    for (const [name, command] of [
      ['Tidy up', 'tidyUp'],
      ['Group', 'group'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'arrange', command });
    }
    expect(dispatch).toHaveBeenCalledTimes(5);
  });

  it('keeps arrange and Group off a single-object row', () => {
    mount(propsOf([SHAPE]));
    for (const name of ARRANGE) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('disables arrange and Group for locked objects of one type', () => {
    const objects = [SHAPE, SHAPE_2].map((shape) => ({ ...shape, locked: true })) as BoardObject[];
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf(objects, { dispatch }));
    for (const name of ARRANGE) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});
