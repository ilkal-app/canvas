import { bench, describe } from 'vitest';

import { JOB_PRIORITIES, type JobPriority } from './job-priority.js';
import { WorkQueue } from './work-queue.js';

// The queue alone, gated by `pnpm bench:ci`.
// The real pool's 500-layout burst, including posting/receive-handler cost, is measured by
// tooling/bench/src/workers/layout-burst.bench.ts. It measures Node worker transport
// and layout latency, not browser rendering or frame-time impact while remote motion arrives.

/** A viewport change's worth of work: 10k jobs, the order a dirty board would enqueue them. */
const JOB_COUNT = 10_000;

function priorityOf(index: number): JobPriority {
  return JOB_PRIORITIES[index % JOB_PRIORITIES.length] ?? 'prefetch';
}

function fillQueue(): WorkQueue<number> {
  let checksum = 0;
  const queue = new WorkQueue<number>(({ item }) => {
    checksum += item;
  });
  for (let index = 0; index < JOB_COUNT; index += 1) queue.enqueue(index, priorityOf(index));
  if (checksum !== 0) throw new Error('No job may run before the drain.');
  return queue;
}

describe('WorkQueue, 10k jobs', () => {
  bench('enqueue then drain everything', () => {
    fillQueue().drain(Infinity, () => 0);
  });

  bench('enqueue, cancel every other job, then drain', () => {
    const queue = fillQueue();
    for (let id = 1; id <= JOB_COUNT; id += 2) queue.cancel(id);
    queue.drain(Infinity, () => 0);
  });

  bench('enqueue, re-prioritise all after a viewport change, then drain', () => {
    const queue = fillQueue();
    queue.reprioritize(({ item }) => priorityOf(item + 1));
    queue.drain(Infinity, () => 0);
  });
});
