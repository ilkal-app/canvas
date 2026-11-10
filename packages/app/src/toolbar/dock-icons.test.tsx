// @vitest-environment jsdom
// The dock's icon sizes (Figma as scaled up on 2026-10-06; the owner's calls of
// 2026-10-07): the icons in the dock's tool buttons are 24 px (the mode switcher went), the
// flyouts' 20 px, all with a 1.5 px stroke; so, since UI-18 made 20 px every icon's size,
// are the zoom control's and the layers drawer's.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BOARD_MODES } from '@canvas/schema';

import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { renderDock, writer } from './__fixtures__/render-dock.js';
import { ZoomControl } from './zoom-control.js';
import { createZoomSource } from './zoom-source.js';

afterEach(cleanup);

/**
 * Asserts each icon is drawn at a size with the 1.5 px stroke, whatever that size.
 *
 * @param icons - The icons' `svg` elements.
 * @param size - Their size in CSS px.
 */
function expectIcons(icons: readonly SVGElement[], size: string): void {
  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) {
    expect(icon.getAttribute('width')).toBe(size);
    expect(icon.getAttribute('height')).toBe(size);
    const path = icon.querySelector('path');
    expect(path?.getAttribute('stroke-width')).toBe('1.5');
    // The stroke stays 1.5 CSS px however far the 16-unit drawing is scaled.
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  }
}

/**
 * The `svg` icons inside an element.
 *
 * @param element - The element.
 * @returns Its icons.
 */
function iconsIn(element: HTMLElement): SVGElement[] {
  return [...element.querySelectorAll('svg')];
}

/**
 * The icons in the dock's tool buttons (every `DockButton`, the comment button among them): the
 * dock's items that are toggles, `aria-pressed`.
 *
 * @param dock - The dock.
 * @returns Their icons.
 */
function toolIconsIn(dock: HTMLElement): SVGElement[] {
  return [...dock.querySelectorAll<SVGElement>('[data-dock-item][aria-pressed] svg')];
}

describe('the dock’s icons', () => {
  it.each(BOARD_MODES)('are 24 px with a 1.5 px stroke in the %s mode’s tool buttons', (mode) => {
    const { dock } = renderDock({ mode, comments: writer() });
    const tools = toolIconsIn(dock);
    expectIcons(tools, '24');
    // The comment button is a tool button too.
    expect(tools.some((icon) => icon.dataset.icon === 'comment')).toBe(true);
    // Nothing else in the dock draws an icon.
    const rest = iconsIn(dock).filter((icon) => !tools.includes(icon));
    expect(rest).toEqual([]);
  });

  it('are 20 px in both flyouts', () => {
    const { dock } = renderDock({ comments: writer() });
    fireEvent.keyDown(within(dock).getByRole('button', { name: /^Shape:/ }), { key: 'ArrowUp' });
    expectIcons(iconsIn(screen.getByRole('menu', { name: 'Shapes' })), '20');
    fireEvent.keyDown(within(dock).getByRole('button', { name: /^Line\b/ }), { key: 'ArrowUp' });
    expectIcons(iconsIn(screen.getByRole('menu', { name: 'Lines' })), '20');
  });

  it('are 20 px in the zoom control and its layers toggle too, as every icon now is', () => {
    const { container } = render(
      <ZoomControl
        zoom={createZoomSource()}
        registry={createDefaultShortcutRegistry('mac')}
        dispatch={() => undefined}
        isLayersDrawerOpen={false}
      />,
    );
    expectIcons(iconsIn(container), '20');
  });
});
