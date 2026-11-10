import { expect, it, vi } from 'vitest';

import type { EngineHost, InputMark, PointerInput } from '@canvas/engine';

import { hostView } from './host-view.js';

const mark: InputMark = { kind: 'drag-end', id: 1, timestampMs: 10, markedMs: 12 };
const pointer: PointerInput = {
  type: 'up',
  xPx: 1,
  yPx: 2,
  buttons: 0,
  pointerId: 1,
  timestampMs: 10,
};

function fixture() {
  const sent: string[] = [];
  const frames: (() => void)[] = [];
  const acknowledgements: ((index: number) => void)[] = [];
  const host = {
    onFrame: () => () => undefined,
    applyChangeSet: () => sent.push('scene'),
    setOverlay: () => sent.push('overlay'),
    pointer: () => sent.push('pointer'),
    markInput: () => sent.push('mark'),
    requestFrameAcknowledgement: () => {
      sent.push('ack');
      return new Promise<number>((resolve) => acknowledgements.push(resolve));
    },
  } as unknown as EngineHost;
  const view = hostView(host, {
    request: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancel: vi.fn(),
  });
  const tick = () => frames.shift()?.();
  return { view, sent, tick, acknowledgements };
}

it('sends a queued mark after scene, overlay and pointer, before its frame acknowledgement', () => {
  const f = fixture();
  f.view.enqueue({ created: [], updated: [], deleted: [], get: () => undefined });
  f.view.showLayer('trace', { visible: true });
  f.view.pointer(pointer);
  f.view.markInput(mark);
  expect(f.sent).toEqual([]);
  f.tick();
  expect(f.sent).toEqual(['scene', 'overlay', 'pointer', 'mark', 'ack']);
  f.view.destroy();
});

it('sends a mark directly when nothing is queued', () => {
  const f = fixture();
  f.view.markInput(mark);
  expect(f.sent).toEqual(['mark']);
  f.view.destroy();
});

it('keeps a mark with its queued scene until the previous acknowledgement grants credit', async () => {
  const f = fixture();
  f.view.pointer(pointer);
  f.tick();
  f.view.pointer(pointer);
  f.view.markInput(mark);
  f.tick();
  expect(f.sent).toEqual(['pointer', 'ack']);
  f.acknowledgements[0]?.(0);
  await Promise.resolve();
  expect(f.sent).toEqual(['pointer', 'ack', 'pointer', 'mark', 'ack']);
  f.view.destroy();
});
