// @vitest-environment jsdom
// Red-lane acceptance. The assumed app seam is
// noticeOf(message, protectedUndo, presenceSnapshot), with writerClientIds on presence.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PresenceSnapshot, PresenceState } from '@canvas/collab';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import { noticeOf, type ProtectedUndo, type ShownNotice } from '../notices/notice-outline.js';
import { NoticeOutlines } from '../notices/notice-outlines.js';
import { memoryShape } from '../panels/__fixtures__/memory-board.js';

const SHAPE = 'shape-1' as ObjectId;
const UNNAMED = 'Nothing to undo here: this has changed since.';
const PROTECTED: ProtectedUndo = {
  isUndo: true,
  protection: { objectIds: [SHAPE], writers: [77] },
};
const BOARD_OBJECT: BoardObject = memoryShape(SHAPE, 'a0');
const BOARD = {
  get: (id: ObjectId): BoardObject | undefined => (id === SHAPE ? BOARD_OBJECT : undefined),
};
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

afterEach(cleanup);

function peer(name: string, color: string, writerClientIds: number[]): PresenceState {
  return {
    principal: { id: `user-${name.toLowerCase()}`, kind: 'user', name, color },
    updatedAt: 1,
    writerClientIds,
  } as PresenceState & { writerClientIds: readonly number[] };
}

function shown(presence: PresenceSnapshot): ShownNotice {
  // This signature is the assumed seam for the implementation author; the cast keeps the
  // acceptance file compiling before that third argument exists on main.
  const withPresence = noticeOf as (
    message: string,
    protectedUndo: ProtectedUndo,
    remote: PresenceSnapshot,
  ) => ShownNotice;
  return withPresence(UNNAMED, PROTECTED, presence);
}

describe('protected undo names a uniquely vouched-for present writer', () => {
  it('names Mira and outlines the protected object in her presence colour', () => {
    const notice = shown(new Map([[101, peer('Mira', '#cc5533', [77])]]));
    expect(notice.message).toBe("Can't undo — Mira changed this since");
    expect(notice.outline).toMatchObject({ objectIds: [SHAPE], color: '#cc5533' });
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { container } = render(
      <NoticeOutlines outline={notice.outline} board={BOARD} camera={camera} />,
    );
    expect(
      container.querySelector<HTMLElement>('[data-outline="shape-1"]')?.style.borderColor,
    ).toBe('rgb(204, 85, 51)');
  });

  it('keeps the unnamed words when two present people claim the writer id', () => {
    const notice = shown(
      new Map([
        [101, peer('Mira', '#cc5533', [77])],
        [102, peer('Bea', '#117799', [77])],
      ]),
    );
    expect(notice.message).toBe(UNNAMED);
    expect(notice.outline).toEqual({ objectIds: [SHAPE] });
  });

  it('keeps the unnamed words when no present person claims the writer id', () => {
    const notice = shown(new Map([[101, peer('Mira', '#cc5533', [88])]]));
    expect(notice.message).toBe(UNNAMED);
    expect(notice.outline).toEqual({ objectIds: [SHAPE] });
  });
});
