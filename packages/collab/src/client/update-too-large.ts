/**
 * The WebSocket close code a relay sends for a frame above its limit (1009, "message too big";
 * the relay's `frame-too-large`, 8 MiB once authenticated).
 */
export const FRAME_TOO_LARGE_CLOSE_CODE = 1009;

/**
 * The client's `rejectionReason` when the relay closed it for a frame above its limit:
 * the client splits every update into chunks of at most 1 MiB, so only a single Yjs struct
 * larger than the relay's limit (8 MiB of text in one piece, which is never cut) can cause it.
 * Sending it again would be refused again, forever, so the client stops (`outdated`): the change
 * is too large to sync, and stays on the device.
 */
export const UPDATE_TOO_LARGE_REASON = 'update-too-large';
