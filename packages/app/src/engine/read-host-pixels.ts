import type { EngineHost } from '@canvas/engine';

import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import type { PixelBlock, PixelRect } from '../harness/canvas-harness.js';
import { flushHarnessFrames } from '../harness/harness-frames.js';
import { checkPixelRect } from '../harness/pixel-rect.js';

import type { HostView } from './host-view.js';
import { cropUnpremultiplied } from './pixel-capture.js';

/**
 * Reads live pixels after flushing queued document changes.
 *
 * @param host - Mounted host.
 * @param view - Its queued document view.
 * @param size - Last buffer size sent to the host, independent of the leased element size.
 * @param rect - Requested rectangle.
 * @returns Straight-alpha pixels from the answering frame.
 */
export async function readHostPixels(
  host: EngineHost,
  view: HostView | undefined,
  size: CanvasBackingSize,
  rect: PixelRect,
): Promise<PixelBlock> {
  checkPixelRect(rect, size);
  view?.flush();
  const pending = host.readPixels(rect);
  flushHarnessFrames();
  const { widthPx, heightPx, rgba } = await pending;
  const whole = { xPx: 0, yPx: 0, widthPx, heightPx };
  return { widthPx, heightPx, rgba: cropUnpremultiplied(rgba, widthPx, whole) };
}
