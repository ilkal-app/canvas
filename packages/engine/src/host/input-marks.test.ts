import { expect, it, vi } from 'vitest';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import type { EngineFrameReport } from './engine-host.js';
import { isEngineInputsCompleted, isInputMark, type InputMark } from './input-marks.js';
import { MainThreadEngineHost } from './main-thread-engine-host.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const mark: InputMark = { kind: 'keystroke', id: 1, timestampMs: 10, markedMs: 11 };
const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

it('refuses marks and completions that are not objects', () => {
  expect(isInputMark(null)).toBe(false);
  expect(isInputMark('keystroke')).toBe(false);
  expect(isEngineInputsCompleted(undefined)).toBe(false);
  expect(isEngineInputsCompleted({ frameIndex: 1 })).toBe(false);
});

it('reports nothing for a mark whose GPU work finishes after the host is destroyed', async () => {
  const platform = new FakeHostPlatform();
  const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
  const completions: unknown[] = [];
  host.onInputsCompleted((completion) => completions.push(completion));
  host.setCamera(camera);
  host.markInput(mark);
  host.destroy();
  host.markInput(mark);
  platform.runFrame(16);
  await Promise.resolve();
  expect(completions).toEqual([]);
});

it('counts a negative transfer leg as an offset error and reports no timings', async () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  // The worker's clock claims to start a second after the page's: every hop looks negative.
  const worker = new InMemoryEngineWorker(1_001_000);
  const created = WorkerEngineHost.create(worker, new FakeCanvas(), 1_000_000);
  await settle();
  const host = await created;
  const reports: EngineFrameReport[] = [];
  host.onFrame((report) => reports.push(report));
  host.startFrameStats(4);
  host.setGridVisible(true);
  await worker.runFrame(16);
  expect(reports.at(-1)).not.toHaveProperty('transferMs');
  expect(host.transferOffsetErrors).toBe(1);
  host.destroy();
  now.mockRestore();
});
