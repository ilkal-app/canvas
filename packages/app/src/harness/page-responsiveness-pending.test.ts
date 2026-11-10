// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import type { EngineFrameReport } from '@canvas/engine';

import { PageResponsiveness } from './page-responsiveness.js';

/**
 * A frame report with only what `record` reads: no pointer inputs, and the frame's time.
 *
 * @param frameTimeMs - The frame's time, ms.
 * @returns The report.
 */
function frameAt(frameTimeMs: number): EngineFrameReport {
  return { pointerInputs: [], frameTimeMs } as unknown as EngineFrameReport;
}

function keyAt(timestampMs: number): void {
  const event = new InputEvent('beforeinput', { bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: timestampMs });
  window.dispatchEvent(event);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('counts the key inputs since a time that no frame has followed yet', () => {
  vi.stubGlobal('PerformanceObserver', undefined);
  const recorder = new PageResponsiveness();
  keyAt(100);
  keyAt(200);
  keyAt(300);
  expect(recorder.pendingKeyInputs(0)).toBe(3);
  expect(recorder.pendingKeyInputs(150)).toBe(2);
  recorder.record(frameAt(250), 260);
  expect(recorder.pendingKeyInputs(0)).toBe(1);
  expect(recorder.keyInputLatenciesMs(0)).toEqual([160, 60]);
  recorder.record(frameAt(310), 320);
  expect(recorder.pendingKeyInputs(0)).toBe(0);
  recorder.stop();
});
