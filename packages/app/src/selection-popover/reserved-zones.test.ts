// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  measureReservedZones,
  measureWindowReservedZones,
  POPOVER_AVOID_ATTRIBUTE,
} from './reserved-zones.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * An element with a box on the page.
 *
 * @param attributes - Its attributes.
 * @param box - Its box.
 * @returns The element, in the document.
 */
function element(attributes: Record<string, string>, box: DOMRectInit): HTMLElement {
  const node = document.createElement('div');
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.getBoundingClientRect = () => DOMRect.fromRect(box);
  document.body.append(node);
  return node;
}

describe('measureReservedZones', () => {
  it('measures the marked chrome and today’s zoom, dock, bars, in the canvas’s pixels', () => {
    element({ [POPOVER_AVOID_ATTRIBUTE]: '' }, { x: 1300, y: 700, width: 120, height: 90 });
    element({ 'data-zoom-control': '' }, { x: 20, y: 840, width: 150, height: 40 });
    element({ role: 'toolbar', 'aria-label': 'Tools' }, { x: 480, y: 830, width: 480, height: 50 });
    element({ 'data-top-bar': 'board' }, { x: 16, y: 16, width: 280, height: 44 });
    element({ 'data-bottom-chrome': '' }, { x: 0, y: 860, width: 400, height: 40 });
    element({ role: 'toolbar', 'aria-label': 'Text' }, { x: 0, y: 0, width: 100, height: 40 });
    const zones = measureReservedZones(DOMRect.fromRect({ x: 0, y: 40, width: 1440, height: 860 }));
    expect(zones).toEqual([
      { x: 1300, y: 660, width: 120, height: 90 },
      { x: 20, y: 800, width: 150, height: 40 },
      { x: 480, y: 790, width: 480, height: 50 },
      { x: 16, y: -24, width: 280, height: 44 },
      { x: 0, y: 820, width: 400, height: 40 },
    ]);
  });

  it('leaves out chrome that is not shown (no box)', () => {
    element({ 'data-zoom-control': '' }, { x: 0, y: 0, width: 0, height: 0 });
    expect(measureReservedZones(DOMRect.fromRect({ x: 0, y: 0, width: 10, height: 10 }))).toEqual(
      [],
    );
  });
});

describe('measureWindowReservedZones (round 2)', () => {
  it('leaves out the chrome a popup’s button sits in, in window pixels', () => {
    const sheet = element({ 'data-bottom-chrome': '' }, { x: 16, y: 660, width: 358, height: 110 });
    const button = document.createElement('button');
    sheet.append(button);
    element({ [POPOVER_AVOID_ATTRIBUTE]: '' }, { x: 8, y: 778, width: 374, height: 58 });
    expect(measureWindowReservedZones(button)).toEqual([{ x: 8, y: 778, width: 374, height: 58 }]);
    expect(measureWindowReservedZones()).toHaveLength(2);
  });
});
