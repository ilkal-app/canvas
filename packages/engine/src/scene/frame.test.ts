import { describe, expect, it } from 'vitest';

import { NO_FRAME_TIMERS } from './frame-context.js';
import type { FrameContext, FrameStage, FrameTimerHook } from './frame-context.js';
import { Frame } from './frame.js';

/** Stages only record their names here; the frame reads nothing but the timer hook. */
const CONTEXT = { timers: NO_FRAME_TIMERS } as FrameContext;

function recordingStage(name: string, log: string[]): FrameStage {
  return {
    name,
    run: () => {
      log.push(name);
    },
  };
}

function frameOf(log: string[], ...names: string[]): Frame {
  return new Frame(names.map((name) => recordingStage(name, log)));
}

describe('Frame', () => {
  it('runs its stages in order', () => {
    const log: string[] = [];
    frameOf(log, 'a', 'b', 'c').run(CONTEXT);
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('inserts a stage before or after a named stage', () => {
    const log: string[] = [];
    const frame = frameOf(log, 'collect', 'draw');
    frame.insertStage('before', 'draw', recordingStage('segments', log));
    frame.insertStage('after', 'draw', recordingStage('overlay', log));
    frame.insertStage('after', 'collect', recordingStage('layout', log));
    expect(frame.stageNames).toEqual(['collect', 'layout', 'segments', 'draw', 'overlay']);
    frame.run(CONTEXT);
    expect(log).toEqual(['collect', 'layout', 'segments', 'draw', 'overlay']);
  });

  it('wraps a stage in place, keeping its position', () => {
    const log: string[] = [];
    const frame = frameOf(log, 'a', 'b', 'c');
    frame.wrapStage('b', (inner) => ({
      name: inner.name,
      run: (context) => {
        log.push('before b');
        inner.run(context);
        log.push('after b');
      },
    }));
    frame.run(CONTEXT);
    expect(log).toEqual(['a', 'before b', 'b', 'after b', 'c']);
  });

  it('refuses an unknown anchor, a duplicate name and a wrapper that renames', () => {
    const frame = frameOf([], 'a');
    expect(() => {
      frame.insertStage('after', 'missing', recordingStage('x', []));
    }).toThrow(RangeError);
    expect(() => {
      frame.insertStage('after', 'a', recordingStage('a', []));
    }).toThrow(RangeError);
    expect(() => new Frame([recordingStage('a', []), recordingStage('a', [])])).toThrow(RangeError);
    expect(() => {
      frame.wrapStage('a', () => recordingStage('renamed', []));
    }).toThrow(RangeError);
    expect(() => {
      frame.wrapStage('missing', (inner) => inner);
    }).toThrow(RangeError);
  });

  it('reports each stage to the timer hook, even one that throws', () => {
    const events: string[] = [];
    const timers: FrameTimerHook = {
      stageStarted: (name) => events.push(`start ${name}`),
      stageEnded: (name) => events.push(`end ${name}`),
    };
    const failing: FrameStage = {
      name: 'fails',
      run: () => {
        throw new Error('stage failed');
      },
    };
    const frame = new Frame([recordingStage('ok', []), failing, recordingStage('never', [])]);
    expect(() => {
      frame.run({ timers } as FrameContext);
    }).toThrow('stage failed');
    expect(events).toEqual(['start ok', 'end ok', 'start fails', 'end fails']);
  });
});
