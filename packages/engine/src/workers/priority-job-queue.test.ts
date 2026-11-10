import { describe, expect, it } from 'vitest';

import type { JobPriority } from './job-priority.js';
import { PriorityJobQueue } from './priority-job-queue.js';

function dequeueAll<T>(queue: PriorityJobQueue<T>): T[] {
  const items: T[] = [];
  for (let job = queue.dequeue(); job !== undefined; job = queue.dequeue()) {
    items.push(job.item);
  }
  return items;
}

describe('PriorityJobQueue', () => {
  it('runs visible before near before prefetch, whatever the enqueue order', () => {
    const queue = new PriorityJobQueue<string>();
    queue.enqueue('prefetch-a', 'prefetch');
    queue.enqueue('near-a', 'near');
    queue.enqueue('visible-a', 'visible');

    expect(dequeueAll(queue)).toEqual(['visible-a', 'near-a', 'prefetch-a']);
  });

  it('keeps enqueue order within a priority (stable FIFO)', () => {
    const queue = new PriorityJobQueue<string>();
    for (const item of ['v1', 'n1', 'v2', 'n2', 'v3']) {
      queue.enqueue(item, item.startsWith('v') ? 'visible' : 'near');
    }

    expect(dequeueAll(queue)).toEqual(['v1', 'v2', 'v3', 'n1', 'n2']);
  });

  it('assigns increasing ids and reports each job with its id and priority', () => {
    const queue = new PriorityJobQueue<string>();
    const first = queue.enqueue('a', 'near');
    const second = queue.enqueue('b', 'visible');

    expect(second).toBeGreaterThan(first);
    expect(queue.dequeue()).toEqual({ id: second, priority: 'visible', item: 'b' });
    expect(queue.dequeue()).toEqual({ id: first, priority: 'near', item: 'a' });
    expect(queue.dequeue()).toBeUndefined();
  });

  it('counts pending jobs and answers whether an id is pending', () => {
    const queue = new PriorityJobQueue<string>();
    const id = queue.enqueue('a', 'visible');
    queue.enqueue('b', 'near');

    expect(queue.size).toBe(2);
    expect(queue.has(id)).toBe(true);
    queue.dequeue();
    expect(queue.size).toBe(1);
    expect(queue.has(id)).toBe(false);
  });

  it('peeks at the next job without removing it', () => {
    const queue = new PriorityJobQueue<string>();
    queue.enqueue('near', 'near');
    queue.enqueue('visible', 'visible');

    expect(queue.peek()?.item).toBe('visible');
    expect(queue.size).toBe(2);
    expect(queue.dequeue()?.item).toBe('visible');
  });

  it('cancels a pending job by id and returns it, so it never runs', () => {
    const queue = new PriorityJobQueue<string>();
    queue.enqueue('a', 'visible');
    const id = queue.enqueue('b', 'visible');
    queue.enqueue('c', 'visible');

    expect(queue.cancel(id)).toEqual({ id, priority: 'visible', item: 'b' });
    expect(queue.size).toBe(2);
    expect(queue.peek()?.item).toBe('a');
    expect(dequeueAll(queue)).toEqual(['a', 'c']);
  });

  it('returns undefined when cancelling an id that is not pending', () => {
    const queue = new PriorityJobQueue<string>();
    const id = queue.enqueue('a', 'visible');
    queue.dequeue();

    expect(queue.cancel(id)).toBeUndefined();
    expect(queue.cancel(999)).toBeUndefined();
  });

  it('moves one job to a new priority, keeping its place by enqueue order', () => {
    const queue = new PriorityJobQueue<string>();
    queue.enqueue('v1', 'visible');
    const late = queue.enqueue('p1', 'prefetch');
    queue.enqueue('v2', 'visible');
    const early = queue.enqueue('n1', 'near');

    expect(queue.setPriority(late, 'visible')).toBe(true);
    expect(queue.setPriority(early, 'near')).toBe(true);

    expect(dequeueAll(queue)).toEqual(['v1', 'p1', 'v2', 'n1']);
  });

  it('reports false when re-prioritising an id that is not pending', () => {
    const queue = new PriorityJobQueue<string>();

    expect(queue.setPriority(42, 'visible')).toBe(false);
  });

  it('re-prioritises every pending job when the viewport changes, keeping FIFO order', () => {
    const queue = new PriorityJobQueue<{ objectId: string }>();
    for (const objectId of ['a', 'b', 'c', 'd', 'e']) {
      queue.enqueue({ objectId }, 'prefetch');
    }
    const onScreen = new Set(['d', 'b']);
    const nearby = new Set(['e']);

    queue.reprioritize(({ item: { objectId } }): JobPriority => {
      if (onScreen.has(objectId)) return 'visible';
      return nearby.has(objectId) ? 'near' : 'prefetch';
    });

    expect(dequeueAll(queue).map(({ objectId }) => objectId)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });

  it('hands the classifier each job with its id and current priority', () => {
    const queue = new PriorityJobQueue<string>();
    const id = queue.enqueue('a', 'near');
    const seen: unknown[] = [];

    queue.reprioritize((job) => {
      seen.push(job);
      return job.priority;
    });

    expect(seen).toEqual([{ id, priority: 'near', item: 'a' }]);
    expect(queue.dequeue()).toMatchObject({ item: 'a', priority: 'near' });
  });

  it('stays correct after many cancellations force it to compact', () => {
    const queue = new PriorityJobQueue<number>();
    const ids: number[] = [];
    for (let index = 0; index < 5000; index += 1) {
      ids.push(queue.enqueue(index, index % 2 === 0 ? 'visible' : 'near'));
    }
    for (const [index, id] of ids.entries()) {
      if (index % 10 !== 0) queue.cancel(id);
    }

    const items = dequeueAll(queue);

    expect(items).toHaveLength(500);
    expect(items.slice(0, 3)).toEqual([0, 10, 20]);
    expect(items.every((item) => item % 10 === 0)).toBe(true);
    expect(queue.size).toBe(0);
  });

  it('rejects an unknown priority without leaving a phantom job behind', () => {
    const queue = new PriorityJobQueue<string>();
    const id = queue.enqueue('a', 'near');
    const bogus = 'urgent' as JobPriority;

    expect(() => queue.enqueue('b', bogus)).toThrow(RangeError);
    expect(() => queue.setPriority(id, bogus)).toThrow(RangeError);
    expect(() => {
      queue.reprioritize(() => bogus);
    }).toThrow(RangeError);

    expect(queue.size).toBe(1);
    expect(dequeueAll(queue)).toEqual(['a']);
  });

  it('empties itself with clear and returns what was pending in enqueue order', () => {
    const queue = new PriorityJobQueue<string>();
    queue.enqueue('a', 'prefetch');
    queue.enqueue('b', 'visible');

    expect(queue.clear().map(({ item }) => item)).toEqual(['a', 'b']);
    expect(queue.size).toBe(0);
    expect(queue.dequeue()).toBeUndefined();
  });
});
