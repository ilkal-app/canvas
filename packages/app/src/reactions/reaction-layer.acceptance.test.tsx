// @vitest-environment jsdom
// CONTRACT: a reaction appears only on its page at the camera-projected board point.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { boardReactions } from './__fixtures__/board-reactions.js';
import { ReactionLayer } from './reaction-layer.js';
import { reactionsContext } from './reactions-context.js';

const CAMERA: Camera = {
  x: 100,
  y: 50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

afterEach(cleanup);

it('filters another page and projects the current page through the camera', async () => {
  const engine = {
    camera: () => CAMERA,
    pages: { current: () => 'page-1' },
  } as unknown as MountedEngine;
  const reactions = boardReactions({
    shown: [
      { id: 1, emoji: '👍', x: 150, y: 100, pageId: 'page-1', isOwn: false },
      { id: 2, emoji: '😂', x: 150, y: 100, pageId: 'page-2', isOwn: false },
    ],
  });
  render(
    <reactionsContext.Provider value={reactions}>
      <ReactionLayer engine={engine} />
    </reactionsContext.Provider>,
  );
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const shown = document.querySelectorAll<HTMLElement>('[data-reaction]');
  expect(shown).toHaveLength(1);
  expect([shown[0]?.dataset.reaction, shown[0]?.style.left, shown[0]?.style.top]).toEqual([
    '👍',
    '100px',
    '100px',
  ]);
});
