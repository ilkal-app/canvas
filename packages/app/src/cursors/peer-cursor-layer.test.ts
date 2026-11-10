// @vitest-environment jsdom
// The live cursors' layer in jsdom (item 10): cursors appear, follow the camera, ease
// toward their peer on frames and then stop asking for them, jump under reduced motion, change
// name and colour with presence, and go when their peer does.
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_MARK, PeerCursorLayer, type CursorFrames } from './peer-cursor-layer.js';
import type { PeerCursor } from './peer-cursors-model.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * Frames the test runs by hand.
 *
 * @returns The frames, what runs the next one at a time, and how many wait.
 */
function manualFrames() {
  const waiting = new Map<number, (timeMs: number) => void>();
  let next = 1;
  const frames: CursorFrames = {
    request: (callback) => {
      waiting.set(next, callback);
      return next++;
    },
    cancel: (handle) => {
      waiting.delete(handle);
    },
  };
  const run = (timeMs: number): void => {
    const due = [...waiting.values()];
    waiting.clear();
    for (const callback of due) callback(timeMs);
  };
  return { frames, run, pending: () => waiting.size };
}

/**
 * A peer's cursor.
 *
 * @param x - Horizontal position, world units.
 * @param y - Vertical position.
 * @param fields - The rest.
 * @returns The cursor.
 */
function cursor(x: number, y: number, fields: Partial<PeerCursor> = {}): PeerCursor {
  return {
    clientId: 7,
    principalId: 'mira',
    name: 'Mira',
    color: '#cc66ff',
    colourway: 'nerale',
    isAgent: false,
    point: { x, y },
    ...fields,
  };
}

/**
 * The drawn cursors' elements.
 *
 * @param container - The layer.
 * @returns Them, in order.
 */
function cursorsIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-peer-cursor]')];
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('PeerCursorLayer', () => {
  it('draws a peer at their point for the camera, with their name and colour', () => {
    const container = document.createElement('div');
    const { frames, pending } = manualFrames();
    const layer = new PeerCursorLayer(container, frames, () => false);
    layer.setCursors([cursor(100, 50)]);
    const [element] = cursorsIn(container);
    expect(element?.hidden).toBe(true);
    layer.setCamera({ ...CAMERA, x: 50, y: -10, zoom: 2 });
    expect(element?.hidden).toBe(false);
    expect(element?.style.transform).toBe('translate(100px, 120px)');
    expect(element?.dataset.principalId).toBe('mira');
    expect(element?.dataset.presenceColor).toBe('#cc66ff');
    expect(element?.dataset.colourway).toBe('nerale');
    expect(element?.dataset.agent).toBeUndefined();
    expect(element?.textContent).toBe('Mira');
    expect(element?.querySelector('svg')).toBeNull();
    expect(pending()).toBe(0);
  });

  it('marks an agent’s cursor with a ✦ before its name, and drops it when that changes', () => {
    const container = document.createElement('div');
    const { frames } = manualFrames();
    const layer = new PeerCursorLayer(container, frames, () => false);
    layer.setCamera(CAMERA);
    layer.setCursors([cursor(0, 0, { name: 'Layout', isAgent: true, colourway: 'hasiru' })]);
    const [element] = cursorsIn(container);
    expect(AGENT_MARK).toBe('✦');
    expect(element?.dataset.agent).toBe('');
    expect(element?.dataset.colourway).toBe('hasiru');
    expect(element?.textContent).toBe(`${AGENT_MARK}Layout`);
    layer.setCursors([cursor(0, 0, { name: 'Layout', colourway: 'hasiru' })]);
    expect(element?.dataset.agent).toBeUndefined();
    expect(element?.textContent).toBe('Layout');
  });

  it('eases toward a move on frames and stops asking once it lands', () => {
    const container = document.createElement('div');
    const { frames, run, pending } = manualFrames();
    const layer = new PeerCursorLayer(container, frames, () => false);
    layer.setCamera(CAMERA);
    layer.setCursors([cursor(0, 0)]);
    layer.setCursors([cursor(100, 0)]);
    const [element] = cursorsIn(container);
    expect(element?.style.transform).toBe('translate(0px, 0px)');
    expect(pending()).toBe(1);
    run(1000);
    const first = Number(/translate\(([\d.]+)px/.exec(element?.style.transform ?? '')?.[1]);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
    for (let frame = 1; frame < 40 && pending() > 0; frame += 1) run(1000 + frame * 16);
    expect(pending()).toBe(0);
    expect(element?.style.transform).toBe('translate(100px, 0px)');
  });

  it('jumps to a move under reduced motion', () => {
    const container = document.createElement('div');
    const { frames, pending } = manualFrames();
    const layer = new PeerCursorLayer(container, frames, () => true);
    layer.setCamera(CAMERA);
    layer.setCursors([cursor(0, 0)]);
    layer.setCursors([cursor(40, 30, { name: 'Mira K', color: '#3366cc', colourway: 'neeli' })]);
    const [element] = cursorsIn(container);
    expect(element?.style.transform).toBe('translate(40px, 30px)');
    expect(element?.textContent).toBe('Mira K');
    expect(element?.dataset.presenceColor).toBe('#3366cc');
    expect(element?.dataset.colourway).toBe('neeli');
    expect(pending()).toBe(0);
  });

  it('removes a peer who left, and everything when destroyed', () => {
    const container = document.createElement('div');
    const { frames, pending } = manualFrames();
    const layer = new PeerCursorLayer(container, frames, () => false);
    layer.setCamera(CAMERA);
    layer.setCursors([cursor(0, 0), cursor(5, 5, { clientId: 8, principalId: 'jonas' })]);
    expect(cursorsIn(container).map((element) => element.dataset.peerCursor)).toEqual(['7', '8']);
    layer.setCursors([cursor(0, 0)]);
    expect(cursorsIn(container).map((element) => element.dataset.peerCursor)).toEqual(['7']);
    layer.setCursors([cursor(50, 50)]);
    expect(pending()).toBe(1);
    layer.destroy();
    expect(cursorsIn(container)).toEqual([]);
    expect(pending()).toBe(0);
  });
});
