// @vitest-environment jsdom
// An armed reaction and ⌘/Ctrl-click on the same canvas: a press that
// drops the armed reaction opens no link; with nothing armed, the same press opens it.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, type ReactElement, type RefObject } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { MountedEngine } from '../engine/mounted-engine.js';
import { boardReactions } from '../reactions/__fixtures__/board-reactions.js';
import { ReactionLayer } from '../reactions/reaction-layer.js';
import { reactionsContext, type BoardReactions } from '../reactions/reactions-context.js';

import { useLinkClicks } from './use-link-clicks.js';

afterEach(cleanup);

const ENGINE = {
  camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
} as unknown as MountedEngine;

/**
 * The canvas with the reaction layer and the link listener, in either order.
 *
 * @param props - The opener and the order.
 * @param props.open - Opens a link.
 * @param props.isLinkFirst - Whether the link listener is mounted before the reaction layer.
 * @returns The tree.
 */
function Board(props: {
  readonly open: (link: string) => boolean;
  readonly isLinkFirst: boolean;
}): ReactElement {
  const target = useRef<HTMLCanvasElement>(null);
  const links = <Links target={target} open={props.open} />;
  return (
    <div>
      <canvas ref={target} />
      {props.isLinkFirst ? links : null}
      <ReactionLayer engine={ENGINE} />
      {props.isLinkFirst ? null : links}
    </div>
  );
}

/**
 * The link listener on the canvas, with a gate that takes jsdom's events.
 *
 * @param props - The canvas and the opener.
 * @param props.target - The canvas.
 * @param props.open - Opens a link.
 * @returns Nothing visible.
 */
function Links(props: {
  readonly target: RefObject<HTMLCanvasElement | null>;
  readonly open: (link: string) => boolean;
}): ReactElement {
  useLinkClicks(props.target, () => 'https://example.com/', props.open, {
    isGenuine: () => true,
    isOver: () => true,
  });
  return <span hidden />;
}

/**
 * ⌘-clicks the canvas with both layers mounted.
 *
 * @param reactions - The board's reactions.
 * @param isLinkFirst - Whether the link listener is mounted before the reaction layer.
 * @returns The opener's mock.
 * @throws {Error} When the tree has no canvas.
 */
function modClick(
  reactions: BoardReactions,
  isLinkFirst: boolean,
): Mock<(link: string) => boolean> {
  const open = vi.fn<(link: string) => boolean>(() => true);
  const { container } = render(
    <reactionsContext.Provider value={reactions}>
      <Board open={open} isLinkFirst={isLinkFirst} />
    </reactionsContext.Provider>,
  );
  const canvas = container.querySelector('canvas');
  if (canvas === null) throw new Error('No canvas.');
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, metaKey: true });
  fireEvent.pointerUp(canvas, { pointerId: 1, buttons: 0, metaKey: true });
  return open;
}

describe('an armed reaction and a ⌘-click', () => {
  it.each([true, false])('drops the reaction and opens no link (link first: %s)', (isFirst) => {
    const reactions = boardReactions({ armed: '👍' });
    const open = modClick(reactions, isFirst);
    expect(reactions.drop).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the link when nothing is armed', () => {
    const reactions = boardReactions();
    const open = modClick(reactions, true);
    expect(reactions.drop).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/');
  });
});
