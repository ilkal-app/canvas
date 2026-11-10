/** The part of the browser's `scheduler` this module uses, where it exists (Chrome 129+). */
interface YieldingScheduler {
  readonly yield?: () => Promise<void>;
}

/**
 * Lets the browser run whatever waits (input, a frame) before the caller continues:
 * `scheduler.yield()` where the browser has it, which resumes ahead of other queued tasks;
 * otherwise a later macrotask through a `MessageChannel`, or a zero-delay timeout where there is
 * none. Never resolves within the current microtask checkpoint.
 *
 * @returns Resolves once the browser has had its turn.
 */
export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { readonly scheduler?: YieldingScheduler }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}
