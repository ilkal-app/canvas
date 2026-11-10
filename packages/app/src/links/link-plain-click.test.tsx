// @vitest-environment jsdom
// A plain click or tap on a link: told to the chip's callback past the same gate as
// ⌘-click, and never opening anything itself.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLinkClicks, type LinkClickGate } from './use-link-clicks.js';

afterEach(cleanup);

const GENUINE: LinkClickGate = { isGenuine: () => true, isOver: () => true };

/**
 * A canvas with the hook, a plain-click callback given.
 *
 * @param props - The opener, the callback and the gate.
 * @param props.open - Opens a link.
 * @param props.onPlainClick - Told of a plain click.
 * @param props.gate - The gate.
 * @returns The canvas.
 */
function Canvas(props: {
  readonly open: (link: string) => boolean;
  readonly onPlainClick: (release: PointerEvent) => void;
  readonly gate: LinkClickGate;
}): ReactElement {
  const target = useRef<HTMLCanvasElement>(null);
  useLinkClicks(target, () => 'https://example.com/', props.open, props.gate, props.onPlainClick);
  return <canvas ref={target} data-testid="canvas" />;
}

/**
 * A press and release on an element.
 *
 * @param element - Where.
 * @param fields - More event fields, on both.
 * @param up - More fields on the release.
 */
function click(element: Element, fields: Record<string, unknown> = {}, up = {}): void {
  fireEvent.pointerDown(element, { pointerId: 1, button: 0, ...fields });
  fireEvent.pointerUp(element, { pointerId: 1, buttons: 0, ...fields, ...up });
}

describe('useLinkClicks plain clicks', () => {
  it('tells a plain click to the callback and opens nothing', () => {
    const open = vi.fn(() => true);
    const onPlainClick = vi.fn();
    render(<Canvas open={open} onPlainClick={onPlainClick} gate={GENUINE} />);
    click(screen.getByTestId('canvas'), { clientX: 10, clientY: 20 });
    expect(open).not.toHaveBeenCalled();
    expect(onPlainClick).toHaveBeenCalledOnce();
    expect(onPlainClick.mock.calls[0]?.[0]).toMatchObject({ clientX: 10, clientY: 20 });
  });

  it('opens a ⌘-click as before, without telling the callback', () => {
    const open = vi.fn(() => true);
    const onPlainClick = vi.fn();
    render(<Canvas open={open} onPlainClick={onPlainClick} gate={GENUINE} />);
    click(screen.getByTestId('canvas'), { metaKey: true });
    expect(open).toHaveBeenCalledOnce();
    expect(onPlainClick).not.toHaveBeenCalled();
  });

  it.each([
    ['a drag', {}, { clientX: 40 }],
    ['a synthetic press', {}, {}],
  ])('tells nothing for %s', (name, fields, up) => {
    const onPlainClick = vi.fn();
    const gate = name === 'a synthetic press' ? { ...GENUINE, isGenuine: () => false } : GENUINE;
    render(<Canvas open={() => true} onPlainClick={onPlainClick} gate={gate} />);
    click(screen.getByTestId('canvas'), fields, up);
    expect(onPlainClick).not.toHaveBeenCalled();
  });

  it('tells nothing for a press another layer took', () => {
    const onPlainClick = vi.fn();
    render(<Canvas open={() => true} onPlainClick={onPlainClick} gate={GENUINE} />);
    const canvas = screen.getByTestId('canvas');
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    click(canvas);
    expect(onPlainClick).not.toHaveBeenCalled();
  });
});
