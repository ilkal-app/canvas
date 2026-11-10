// @vitest-environment jsdom
// The anchored popover: placement, the popup stack, closing and focus. The placement
// maths is placement.test.ts; geometry in a real browser is the scenario's.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPopupStack, type PopupStack } from '../focus/popup-stack.js';

import { announceAnchorsMoved } from './anchor-moves.js';
import {
  AnchoredPopover,
  AnchoredPopoverAvoidContext,
  placeShortening,
  type AnchoredPopoverProps,
  type PopoverCloseReason,
} from './anchored-popover.js';

afterEach(cleanup);

/** The popover's measured size in these tests (jsdom lays nothing out). */
const SIZE = { width: 200, height: 40 };

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(SIZE.width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(SIZE.height);
  return () => {
    vi.restoreAllMocks();
  };
});

/**
 * A popover over a fixed rectangle with two buttons, on its own stack.
 *
 * @param props - What differs.
 * @returns The popover.
 */
function Popover(
  props: Partial<AnchoredPopoverProps> & { readonly stack: PopupStack },
): ReactElement {
  return (
    <AnchoredPopover
      anchor={{ x: 600, y: 400, width: 100, height: 100 }}
      isOpen
      label="Sticky properties"
      onClose={vi.fn()}
      {...props}
    >
      <button type="button">Colour</button>
      <button type="button">Size</button>
    </AnchoredPopover>
  );
}

describe('AnchoredPopover', () => {
  it('renders nothing while closed', () => {
    render(<Popover stack={createPopupStack()} isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens above its rectangle, centred, fixed to the window, and says which side', () => {
    render(<Popover stack={createPopupStack()} />);
    const popover = screen.getByRole('dialog', { name: 'Sticky properties' });
    expect(popover.style.left).toBe('550px');
    expect(popover.style.top).toBe('352px');
    expect(popover.dataset.side).toBe('top');
    expect(popover.dataset.shape).toBe('toolbar');
  });

  it('flips below when the window has no room above, and avoids reserved areas', () => {
    const { rerender } = render(
      <Popover stack={createPopupStack()} anchor={{ x: 600, y: 10, width: 100, height: 40 }} />,
    );
    expect(screen.getByRole('dialog').dataset.side).toBe('bottom');
    expect(screen.getByRole('dialog').style.top).toBe('58px');
    const stack = createPopupStack();
    rerender(
      <Popover
        stack={stack}
        anchor={{ x: 600, y: 400, width: 100, height: 100 }}
        reserved={[{ x: 400, y: 300, width: 500, height: 100 }]}
      />,
    );
    expect(screen.getByRole('dialog').dataset.side).toBe('bottom');
  });

  it('takes the role and side it is given', () => {
    render(<Popover stack={createPopupStack()} role="toolbar" side="right" />);
    const popover = screen.getByRole('toolbar', { name: 'Sticky properties' });
    expect(popover.dataset.side).toBe('right');
    expect(popover.style.left).toBe('708px');
  });

  it('anchors to an element', () => {
    function WithButton(): ReactElement {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} type="button">
            Open
          </button>
          <Popover stack={createPopupStack()} anchor={ref} side="bottom" gap={4} />
        </>
      );
    }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 100, width: 80, height: 28 }),
    );
    render(<WithButton />);
    const popover = screen.getByRole('dialog');
    expect(popover.style.left).toBe('40px');
    expect(popover.style.top).toBe('132px');
  });

  it('follows an anchoring element that moved without a render (item 3)', () => {
    function WithButton(): ReactElement {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} type="button">
            Open
          </button>
          <Popover stack={createPopupStack()} anchor={ref} side="bottom" gap={4} />
        </>
      );
    }
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(DOMRect.fromRect({ x: 100, y: 100, width: 80, height: 28 }));
    const { unmount } = render(<WithButton />);
    const popover = screen.getByRole('dialog');
    rect.mockReturnValue(DOMRect.fromRect({ x: 160, y: 300, width: 80, height: 28 }));
    announceAnchorsMoved();
    expect(popover.style.left).toBe('100px');
    expect(popover.style.top).toBe('332px');
    unmount();
    // Closed, it listens no more.
    expect(() => {
      announceAnchorsMoved();
    }).not.toThrow();
  });

  it('never covers what its context asks it to avoid, read again as its anchor moves', () => {
    let avoided = { x: 60, y: 140, width: 160, height: 300 };
    function WithButton(): ReactElement {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <AnchoredPopoverAvoidContext.Provider value={() => [avoided]}>
          <button ref={ref} type="button">
            Open
          </button>
          <Popover stack={createPopupStack()} anchor={ref} side="bottom" gap={4} />
        </AnchoredPopoverAvoidContext.Provider>
      );
    }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 100, width: 80, height: 28 }),
    );
    render(<WithButton />);
    const popover = screen.getByRole('dialog');
    // Below the button is the avoided box: it opens above instead.
    expect(popover.dataset.side).toBe('top');
    expect(popover.style.top).toBe('56px');
    // The box moved away, and the anchor with the camera: below again.
    avoided = { x: 600, y: 600, width: 10, height: 10 };
    announceAnchorsMoved();
    expect(popover.dataset.side).toBe('bottom');
    expect(popover.style.top).toBe('132px');
  });

  it('moves focus to its first control; Escape closes it and puts focus back', () => {
    const onClose = vi.fn<(reason: PopoverCloseReason) => void>();
    function Harness(): ReactElement {
      const [isOpen, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Canvas
          </button>
          <Popover
            stack={createPopupStack()}
            isOpen={isOpen}
            onClose={(reason) => {
              onClose(reason);
              setOpen(false);
            }}
          />
        </>
      );
    }
    render(<Harness />);
    const canvas = screen.getByRole('button', { name: 'Canvas' });
    canvas.focus();
    fireEvent.click(canvas);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Colour' }));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    act(() => {
      screen.getByRole('button', { name: 'Size' }).dispatchEvent(escape);
    });
    window.removeEventListener('keydown', outer);
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(canvas);
  });

  it('leaves focus alone when it does not take it', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    render(<Popover stack={createPopupStack()} shouldTakeFocus={false} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('closes on a press outside it, not on one inside it or on its anchor element', () => {
    const onClose = vi.fn<(reason: PopoverCloseReason) => void>();
    function WithAnchor(): ReactElement {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} type="button">
            Anchor
          </button>
          <span>Board</span>
          <Popover stack={createPopupStack()} anchor={ref} onClose={onClose} />
        </>
      );
    }
    render(<WithAnchor />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Colour' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Anchor' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText('Board'));
    expect(onClose).toHaveBeenCalledWith('outside');
  });

  it('closes when another popup opens on its stack; a child popup keeps it open', () => {
    const stack = createPopupStack();
    const first = vi.fn<(reason: PopoverCloseReason) => void>();
    render(<Popover stack={stack} onClose={first} label="First" />);
    expect(stack.size()).toBe(1);
    const parentClose = vi.fn();
    const parent = stack.claim(parentClose);
    expect(first).toHaveBeenCalledWith('replaced');
    cleanup();
    const child = vi.fn<(reason: PopoverCloseReason) => void>();
    render(<Popover stack={stack} parentClaim={parent} onClose={child} label="Child" />);
    expect(parentClose).not.toHaveBeenCalled();
    cleanup();
    // Unmounted, it released its claim.
    expect(stack.size()).toBe(1);
  });

  it('focuses what its initial focus names, else its first control', () => {
    render(<Popover stack={createPopupStack()} initialFocus="button:nth-of-type(2)" />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Size' }));
    cleanup();
    render(<Popover stack={createPopupStack()} initialFocus="[data-missing]" />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Colour' }));
  });

  it('a popover opened inside another claims as its child: the outer one stays open', () => {
    const stack = createPopupStack();
    const outerClose = vi.fn<(reason: PopoverCloseReason) => void>();
    function Nested(props: { readonly isInnerOpen: boolean }): ReactElement {
      return (
        <AnchoredPopover
          anchor={{ x: 600, y: 400, width: 100, height: 100 }}
          isOpen
          label="Outer"
          stack={stack}
          onClose={outerClose}
        >
          <button type="button">Outer control</button>
          <AnchoredPopover
            anchor={{ x: 600, y: 300, width: 100, height: 40 }}
            isOpen={props.isInnerOpen}
            label="Inner"
            stack={stack}
            onClose={vi.fn()}
          >
            <button type="button">Inner control</button>
          </AnchoredPopover>
        </AnchoredPopover>
      );
    }
    const { rerender } = render(<Nested isInnerOpen={false} />);
    rerender(<Nested isInnerOpen />);
    expect(screen.getByRole('dialog', { name: 'Inner' })).toBeTruthy();
    expect(outerClose).not.toHaveBeenCalled();
    expect(stack.size()).toBe(2);
  });
});

describe('placeShortening (round 2)', () => {
  const viewport = { x: 0, y: 0, width: 390, height: 844 };
  const anchor = { x: 300, y: 700, width: 40, height: 40 };
  // A 520 px touch menu over a phone's bottom sheet, the selection mid-screen above it.
  const selection = { x: 150, y: 300, width: 200, height: 160 };

  it('keeps the full height where it fits clear', () => {
    const placed = placeShortening({
      anchor,
      size: { width: 240, height: 200 },
      viewport,
      side: 'top',
      align: 'end',
      gap: 12,
      reserved: [selection],
    });
    expect(placed).toMatchObject({ side: 'top', isClear: true });
    expect(placed.maxHeight).toBeUndefined();
  });

  it('shortens a menu that fits nowhere clear, rather than cover the selection', () => {
    const placed = placeShortening({
      anchor,
      size: { width: 240, height: 520 },
      viewport,
      side: 'top',
      align: 'end',
      gap: 12,
      reserved: [selection],
    });
    expect(placed.isClear).toBe(true);
    expect(placed.maxHeight).toBeGreaterThanOrEqual(120);
    expect(placed.maxHeight).toBeLessThan(520);
    const box = { x: placed.x, y: placed.y, width: 240, height: placed.maxHeight ?? 0 };
    const isOverlapping =
      box.x < selection.x + selection.width &&
      selection.x < box.x + box.width &&
      box.y < selection.y + selection.height &&
      selection.y < box.y + box.height;
    expect(isOverlapping).toBe(false);
  });

  it('covers at full height only when no clear height of at least 120 px exists', () => {
    const placed = placeShortening({
      anchor,
      size: { width: 380, height: 520 },
      viewport,
      side: 'top',
      gap: 12,
      reserved: [{ x: 0, y: 0, width: 390, height: 844 }],
    });
    expect(placed.isClear).toBe(false);
    expect(placed.maxHeight).toBeUndefined();
  });
});
