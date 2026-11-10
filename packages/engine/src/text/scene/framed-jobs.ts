import type { JobKind, JobRequest } from '../../workers/job-kinds.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import type { WorkerPool } from '../../workers/worker-pool.js';

/**
 * The text pass's pool, asking for a frame with every job it takes: a job run on the rendering
 * thread waits for a frame to drain the pool, so the glyph and vector geometry sources ask for one
 * when they submit.
 *
 * @param jobs - The pool.
 * @param requestFrame - Asks for a frame.
 * @returns The pool, asking for a frame on each submit.
 */
export function framedJobs(
  jobs: Pick<WorkerPool, 'submit'>,
  requestFrame: () => void,
): Pick<WorkerPool, 'submit'> {
  return {
    submit<K extends JobKind>(
      kind: K,
      request: JobRequest<K>,
      options: SubmitOptions,
    ): JobTicket<K> {
      const ticket = jobs.submit(kind, request, options);
      requestFrame();
      return ticket;
    },
  };
}
