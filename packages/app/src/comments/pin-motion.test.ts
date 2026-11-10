import { describe, expect, it } from 'vitest';

import { PinMotion, PIN_SETTLE_MS } from './pin-motion.js';

describe('PinMotion', () => {
  it('shows a pin that has not moved, and hides it while the local gesture moves its object', () => {
    const motion = new PinMotion();
    expect(motion.isHidden('a', '0,0', 0, false)).toBe(false);
    expect(motion.isHidden('a', '0,0', 16, true)).toBe(true);
    expect(motion.isHidden('a', '0,0', 32, true)).toBe(true);
  });

  it('keeps it hidden until 120 ms after the drop moves it in the document', () => {
    const motion = new PinMotion();
    motion.isHidden('a', '0,0', 0, true);
    // The drop: the gesture ends and the document has the object at its new place.
    expect(motion.isHidden('a', '40,10', 100, false)).toBe(true);
    expect(motion.isHidden('a', '40,10', 100 + PIN_SETTLE_MS - 1, false)).toBe(true);
    expect(motion.isHidden('a', '40,10', 100 + PIN_SETTLE_MS, false)).toBe(false);
  });

  it('hides a pin while remote changes keep moving its object, and shows it once they stop', () => {
    const motion = new PinMotion();
    motion.isHidden('a', '0,0', 0, false);
    for (let at = 50; at <= 500; at += 50) {
      expect(motion.isHidden('a', `${String(at)},0`, at, false)).toBe(true);
    }
    expect(motion.isHidden('a', '500,0', 500 + PIN_SETTLE_MS - 1, false)).toBe(true);
    expect(motion.isHidden('a', '500,0', 500 + PIN_SETTLE_MS, false)).toBe(false);
  });

  it('hides a pin whose object changes place though the pin’s own point does not (a resize)', () => {
    const motion = new PinMotion();
    motion.isHidden('a', 'note 0,0 200x200', 0, false);
    expect(motion.isHidden('a', 'note 0,0 260x240', 40, false)).toBe(true);
    expect(motion.isHidden('a', 'note 0,0 260x240', 40 + PIN_SETTLE_MS, false)).toBe(false);
  });

  it('tracks each pin on its own and forgets the pins no longer shown', () => {
    const motion = new PinMotion();
    motion.isHidden('a', '0,0', 0, false);
    motion.isHidden('b', '0,0', 0, false);
    expect(motion.isHidden('a', '5,0', 10, false)).toBe(true);
    expect(motion.isHidden('b', '0,0', 10, false)).toBe(false);
    motion.keepOnly(new Set(['b']));
    // Seen again, `a` starts afresh: its first place is no move.
    expect(motion.isHidden('a', '9,0', 20, false)).toBe(false);
  });
});
