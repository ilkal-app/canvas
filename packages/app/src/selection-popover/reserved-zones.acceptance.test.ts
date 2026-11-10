// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { measureReservedZones } from './reserved-zones.js';

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Add an element with a measured page rectangle.
 *
 * @param attributes - Its selectors.
 * @param box - Its page bounds.
 * @returns The element.
 */
function placedElement(attributes: Record<string, string>, box: DOMRectInit): HTMLElement {
  const element = document.createElement('div');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.getBoundingClientRect = () => DOMRect.fromRect(box);
  document.body.append(element);
  return element;
}

describe('reserved chrome measurement acceptance', () => {
  it('measures all five selector forms in canvas pixels and drops zero-size boxes', () => {
    const root = document.createElement('section');
    document.body.append(root);
    const boxes = [
      [{ 'data-popover-avoid': '' }, { x: 130, y: 220, width: 40, height: 20 }],
      [{ 'data-zoom-control': '' }, { x: 150, y: 240, width: 50, height: 30 }],
      [
        { role: 'toolbar', 'aria-label': 'Tools' },
        { x: 170, y: 260, width: 60, height: 40 },
      ],
      [{ 'data-top-bar': '' }, { x: 190, y: 280, width: 70, height: 50 }],
      [{ 'data-bottom-chrome': '' }, { x: 210, y: 300, width: 80, height: 60 }],
    ] as const;
    for (const [attributes, box] of boxes) root.append(placedElement(attributes, box));
    root.append(
      placedElement({ 'data-popover-avoid': '' }, { x: 100, y: 200, width: 0, height: 40 }),
    );
    root.append(
      placedElement({ 'data-zoom-control': '' }, { x: 100, y: 200, width: 40, height: 0 }),
    );
    root.append(
      placedElement(
        { role: 'toolbar', 'aria-label': 'Text' },
        { x: 100, y: 200, width: 40, height: 20 },
      ),
    );
    expect(
      measureReservedZones(DOMRect.fromRect({ x: 100, y: 200, width: 800, height: 600 }), root),
    ).toEqual([
      { x: 30, y: 20, width: 40, height: 20 },
      { x: 50, y: 40, width: 50, height: 30 },
      { x: 70, y: 60, width: 60, height: 40 },
      { x: 90, y: 80, width: 70, height: 50 },
      { x: 110, y: 100, width: 80, height: 60 },
    ]);
  });
});
