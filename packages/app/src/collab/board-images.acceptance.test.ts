// CONTRACT: an image-wrapped board connection forwards viewport presence,
// including the null that clears it, to the underlying board connection unchanged.
import { describe, expect, it, vi } from 'vitest';

import type { PageImages } from '../assets/page-images.js';

import type { BoardConnection } from './board-connection.js';
import { withBoardImages } from './board-images.js';

describe('viewport forwarding acceptance', () => {
  it('forwards a viewport and its removal through the image wrapper', () => {
    const showViewport = vi.fn();
    const connection = { showViewport } as unknown as BoardConnection;
    const wrapped = withBoardImages(connection, { destroy: vi.fn() } as unknown as PageImages);
    const viewport = { x: -10, y: 5, w: 400, h: 200, zoom: 0.37 };
    wrapped.showViewport?.(viewport);
    wrapped.showViewport?.(null);
    expect(showViewport.mock.calls).toEqual([[viewport], [null]]);
  });
});
