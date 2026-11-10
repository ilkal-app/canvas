// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import type { EngineHost } from '@canvas/engine';

import { attachEngineHarness } from './attach-engine-harness.js';
import type { EngineHarnessCanvas } from './engine-harness.js';
import { PageResponsiveness } from './page-responsiveness.js';

class Observer {
  static supportedEntryTypes: string[] = [];
  observe(): void {
    return;
  }
  disconnect(): void {
    return;
  }
}

function host(): EngineHost {
  return {
    kind: 'worker',
    capabilities: {
      backendName: 'webgpu',
      adapterName: 'test',
      isSoftwareAdapter: false,
      hasTimestampQuery: false,
    },
    onFrame: () => {
      return () => {
        return;
      };
    },
  } as unknown as EngineHost;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  [['longtask', 'long-animation-frame'], true, true],
  [['longtask'], true, false],
  [['long-animation-frame'], false, true],
  [[], false, false],
] as const)(
  'exposes observer support %j on the recorder and attached harness',
  (types, hasLongTasks, hasLongFrames) => {
    Observer.supportedEntryTypes = [...types];
    vi.stubGlobal('PerformanceObserver', Observer);
    const recorder = new PageResponsiveness();
    const canvas = document.createElement('canvas') as EngineHarnessCanvas;
    const detach = attachEngineHarness(host(), canvas);
    try {
      expect(recorder.canObserveLongTasks).toBe(hasLongTasks);
      expect(recorder.canObserveLongAnimationFrames).toBe(hasLongFrames);
      expect(canvas.engineHarness?.canObserveLongTasks).toBe(hasLongTasks);
      expect(canvas.engineHarness?.canObserveLongAnimationFrames).toBe(hasLongFrames);
    } finally {
      recorder.stop();
      detach();
    }
  },
);

it('reports no observer support when PerformanceObserver is unavailable', () => {
  vi.stubGlobal('PerformanceObserver', undefined);
  const recorder = new PageResponsiveness();
  const canvas = document.createElement('canvas') as EngineHarnessCanvas;
  const detach = attachEngineHarness(host(), canvas);
  try {
    expect(recorder.canObserveLongTasks).toBe(false);
    expect(recorder.canObserveLongAnimationFrames).toBe(false);
    expect(canvas.engineHarness?.canObserveLongTasks).toBe(false);
    expect(canvas.engineHarness?.canObserveLongAnimationFrames).toBe(false);
  } finally {
    recorder.stop();
    detach();
  }
});
