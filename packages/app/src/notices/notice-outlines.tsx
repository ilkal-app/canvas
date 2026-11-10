import { useSyncExternalStore, type ReactElement } from 'react';

import { worldToScreen } from '@canvas/engine';

import type { CameraSource } from '../editing/camera-source.js';
import { sheetBoundsOf, type TraceSheetBoard } from '../trace-sheets/trace-sheet-bounds.js';

import type { NoticeOutline } from './notice-outline.js';
import styles from './notice-outlines.module.css';

/** How far the outline sits outside an object's bounds, CSS px. */
export const NOTICE_OUTLINE_GAP_PX = 4;

/** Props of {@link NoticeOutlines}. */
export interface NoticeOutlinesProps {
  /** What the notice shown outlines; nothing if absent. */
  readonly outline: NoticeOutline | undefined;
  /** The page shown (the engine's board view): an object on another page is not outlined. */
  readonly board: TraceSheetBoard | undefined;
  /** The camera on screen, which the outlines follow; nothing is outlined without it. */
  readonly camera: CameraSource | undefined;
}

/** What subscribing to no camera returns. */
function noUnsubscribe(): void {
  // Nothing was subscribed.
}

/**
 * The objects the shell's notice is about, each outlined over the canvas for as long as the
 * notice shows (what another person changed since, which an undo would not
 * touch): in the presence colour of the person the notice names (`NoticeOutline.color`),
 * else in a neutral colour, when who changed it cannot be told for sure (`noticeOf`). Each
 * follows the camera (a pan, a zoom); an
 * object no longer on the board, or with no bounds of its own, is not outlined. Hidden from
 * assistive technology and pointer input: the notice says it. Main thread.
 *
 * @param props - The outline, the board and the camera.
 * @returns The outlines, or nothing.
 */
export function NoticeOutlines(props: NoticeOutlinesProps): ReactElement | null {
  const { outline, board, camera: source } = props;
  const camera = useSyncExternalStore(source?.subscribe ?? (() => noUnsubscribe), () =>
    source?.read(),
  );
  if (outline === undefined || board === undefined || camera === undefined) return null;
  const boxes = outline.objectIds.flatMap((id) => {
    const bounds = sheetBoundsOf(board, [id]);
    if (bounds === undefined) return [];
    const corner = worldToScreen(camera, { x: bounds.minX, y: bounds.minY });
    const end = worldToScreen(camera, { x: bounds.maxX, y: bounds.maxY });
    return [{ id, x: corner.x, y: corner.y, width: end.x - corner.x, height: end.y - corner.y }];
  });
  if (boxes.length === 0) return null;
  return (
    <div className={styles.layer} aria-hidden="true" data-notice-outlines="">
      {boxes.map((box) => (
        <div
          key={box.id}
          className={styles.outline}
          data-outline={box.id}
          style={{
            left: box.x - NOTICE_OUTLINE_GAP_PX,
            top: box.y - NOTICE_OUTLINE_GAP_PX,
            width: box.width + 2 * NOTICE_OUTLINE_GAP_PX,
            height: box.height + 2 * NOTICE_OUTLINE_GAP_PX,
            ...(outline.color === undefined ? {} : { borderColor: outline.color }),
          }}
        />
      ))}
    </div>
  );
}
