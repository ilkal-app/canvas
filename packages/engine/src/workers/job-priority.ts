/**
 * How urgently a job's result is needed, from the viewport's point of view: `visible` work
 * feeds an object on screen now, `near` work an object just outside the padded viewport, `prefetch`
 * work an object the camera is moving towards. Queues always run `visible` before `near` before
 * `prefetch`.
 */
export type JobPriority = 'visible' | 'near' | 'prefetch';

/** Every {@link JobPriority}, most urgent first; a priority's index here is its rank. */
export const JOB_PRIORITIES: readonly JobPriority[] = ['visible', 'near', 'prefetch'];

/**
 * Gives a priority's rank, where a lower rank runs first.
 *
 * @param priority - The priority to rank.
 * @returns 0 for `visible`, 1 for `near`, 2 for `prefetch`.
 */
export function priorityRank(priority: JobPriority): number {
  return JOB_PRIORITIES.indexOf(priority);
}
