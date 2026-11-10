// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import type { EngineHost, InputMark } from '@canvas/engine';

import { attachEngineHarness } from './attach-engine-harness.js';
import type { EngineHarnessCanvas } from './engine-harness.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function fixture() {
  const marks: InputMark[] = [];
  const host = {
    kind: 'main',
    capabilities: {
      backendName: 'webgl2',
      adapterName: 'fake',
      isSoftwareAdapter: false,
      hasTimestampQuery: false,
    },
    onFrame: () => () => undefined,
    markInput: (mark: InputMark) => marks.push(mark),
  } as unknown as EngineHost;
  const canvas = document.createElement('canvas') as EngineHarnessCanvas;
  const detach = attachEngineHarness(host, canvas);
  cleanups.push(detach);
  const harness = canvas.engineHarness;
  if (!harness) throw new Error('Harness was not attached');
  return { marks, harness };
}

it('marks an armed keydown after the app window bubble listener with the event timestamp', () => {
  vi.spyOn(performance, 'now').mockReturnValue(50);
  const f = fixture();
  const order: string[] = [];
  const appListener = () => {
    order.push('app');
    expect(f.marks).toHaveLength(0);
  };
  window.addEventListener('keydown', appListener);
  cleanups.push(() => {
    window.removeEventListener('keydown', appListener);
  });
  f.harness.armInputMarks('keydown', 'zoom-step');
  const event = new KeyboardEvent('keydown', { bubbles: true, key: '+' });
  document.dispatchEvent(event);
  expect(order).toEqual(['app']);
  expect(f.marks).toMatchObject([
    { kind: 'zoom-step', timestampMs: event.timeStamp, markedMs: 50 },
  ]);
  expect(f.marks[0]?.id).toBeGreaterThan(0);
});

it('does not mark unarmed events and disarms an event type', () => {
  const f = fixture();
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  expect(f.marks).toEqual([]);
  f.harness.armInputMarks('keydown', 'keystroke');
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  expect(f.marks).toHaveLength(1);
  f.harness.armInputMarks('keydown', undefined);
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  expect(f.marks).toHaveLength(1);
});

it('assigns increasing IDs to separate armed events', () => {
  const f = fixture();
  f.harness.armInputMarks('keydown', 'keystroke');
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  expect(f.marks[1]?.id).toBeGreaterThan(f.marks[0]?.id ?? 0);
});
