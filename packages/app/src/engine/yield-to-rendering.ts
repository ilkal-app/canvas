import { yieldToBrowser } from '@canvas/collab';

/** The part of the Prioritized Task Scheduling API a yield to rendering uses. */
interface BackgroundScheduler {
  readonly postTask?: (
    callback: () => void,
    options: { readonly priority: 'background' },
  ) => Promise<void>;
}

/**
 * Goes on in a background-priority task: what a stepped run awaits between two parts.
 * The browser renders a due frame before a background task, where it may run a task posted at
 * the ordinary priority (`scheduler.yield`, a message) first and keep doing so, one frame holding
 * several parts, until it forces a paint near 100 ms. No timer or animation frame is used, so a
 * hidden tab and a scenario's frozen clock go on as before. `yieldToBrowser` where the scheduler
 * is missing.
 *
 * @returns Settles in a task of its own, after any frame that was due.
 */
export function yieldToRendering(): Promise<void> {
  const scheduler = (globalThis as { readonly scheduler?: BackgroundScheduler }).scheduler;
  if (typeof scheduler?.postTask !== 'function') return yieldToBrowser();
  return scheduler.postTask(() => undefined, { priority: 'background' });
}
