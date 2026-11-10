import { afterEach, expect, it, vi } from 'vitest';

import { FakeCanvas } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import type { EngineFrameReport } from './engine-host.js';
import { WorkerEngineHost } from './worker-engine-host.js';

afterEach(() => vi.restoreAllMocks());

it('stamps only recording batches and converts both transfer legs into page-clock durations', async () => {
  const now = vi.spyOn(performance, 'now');
  now.mockReturnValue(100);
  const worker = new InMemoryEngineWorker(1_000_050);
  const created = WorkerEngineHost.create(worker, new FakeCanvas(), 1_000_000);
  await settle();
  const host = await created;
  const reports: EngineFrameReport[] = [];
  host.onFrame((report) => reports.push(report));

  host.setGridVisible(true);
  await worker.runFrame(16);
  expect(worker.received[1]).not.toHaveProperty('postedMs');
  expect(reports[0]).not.toHaveProperty('transferMs');

  host.startFrameStats(8);
  await settle();
  worker.platform.clockMs = 60;
  now.mockReturnValue(100);
  host.setGridVisible(false);
  await settle();
  const batch = worker.received.at(-1);
  expect(batch).toMatchObject({ type: 'engine-commands', postedMs: 100 });
  worker.platform.clockMs = 70;
  now.mockReturnValue(140);
  await worker.runFrame(32);
  const transfer = reports.at(-1)?.transferMs;
  expect(transfer).toEqual({ pageToWorker: 10, workerToPage: 20 });

  host.stopFrameStats();
  await settle();
  host.setGridVisible(true);
  await worker.runFrame(48);
  expect(worker.received.at(-1)).not.toHaveProperty('postedMs');
  expect(reports.at(-1)).not.toHaveProperty('transferMs');
  host.destroy();
});
