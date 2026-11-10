import { expect, it, vi } from 'vitest';

import type { EngineHost, InputMark, PointerInput } from '@canvas/engine';

import { hostView } from './host-view.js';

const mark: InputMark = { kind: 'keystroke', id: 1, timestampMs: 1, markedMs: 2 };
const pointer: PointerInput = {
  type: 'move',
  xPx: 1,
  yPx: 1,
  buttons: 0,
  pointerId: 1,
  timestampMs: 1,
};

function fixture(host: Partial<EngineHost>) {
  const frames: (() => void)[] = [];
  const view = hostView({ onFrame: () => () => undefined, ...host } as EngineHost, {
    request: (callback) => frames.push(callback),
    cancel: vi.fn(),
  });
  return { view, tick: () => frames.shift()?.() };
}

it('drops marks on a host that cannot take them, queued or not', () => {
  const sent = vi.fn();
  const f = fixture({ pointer: sent });
  f.view.markInput(mark);
  f.view.pointer(pointer);
  f.view.markInput(mark);
  f.tick();
  expect(sent).toHaveBeenCalledTimes(1);
  f.view.destroy();
});

it('ignores marks once destroyed', () => {
  const markInput = vi.fn();
  const f = fixture({ markInput });
  f.view.destroy();
  f.view.markInput(mark);
  expect(markInput).not.toHaveBeenCalled();
});
