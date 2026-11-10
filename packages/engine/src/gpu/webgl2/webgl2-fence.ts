/** How often a fence is polled, ms: about a quarter of a 60 Hz frame. */
const FENCE_POLL_INTERVAL_MS = 1;

/** How many polls before giving up: some seconds, with the browser's timer clamping. */
const MAX_FENCE_POLLS = 2_000;

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Waits until the GPU has finished every command issued so far on a WebGL2 context: a
 * fence after them, flushed, then polled, since WebGL2 cannot block. The answer is quantised to
 * the poll interval (1–4 ms, as browsers clamp timers).
 *
 * @param gl - The context.
 * @returns Settles once the fence signals, after deleting it; rejects when no fence can be made
 *   or it never signals (a lost context).
 */
export async function waitForFence(gl: WebGL2RenderingContext): Promise<void> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (sync === null) throw new Error('WebGL2 could not create a fence.');
  gl.flush();
  try {
    for (let poll = 0; poll < MAX_FENCE_POLLS; poll += 1) {
      if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) return;
      await delay(FENCE_POLL_INTERVAL_MS);
    }
    throw new Error('The WebGL2 fence never signalled.');
  } finally {
    gl.deleteSync(sync);
  }
}
