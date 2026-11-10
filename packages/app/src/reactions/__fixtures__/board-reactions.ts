import { vi } from 'vitest';

import type { BoardReactions } from '../reactions-context.js';

/**
 * The board's reactions for a test: a person who may react, nothing armed or shown, every action
 * a spy.
 *
 * @param fields - What differs.
 * @returns The reactions.
 */
export function boardReactions(fields: Partial<BoardReactions> = {}): BoardReactions {
  return {
    canReact: true,
    isOpen: true,
    armed: null,
    last: undefined,
    shown: [],
    toggle: vi.fn(),
    close: vi.fn(),
    arm: vi.fn(),
    drop: vi.fn(),
    repeat: vi.fn(),
    sendAtCentre: vi.fn(),
    provideCentre: vi.fn(),
    ...fields,
  };
}
