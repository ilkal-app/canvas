// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPopupStack } from '../focus/popup-stack.js';

import { AnchoredPopover } from './anchored-popover.js';
import { ControlStatesSheet } from './control-states-sheet.js';
import { FloatingSheet } from './floating-sheet.js';
import sheetCss from './floating-sheet.module.css?raw';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
});

/**
 * Opens a controlled popover from an element anchor for interaction checks.
 *
 * @returns The opener, board target and controlled popover.
 */
function Openable(): ReactElement {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open properties
      </button>
      <button type="button">Board</button>
      <AnchoredPopover
        anchor={anchorRef}
        isOpen={isOpen}
        label="Properties"
        side="bottom"
        onClose={() => {
          setOpen(false);
        }}
        stack={createPopupStack()}
      >
        <button type="button" disabled>
          Unavailable
        </button>
        <button type="button">Colour</button>
        <button type="button">Size</button>
      </AnchoredPopover>
    </>
  );
}

describe('floating UI acceptance', () => {
  it('moves focus to the first enabled control after placement and restores it on Escape', () => {
    render(<Openable />);
    const opener = screen.getByRole('button', { name: 'Open properties' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Properties' });
    expect(dialog.style.visibility).not.toBe('hidden');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Colour' }));
    const propagated = vi.fn();
    window.addEventListener('keydown', propagated);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      within(dialog).getByRole('button', { name: 'Size' }).dispatchEvent(escape);
    });
    window.removeEventListener('keydown', propagated);
    expect(escape.defaultPrevented).toBe(true);
    expect(propagated).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Properties' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('ignores presses within the sheet and anchor, then closes for a board press', () => {
    render(<Openable />);
    fireEvent.click(screen.getByRole('button', { name: 'Open properties' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Colour' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open properties' }));
    expect(screen.getByRole('dialog', { name: 'Properties' })).toBeTruthy();
    const board = screen.getByRole('button', { name: 'Board' });
    board.focus();
    fireEvent.pointerDown(board);
    expect(screen.queryByRole('dialog', { name: 'Properties' })).toBeNull();
    expect(document.activeElement).toBe(board);
  });

  it('reports replacement when another popup claims its stack', () => {
    const stack = createPopupStack();
    const onClose = vi.fn();
    render(
      <AnchoredPopover
        anchor={{ x: 100, y: 100, width: 40, height: 30 }}
        isOpen
        label="Replaceable"
        onClose={onClose}
        stack={stack}
      >
        <button type="button">Action</button>
      </AnchoredPopover>,
    );
    expect(stack.size()).toBe(1);
    act(() => {
      stack.claim(vi.fn());
    });
    expect(onClose).toHaveBeenCalledExactlyOnceWith('replaced');
  });

  it('repositions on window resize using the element anchor rectangle', () => {
    const stack = createPopupStack();
    const anchorRef = { current: document.createElement('button') };
    let anchorY = 100;
    vi.spyOn(anchorRef.current, 'getBoundingClientRect').mockImplementation(() =>
      DOMRect.fromRect({ x: 100, y: anchorY, width: 40, height: 30 }),
    );
    render(
      <AnchoredPopover
        anchor={anchorRef}
        isOpen
        label="Moving"
        side="bottom"
        stack={stack}
        onClose={vi.fn()}
      >
        <button type="button">Action</button>
      </AnchoredPopover>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Moving' });
    expect(dialog.style.top).toBe('138px');
    anchorY = 170;
    fireEvent(window, new Event('resize'));
    expect(dialog.style.top).toBe('208px');
  });

  it('exposes all sheet shapes with their promised dimensions and layout', () => {
    render(
      <>
        <FloatingSheet role="group" label="Toolbar">
          One
        </FloatingSheet>
        <FloatingSheet shape="bar" role="group" label="Bar">
          Two
        </FloatingSheet>
        <FloatingSheet shape="stack" role="group" label="Stack">
          Three
        </FloatingSheet>
      </>,
    );
    expect(screen.getByRole('group', { name: 'Toolbar' }).dataset.shape).toBe('toolbar');
    expect(screen.getByRole('group', { name: 'Bar' }).dataset.shape).toBe('bar');
    expect(screen.getByRole('group', { name: 'Stack' }).dataset.shape).toBe('stack');
    expect(sheetCss).toMatch(
      /\.sheet\[data-shape='toolbar'\]\s*\{[^}]*height:\s*40px;[^}]*border-radius:\s*8px;/,
    );
    expect(sheetCss).toMatch(
      /\.sheet\[data-shape='bar'\]\s*\{[^}]*height:\s*44px;[^}]*border-radius:\s*var\(--radius-sheet\);/,
    );
    expect(sheetCss).toMatch(/\.sheet\[data-shape='stack'\]\s*\{[^}]*flex-direction:\s*column;/);
  });

  it('adds floating rows only in floating chrome and retains classic rows', () => {
    const { rerender } = render(<ControlStatesSheet chrome="classic" />);
    expect(screen.getByRole('region', { name: 'Primary button' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Floating sheet' })).toBeNull();
    rerender(<ControlStatesSheet chrome="floating" />);
    expect(screen.getByRole('region', { name: 'Primary button' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Floating sheet' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Anchored popover' })).toBeTruthy();
    rerender(<ControlStatesSheet chrome="classic" />);
    expect(screen.queryByRole('region', { name: 'Floating sheet' })).toBeNull();
  });
});
