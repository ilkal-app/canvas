// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLinkClicks } from './use-link-clicks.js';

const LINK = 'https://example.com/';

/**
 * Mounts the link gesture on a plain element, without a real engine.
 *
 * @param props - Hit testing and opening collaborators.
 * @param props.linkAt - Returns the link at a viewport point.
 * @param props.open - Receives a link selected by a click.
 * @returns The pointer target.
 */
function LinkTarget(props: {
  readonly linkAt: (clientX: number, clientY: number) => string | undefined;
  readonly open: (link: string) => boolean;
}): ReactElement {
  const target = useRef<HTMLDivElement>(null);

  // jsdom's events are never trusted: the gate is opened here and pinned in use-link-clicks.test.tsx.
  useLinkClicks(target, props.linkAt, props.open, { isGenuine: () => true, isOver: () => true });
  return <div ref={target} data-testid="link-target" />;
}

/**
 * Sends a pointer press and release to the target.
 *
 * @param down - The press's pointer fields.
 * @param up - The release's pointer fields; the press's fields by default.
 */
function clickPointer(
  down: Record<string, number | boolean>,
  up: Record<string, number | boolean> = down,
): void {
  const target = screen.getByTestId('link-target');
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'mouse', ...down });
  fireEvent.pointerUp(target, { pointerId: 1, pointerType: 'mouse', ...up });
}

afterEach(() => {
  cleanup();
});

describe('modified canvas link clicks acceptance', () => {
  it.each([{ metaKey: true }, { ctrlKey: true }])(
    'opens the topmost hit link once on a primary modified click with $metaKey $ctrlKey',
    (modifier) => {
      const linkAt = vi.fn().mockReturnValue(LINK);
      const open = vi.fn().mockReturnValue(true);
      render(<LinkTarget linkAt={linkAt} open={open} />);
      clickPointer(
        { clientX: 100, clientY: 200, button: 0, buttons: 1, ...modifier },
        { clientX: 103, clientY: 202, button: 0, buttons: 0, ...modifier },
      );
      expect(linkAt).toHaveBeenCalledExactlyOnceWith(103, 202);
      expect(open).toHaveBeenCalledExactlyOnceWith(LINK);
    },
  );

  it('does nothing for an unmodified click, a drag or a secondary button', () => {
    const linkAt = vi.fn().mockReturnValue(LINK);
    const open = vi.fn().mockReturnValue(true);
    render(<LinkTarget linkAt={linkAt} open={open} />);
    clickPointer({ clientX: 10, clientY: 10, button: 0, buttons: 1 });
    clickPointer(
      { clientX: 10, clientY: 10, button: 0, buttons: 1, metaKey: true },
      { clientX: 15, clientY: 10, button: 0, buttons: 0, metaKey: true },
    );
    clickPointer({ clientX: 10, clientY: 10, button: 2, buttons: 2, metaKey: true });
    expect(linkAt).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('does nothing when the hit point has no link or another button remains pressed', () => {
    const linkAt = vi.fn().mockReturnValue(undefined);
    const open = vi.fn().mockReturnValue(true);
    render(<LinkTarget linkAt={linkAt} open={open} />);
    clickPointer(
      { clientX: 10, clientY: 10, button: 0, buttons: 1, ctrlKey: true },
      { clientX: 10, clientY: 10, button: 0, buttons: 0, ctrlKey: true },
    );
    expect(linkAt).toHaveBeenCalledExactlyOnceWith(10, 10);
    expect(open).not.toHaveBeenCalled();
    linkAt.mockReturnValue(LINK);
    clickPointer(
      { clientX: 10, clientY: 10, button: 0, buttons: 1, ctrlKey: true },
      { clientX: 10, clientY: 10, button: 0, buttons: 2, ctrlKey: true },
    );
    expect(open).not.toHaveBeenCalled();
  });
});
