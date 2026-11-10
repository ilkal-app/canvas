/**
 * Identifies one job for its whole life: while queued, while running in a worker and in the
 * reply that settles it. Ids are positive integers that increase in enqueue order, so they
 * also give the FIFO order within a priority. Part of the job protocol's contract; the
 * queues assign them.
 */
export type JobId = number;
