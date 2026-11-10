// @vitest-environment jsdom
// ⌘/Ctrl-click's gate: only the person's own primary press on
// the canvas element itself, released still over it, opens a link; a script's synthetic events,
// a second pointer, a press on a control over the canvas or a release over one open nothing.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLinkClicks, type LinkClickGate } from './use-link-clicks.js';

afterEach(cleanup);

/**
 * A canvas with a control over it, the hook on the canvas.
 *
 * @param props - The opener and the gate.
 * @param props.open - Opens a link.
 * @param props.gate - The gate, the default if absent.
 * @returns The elements.
 */
function Canvas(props: {
  readonly open: (link: string) => boolean;
  readonly gate?: LinkClickGate;
}): ReactElement {
  const target = useRef<HTMLCanvasElement>(null);
  useLinkClicks(target, () => 'https://example.com/', props.open, props.gate);
  return (
    <main>
      <canvas ref={target} data-testid="canvas" />
      <button type="button">Control</button>
    </main>
  );
}

/**
 * A ⌘-press and release on an element.
 *
 * @param element - Where.
 * @param fields - More event fields.
 */
function modClick(element: Element, fields: Record<string, unknown> = {}): void {
  fireEvent.pointerDown(element, { pointerId: 1, button: 0, metaKey: true, ...fields });
  fireEvent.pointerUp(element, { pointerId: 1, buttons: 0, metaKey: true, ...fields });
}

describe('useLinkClicks gate', () => {
  it('opens nothing for synthetic (untrusted) events under the default gate', () => {
    const open = vi.fn(() => true);
    render(<Canvas open={open} />);
    modClick(screen.getByTestId('canvas'));
    expect(open).not.toHaveBeenCalled();
  });

  it('opens for genuine input on the canvas, released over it', () => {
    const open = vi.fn(() => true);
    render(<Canvas open={open} gate={{ isGenuine: () => true, isOver: () => true }} />);
    modClick(screen.getByTestId('canvas'));
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/');
  });

  it('opens nothing for a second (non-primary) pointer', () => {
    const open = vi.fn(() => true);
    const isGenuine = (event: PointerEvent): boolean => event.pointerId === 1;
    render(<Canvas open={open} gate={{ isGenuine, isOver: () => true }} />);
    modClick(screen.getByTestId('canvas'), { pointerId: 2 });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens nothing for a press on a control over the canvas', () => {
    const open = vi.fn(() => true);
    render(<Canvas open={open} gate={{ isGenuine: () => true, isOver: () => true }} />);
    modClick(screen.getByRole('button', { name: 'Control' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('opens nothing when the release is no longer over the canvas', () => {
    const open = vi.fn(() => true);
    render(<Canvas open={open} gate={{ isGenuine: () => true, isOver: () => false }} />);
    modClick(screen.getByTestId('canvas'));
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['main', 'canvas'] as const)(
    'opens nothing for a press another layer cancels, listening on the %s',
    (where) => {
      // An armed reaction cancels the press it drops on: the drop and the link must not both happen, whichever listener runs first. A
      // capturing listener on an ancestor runs before the hook's; one added later on the canvas,
      // after it.
      const open = vi.fn(() => true);
      render(<Canvas open={open} gate={{ isGenuine: () => true, isOver: () => true }} />);
      const canvas = screen.getByTestId('canvas');
      const layer = where === 'main' ? screen.getByRole('main') : canvas;
      layer.addEventListener(
        'pointerdown',
        (event) => {
          event.preventDefault();
        },
        true,
      );
      modClick(canvas);
      expect(open).not.toHaveBeenCalled();
    },
  );
});
