// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPopupStack } from '../focus/popup-stack.js';

import { AnchoredPopover } from './anchored-popover.js';
import { placePopover } from './placement.js';

const CONTAINING_BLOCK = { x: 300, y: 400 };
const ANCHOR = { x: 500, y: 500, width: 20, height: 20 };
const SHEET = { width: 100, height: 40 };

/**
 * A transformed parent with a button anchor and an open in-tree popover.
 *
 * @returns The panel fixture.
 */
function TransformedPanel(): ReactElement {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div data-testid="panel" style={{ transform: 'translateX(-50%)' }}>
      <button ref={anchor} type="button">
        Colour
      </button>
      <AnchoredPopover
        anchor={anchor}
        isOpen
        label="Colour"
        side="bottom"
        gap={4}
        stack={createPopupStack()}
        onClose={vi.fn()}
      >
        <button type="button">Red</button>
      </AnchoredPopover>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AnchoredPopover inside a transformed containing block', () => {
  it('renders at placePopover viewport coordinates despite the parent offset', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(SHEET.width);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(SHEET.height);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this instanceof HTMLButtonElement) {
        return DOMRect.fromRect(ANCHOR);
      }
      if (this.getAttribute('data-testid') === 'panel') {
        return DOMRect.fromRect({ ...CONTAINING_BLOCK, width: 600, height: 200 });
      }
      const left = Number(this.style.left.replace('px', ''));
      const top = Number(this.style.top.replace('px', ''));
      return DOMRect.fromRect({
        x: CONTAINING_BLOCK.x + left,
        y: CONTAINING_BLOCK.y + top,
        ...SHEET,
      });
    });

    render(<TransformedPanel />);
    const sheet = screen.getByRole('dialog', { name: 'Colour' });
    const expected = placePopover({
      anchor: ANCHOR,
      size: SHEET,
      viewport: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      side: 'bottom',
      gap: 4,
    });
    const rendered = sheet.getBoundingClientRect();
    expect(rendered.x).toBeCloseTo(expected.x, 1);
    expect(rendered.y).toBeCloseTo(expected.y, 1);
  });
});
