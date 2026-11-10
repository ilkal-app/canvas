// @vitest-environment jsdom
// Item 2: a connector's label takes the popover's font, size and text colour, through the
// text style the sticky and text rows use; a connector with no label shows none of them.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { TextStyleChange } from '../engine/text-style-types.js';

import {
  CONNECTOR,
  CONNECTOR_2,
  mount,
  preparePopover,
  propsOf,
} from './popover-shape-connector-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('restyles labelled connectors’ font, size and text colour, one change each', () => {
  const onTextStyle = vi.fn<(change: TextStyleChange) => void>();
  mount(propsOf([CONNECTOR, CONNECTOR_2], { onTextStyle }));
  fireEvent.click(screen.getByRole('button', { name: 'Font: Lora' }));
  fireEvent.click(
    within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Liberation Sans' }),
  );
  expect(onTextStyle).toHaveBeenLastCalledWith({
    kind: 'style',
    patch: { fontFamily: 'Liberation Sans' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Font size: 16' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /^Large/ }));
  expect(onTextStyle).toHaveBeenLastCalledWith({ kind: 'style', patch: { fontSize: 24 } });
  fireEvent.click(screen.getByRole('button', { name: /^Text colour:/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Blue' }));
  expect(onTextStyle).toHaveBeenCalledTimes(3);
  const colour = onTextStyle.mock.calls[2]?.[0];
  expect(colour?.kind).toBe('style');
  const patch = colour?.kind === 'style' ? colour.patch : undefined;
  expect(patch?.color).toBeDefined();
  expect(patch?.color).not.toEqual([0.1, 0.2, 0.3, 1]);
});

it('shows no label text controls when a selected connector has no label', () => {
  mount(propsOf([CONNECTOR, { ...CONNECTOR_2, label: null }]));
  expect(screen.queryByRole('button', { name: /^Font:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Text colour:/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Label' })).toBeDefined();
});
