// @vitest-environment jsdom
// The floating dock panels' choices and creation styles.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InkableColor } from '@canvas/schema';

import { createFloatingShortcutRegistry } from '../../keymap/floating-keymap.js';

import './tool-panel-contribution.js';
import { toolPanel as connector } from './connector-panel.js';
import { colourOfValue, colourValueOf, panelPaletteOf } from './panel-colours.js';
import { toolPanel as shapes } from './shapes-panel.js';
import { STICKY_PANEL_HINT, toolPanel as sticky } from './sticky-panel.js';

const registry = createFloatingShortcutRegistry('mac');

function show(panel: typeof sticky, choices: unknown) {
  const onChange = vi.fn();
  render(
    <panel.contents choices={choices} onChange={onChange} registry={registry} dispatch={vi.fn()} />,
  );
  return onChange;
}

afterEach(cleanup);

describe('the Sticky panel', () => {
  it('orders six named radio colours, two size chips and the shortcut hint', () => {
    const choices = { color: 'Yellow', aspect: 'square' };
    const onChange = show(sticky, choices);
    const group = screen.getByRole('radiogroup', { name: 'Sticky colour' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'Yellow',
      'Pink',
      'Green',
      'Blue',
      'Purple',
      'Orange',
    ]);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(screen.getByRole('button', { name: 'Square' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Wide' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(STICKY_PANEL_HINT)).toBeTruthy();
    expect(
      [...document.querySelectorAll('[data-dock-item]')].map(
        (item) => item.getAttribute('aria-label') ?? item.textContent,
      ),
    ).toEqual(['Yellow', 'Pink', 'Green', 'Blue', 'Purple', 'Orange', 'Square', 'Wide']);
    fireEvent.click(within(group).getByRole('radio', { name: 'Pink' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'Pink', aspect: 'square' });
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'Yellow', aspect: 'wide' });
    expect(sticky.toolStyle?.({ color: 'Pink', aspect: 'wide' })).toMatchObject({
      tool: 'sticky',
      style: { aspect: 'wide', color: [1, 0.74, 0.8, 1] },
    });
  });
});

describe('the Shapes panel', () => {
  it('orders five kinds without an arrow and applies a palette fill', () => {
    const choices = { kind: 'rectangle', fill: null, stroke: 'ink' };
    const onChange = show(shapes, choices);
    const buttons = within(screen.getByRole('group', { name: 'Shape' })).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Rectangle',
      'Ellipse',
      'Triangle',
      'Polygon',
      'Star',
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(
      [...document.querySelectorAll('[data-dock-item]')].map((item) =>
        item.getAttribute('aria-label'),
      ),
    ).toEqual(['Rectangle', 'Ellipse', 'Triangle', 'Polygon', 'Star', 'Fill: None', 'Stroke: Ink']);
    fireEvent.click(screen.getByRole('button', { name: 'Star' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, kind: 'star' });
    fireEvent.click(screen.getByRole('button', { name: 'Fill: None' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Fill colours' })).queryByRole('button', {
        name: 'Ink',
      }),
    ).toBeNull();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Fill colours' })).getByRole('button', {
        name: 'Pink',
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, fill: [1, 189 / 255, 0.8, 1] });
    fireEvent.click(screen.getByRole('button', { name: 'Stroke: Ink' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Stroke colours' })).getByRole('button', {
        name: 'None',
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, stroke: null });
    expect(shapes.toolStyle?.({ ...choices, kind: 'triangle' })).toMatchObject({
      tool: 'shape',
      style: { kind: 'polygon', sides: 3, fill: null, stroke: { color: 'ink' } },
    });
    expect(shapes.toolStyle?.({ ...choices, kind: 'star' })).toMatchObject({
      style: { kind: 'star', sides: 5 },
    });
  });
});

describe('the Connector panel', () => {
  it('orders routes and dropdowns, disables cap for a plain line and maps styles', () => {
    const choices = { route: 'elbow', ends: 'end', cap: 'arrow', width: 2, color: 'ink' };
    const onChange = show(connector, choices);
    const routes = within(screen.getByRole('group', { name: 'Route' })).getAllByRole('button');
    expect(routes.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Straight',
      'Elbow',
      'Curved',
    ]);
    expect(routes.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(
      [...document.querySelectorAll('[data-dock-item]')].map((item) =>
        item.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Straight',
      'Elbow',
      'Curved',
      'Ends: →',
      'Cap: Arrow',
      'Width: 2 px',
      'Colour: Ink',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Curved' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, route: 'curved' });
    fireEvent.click(screen.getByRole('button', { name: /^Ends:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No ends (a line)' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, ends: 'none' });
    fireEvent.click(screen.getByRole('button', { name: /^Width:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '4 px' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, width: 4 });
    fireEvent.click(screen.getByRole('button', { name: /^Cap:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, cap: 'diamond' });
    fireEvent.click(screen.getByRole('button', { name: 'Colour: Ink' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Colour colours' })).getByRole('button', {
        name: 'Pink',
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ ...choices, color: [1, 189 / 255, 0.8, 1] });
    expect(connector.toolStyle?.({ ...choices, ends: 'none' })).toMatchObject({
      tool: 'connector',
      style: { route: 'elbow', startCap: 'none', endCap: 'none' },
    });
    cleanup();
    show(connector, { ...choices, ends: 'none' });
    expect(screen.getByRole('button', { name: /^Cap:/ }).hasAttribute('disabled')).toBe(true);
  });
});

it('round-trips ink, none, tokens and fixed colours through the shared colour helpers', () => {
  const colors: (InkableColor | null)[] = [
    'ink',
    null,
    { token: 'brand' },
    [0x12 / 255, 0x34 / 255, 0x56 / 255, 1],
  ];
  for (const color of colors) {
    expect(colourOfValue(colourValueOf(color))).toEqual(color);
  }
  expect(colourValueOf([0x12 / 255, 0x34 / 255, 0x56 / 255, 1])).toBe('#123456');
  expect(colourOfValue('invalid')).toBeUndefined();
  expect(
    panelPaletteOf({ canBeInk: true, canBeNone: true })[0]?.choices.map(({ label }) => label),
  ).toEqual(['Ink', 'None']);
});
