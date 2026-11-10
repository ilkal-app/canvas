import { expect, it } from 'vitest';

import type { FrameStage } from './frame-context.js';
import { Frame } from './frame.js';

const stage = (name: string): FrameStage => ({ name, run: () => undefined });

it('refuses same-name wrappers and stage mutation after capturing content structure', () => {
  const draw = stage('draw');
  const frame = new Frame([draw]);
  const current = frame.captureContentStructure();
  expect(current()).toBe(true);
  frame.wrapStage('draw', (inner) => ({ ...inner, run: () => undefined }));
  expect(current()).toBe(false);
  const next = frame.captureContentStructure();
  frame.insertStage('after', 'draw', stage('extension'));
  expect(next()).toBe(false);
  const mutable = stage('draw');
  const another = new Frame([mutable]);
  const unchanged = another.captureContentStructure();
  Reflect.set(mutable, 'run', () => undefined);
  expect(unchanged()).toBe(false);
});

it('excludes explicitly transient overlays but rejects their replacement', () => {
  const frame = new Frame([stage('draw'), stage('submit')]);
  const current = frame.captureContentStructure();
  frame.insertTransientOverlay(stage('selection'));
  expect(current()).toBe(true);
  expect(frame.stageNames).toEqual(['draw', 'selection', 'submit']);
  frame.wrapStage('selection', (inner) => ({ ...inner }));
  expect(current()).toBe(false);
});
