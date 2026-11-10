import type { JobHandler } from './job-handlers.js';

/**
 * Handles `echo` jobs: returns the request's text and bytes, transferring the bytes back. It
 * exists to prove the pool, the protocol and the transfer path end to end before the real
 * jobs (layout, mesh, decode) have handlers. Runs in a job worker or on the main
 * thread.
 *
 * @param request - The text and bytes to return.
 * @returns The same text and bytes, with the bytes in the transfer list.
 */
export const echoJob: JobHandler<'echo'> = (request) => ({
  response: { message: request.message, bytes: request.bytes },
  transfer: [request.bytes],
});
