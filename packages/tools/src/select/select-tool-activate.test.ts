// Activation by Enter. Double presses are covered by
// select-tool-groups.test.ts, whose `activate` the text mode takes the same way.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { A, contextFor, FRAME_A, pointer, run } from './__fixtures__/select-tool-steps.js';
import { IDLE_SELECT_TOOL, stepSelectTool } from './select-tool.js';
import { EMPTY_SELECTION, selectionOf } from './selection-state.js';

describe('select tool: activation by Enter', () => {
  it('activates the one selected object at its frame centre, marked as from Enter', () => {
    const { intents, state } = stepSelectTool(
      IDLE_SELECT_TOOL,
      { kind: 'enter' },
      contextFor(selectionOf([A]), FRAME_A),
    );
    expect(intents).toEqual([
      { type: 'activate', id: A, world: { x: 50, y: 25 }, source: 'enter' },
    ]);
    expect(state).toBe(IDLE_SELECT_TOOL);
  });

  it('activates nothing with no selection, several objects, or mid-press', () => {
    const none = stepSelectTool(IDLE_SELECT_TOOL, { kind: 'enter' }, contextFor(EMPTY_SELECTION));
    expect(none.intents).toEqual([]);
    const two = stepSelectTool(
      IDLE_SELECT_TOOL,
      { kind: 'enter' },
      contextFor(selectionOf([A, 'b' as ObjectId]), FRAME_A),
    );
    expect(two.intents).toEqual([]);
    const pressing = run([pointer('pointerDown', { x: 10, y: 10 })], contextFor()).state;
    const mid = stepSelectTool(pressing, { kind: 'enter' }, contextFor(selectionOf([A]), FRAME_A));
    expect(mid.intents).toEqual([]);
  });
});
