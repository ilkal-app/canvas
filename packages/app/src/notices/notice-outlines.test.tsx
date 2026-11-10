// @vitest-environment jsdom
// Item 5: the objects an undo notice is about, outlined over the canvas,
// following the camera, while the notice shows.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { memoryShape } from '../panels/__fixtures__/memory-board.js';

import { NOTICE_OUTLINE_GAP_PX, NoticeOutlines } from './notice-outlines.js';

afterEach(cleanup);

const SHAPE = {
  ...memoryShape('shape-1', 'a0'),
  x: 100,
  y: 50,
  width: 40,
  height: 20,
} as BoardObject;
const BOARD = {
  get: (id: ObjectId): BoardObject | undefined => (id === SHAPE.id ? SHAPE : undefined),
};
const CAMERA = { x: 0, y: 0, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const OUTLINE = { objectIds: [SHAPE.id, 'gone' as ObjectId] };

describe('NoticeOutlines', () => {
  it('outlines each object on the page, outside its bounds, hidden from AT', () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { container } = render(
      <NoticeOutlines outline={OUTLINE} board={BOARD} camera={camera} />,
    );
    const layer = container.querySelector('[data-notice-outlines]');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    const boxes = container.querySelectorAll<HTMLElement>('[data-outline]');
    // The object no longer on the page is not outlined.
    expect(boxes).toHaveLength(1);
    const [box] = boxes;
    expect(box?.dataset.outline).toBe('shape-1');
    expect(box?.style.left).toBe(`${String(200 - NOTICE_OUTLINE_GAP_PX)}px`);
    expect(box?.style.top).toBe(`${String(100 - NOTICE_OUTLINE_GAP_PX)}px`);
    expect(box?.style.width).toBe(`${String(80 + 2 * NOTICE_OUTLINE_GAP_PX)}px`);
    expect(box?.style.height).toBe(`${String(40 + 2 * NOTICE_OUTLINE_GAP_PX)}px`);
  });

  it('draws a named writer`s outline in their presence colour, the neutral one in the sheet`s', () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { container, rerender } = render(
      <NoticeOutlines outline={{ ...OUTLINE, color: '#cc5533' }} board={BOARD} camera={camera} />,
    );
    // The DOM serialises the colour as rgb().
    expect(container.querySelector<HTMLElement>('[data-outline]')?.style.borderColor).toBe(
      'rgb(204, 85, 51)',
    );
    rerender(<NoticeOutlines outline={OUTLINE} board={BOARD} camera={camera} />);
    expect(container.querySelector<HTMLElement>('[data-outline]')?.style.borderColor).toBe('');
  });

  it('follows the camera, and shows nothing without an outline, a board or a camera', () => {
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { container, rerender } = render(
      <NoticeOutlines outline={OUTLINE} board={BOARD} camera={camera} />,
    );
    act(() => {
      camera.write({ ...CAMERA, x: 50 });
    });
    const box = container.querySelector<HTMLElement>('[data-outline]');
    expect(box?.style.left).toBe(`${String(100 - NOTICE_OUTLINE_GAP_PX)}px`);
    rerender(<NoticeOutlines outline={undefined} board={BOARD} camera={camera} />);
    expect(container.querySelector('[data-notice-outlines]')).toBeNull();
    rerender(<NoticeOutlines outline={OUTLINE} board={undefined} camera={camera} />);
    expect(container.querySelector('[data-notice-outlines]')).toBeNull();
    rerender(<NoticeOutlines outline={OUTLINE} board={BOARD} camera={undefined} />);
    expect(container.querySelector('[data-notice-outlines]')).toBeNull();
    rerender(
      <NoticeOutlines
        outline={{ ...OUTLINE, objectIds: ['gone' as ObjectId] }}
        board={BOARD}
        camera={camera}
      />,
    );
    expect(container.querySelector('[data-notice-outlines]')).toBeNull();
  });
});
