// @vitest-environment jsdom
// useDockPlacement (item 12) measuring the dock, its canvas and the zoom control, and
// measuring again when a size changes. jsdom lays nothing out, so the measures are stubbed on the
// elements; the placement rule itself: dock-placement.test.ts.
import { act, cleanup, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDockPlacement, ZOOM_CONTROL_ATTRIBUTE } from './dock-placement.js';

/** The `ResizeObserver` callbacks the hook registered, and what each observes. */
const observers: { callback: () => void; targets: Element[]; isConnected: boolean }[] = [];

class FakeResizeObserver {
  readonly #entry: (typeof observers)[number];

  constructor(callback: () => void) {
    this.#entry = { callback, targets: [], isConnected: true };
    observers.push(this.#entry);
  }

  observe(target: Element): void {
    this.#entry.targets.push(target);
  }

  disconnect(): void {
    this.#entry.isConnected = false;
  }
}

/** The measures the stubs read, CSS px. */
const size = { canvas: 1280, dock: 600, zoomLeft: 16, zoomWidth: 171 };

/**
 * Stubs a layout measure on every element.
 *
 * @param name - The property.
 * @param read - What it reads for an element.
 */
function stubMeasure(name: string, read: (element: HTMLElement) => unknown): void {
  vi.spyOn(HTMLElement.prototype, name as 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return read(this) as number;
  });
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  stubMeasure('offsetParent', (element) => element.parentElement);
  stubMeasure('clientWidth', () => size.canvas);
  stubMeasure('offsetWidth', (element) =>
    element.hasAttribute(ZOOM_CONTROL_ATTRIBUTE) ? size.zoomWidth : size.dock,
  );
  stubMeasure('offsetLeft', () => size.zoomLeft);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.assign(size, { canvas: 1280, dock: 600, zoomLeft: 16, zoomWidth: 171 });
});

/**
 * A canvas holding the zoom control and a dock that shows its placement.
 *
 * @param props - Whether the zoom control is there.
 * @param props.hasZoom - Whether it is.
 * @returns The canvas.
 */
function Canvas(props: { readonly hasZoom: boolean }): ReactElement {
  const dockRef = useRef<HTMLDivElement>(null);
  const placement = useDockPlacement(dockRef);
  return (
    <div data-testid="canvas">
      {props.hasZoom ? <div {...{ [ZOOM_CONTROL_ATTRIBUTE]: '' }} /> : null}
      <div
        ref={dockRef}
        data-testid="dock"
        data-placement={placement.kind}
        data-left={placement.kind === 'beside' ? placement.leftPx : undefined}
      />
    </div>
  );
}

describe('useDockPlacement', () => {
  it('measures on mount and centres a dock that fits', () => {
    const view = render(<Canvas hasZoom />);
    expect(view.getByTestId('dock').dataset.placement).toBe('centre');
    expect(observers).toHaveLength(1);
    expect(observers[0]?.targets.map((target) => (target as HTMLElement).dataset.testid)).toEqual([
      'dock',
      'canvas',
    ]);
  });

  it('measures again when a size changes, keeping the same placement object meanwhile', () => {
    const view = render(<Canvas hasZoom />);
    const dock = view.getByTestId('dock');
    size.canvas = 900;
    act(() => {
      observers[0]?.callback();
    });
    expect(dock.dataset.placement).toBe('beside');
    expect(dock.dataset.left).toBe('195');
    // The same measures again: the same placement.
    act(() => {
      observers[0]?.callback();
    });
    expect(dock.dataset.left).toBe('195');
    size.zoomWidth = 181;
    act(() => {
      observers[0]?.callback();
    });
    expect(dock.dataset.left).toBe('205');
    size.canvas = 768;
    size.dock = 690;
    act(() => {
      observers[0]?.callback();
    });
    expect(dock.dataset.placement).toBe('above');
    act(() => {
      observers[0]?.callback();
    });
    expect(dock.dataset.placement).toBe('above');
  });

  it('keeps clear of nothing without a zoom control, and stops measuring once unmounted', () => {
    size.canvas = 700;
    const view = render(<Canvas hasZoom={false} />);
    expect(view.getByTestId('dock').dataset.placement).toBe('centre');
    view.unmount();
    expect(observers[0]?.isConnected).toBe(false);
  });

  it('stays centred where ResizeObserver is missing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const view = render(<Canvas hasZoom />);
    expect(view.getByTestId('dock').dataset.placement).toBe('centre');
    expect(observers).toHaveLength(0);
  });
});
