import { expect, it } from 'vitest';

import { WorkerReads } from './worker-reads.js';

it('gives each read a fresh id and resolves it with its own kind of answer', async () => {
  const reads = new WorkerReads();
  const ids: number[] = [];
  const first = reads.open('projection', (id) => ids.push(id));
  const second = reads.open('certificate', (id) => ids.push(id));
  expect(ids).toEqual([1, 2]);
  reads.settle(1, { kind: 'projection', value: undefined });
  reads.settle(2, { kind: 'certificate', value: undefined });
  await expect(first).resolves.toBeUndefined();
  await expect(second).resolves.toBeUndefined();
});

it('rejects an answer of the wrong kind, and ignores an unknown or settled id', async () => {
  const reads = new WorkerReads();
  const read = reads.open('stats', () => undefined);
  reads.settle(9, new Error('unknown'));
  reads.settle(1, { kind: 'projection', value: undefined });
  reads.settle(1, new Error('again'));
  await expect(read).rejects.toThrow('answered a stats read wrongly');
});

it('rejects every waiting read at once', async () => {
  const reads = new WorkerReads();
  const pixels = reads.open('pixels', () => undefined);
  const stats = reads.open('stats', () => undefined);
  reads.rejectAll(new Error('gone'));
  await expect(pixels).rejects.toThrow('gone');
  await expect(stats).rejects.toThrow('gone');
});
