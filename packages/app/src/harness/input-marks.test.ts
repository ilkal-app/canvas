// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';

import type { InputMark } from '@canvas/engine';

import { InputMarks } from './input-marks.js';

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function marker() {
  const marks: InputMark[] = [];
  const inputMarks = new InputMarks((mark) => marks.push(mark));
  stops.push(() => {
    inputMarks.stop();
  });
  return { marks, inputMarks };
}

it('marks an event the app stops at its target once, just after its dispatch', async () => {
  const f = marker();
  f.inputMarks.arm('beforeinput', 'keystroke');
  const target = document.createElement('textarea');
  document.body.append(target);
  target.addEventListener('beforeinput', (event) => {
    event.stopPropagation();
  });
  target.dispatchEvent(new Event('beforeinput', { bubbles: true }));
  expect(f.marks).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.marks).toHaveLength(1);
  // A second stopped event marks the one before it at once, then itself after its dispatch.
  target.dispatchEvent(new Event('beforeinput', { bubbles: true }));
  target.dispatchEvent(new Event('beforeinput', { bubbles: true }));
  expect(f.marks).toHaveLength(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.marks).toHaveLength(3);
  expect(new Set(f.marks.map(({ id }) => id)).size).toBe(3);
  target.remove();
});

it('marks a bubbling event once, not again when its fallback fires', async () => {
  const f = marker();
  f.inputMarks.arm('pointerup', 'drag-end');
  document.dispatchEvent(new Event('pointerup', { bubbles: true }));
  expect(f.marks).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.marks).toHaveLength(1);
});

it('re-arming a type changes its kind, and stop disarms every type', () => {
  const f = marker();
  f.inputMarks.arm('keydown', 'keystroke');
  f.inputMarks.arm('keydown', 'zoom-step');
  f.inputMarks.arm('pointerup', 'drag-end');
  document.dispatchEvent(new Event('keydown', { bubbles: true }));
  expect(f.marks.map(({ kind }) => kind)).toEqual(['zoom-step']);
  f.inputMarks.stop();
  document.dispatchEvent(new Event('keydown', { bubbles: true }));
  document.dispatchEvent(new Event('pointerup', { bubbles: true }));
  expect(f.marks).toHaveLength(1);
});

it('marks only pressed moves as draw moves', () => {
  const f = marker();
  f.inputMarks.arm('pointermove', 'draw-move');
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 0 }));
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1 }));
  expect(f.marks.map(({ kind }) => kind)).toEqual(['draw-move']);
});
