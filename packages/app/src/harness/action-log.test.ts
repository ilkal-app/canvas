import { describe, expect, it } from 'vitest';

import { ACTION_LOG_LIMIT, appendToActionLog } from './action-log.js';

describe('appendToActionLog', () => {
  it('appends the action after the ones already logged', () => {
    expect(appendToActionLog(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('drops the oldest actions once the log holds its limit', () => {
    expect(appendToActionLog(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('keeps the last ACTION_LOG_LIMIT actions by default', () => {
    let log: readonly number[] = [];
    for (let index = 0; index < ACTION_LOG_LIMIT + 5; index += 1) {
      log = appendToActionLog(log, index);
    }
    expect(log).toHaveLength(ACTION_LOG_LIMIT);
    expect(log[0]).toBe(5);
    expect(log.at(-1)).toBe(ACTION_LOG_LIMIT + 4);
  });

  it('never changes the log it is given', () => {
    const log = Object.freeze(['a', 'b']);
    appendToActionLog(log, 'c', 2);
    expect(log).toEqual(['a', 'b']);
  });

  it('rejects a limit below one', () => {
    expect(() => appendToActionLog([], 'a', 0)).toThrow(RangeError);
  });
});
