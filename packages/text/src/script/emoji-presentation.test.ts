import { describe, expect, it } from 'vitest';

import { hasEmojiPresentation, isEmojiPresentation, mayHoldEmoji } from './emoji-presentation.js';

describe('mayHoldEmoji', () => {
  it('holds for an emoji-presentation character or VS16 inside the stretch', () => {
    expect(mayHoldEmoji('a 👍 b', 0, 6)).toBe(true);
    expect(mayHoldEmoji('❤\ufe0f', 0, 2)).toBe(true);
    expect(mayHoldEmoji('a 👍 b', 0, 2)).toBe(false);
  });

  it('does not for plain text, text-default pictographs, joined or not, or an empty stretch', () => {
    expect(mayHoldEmoji('plain text', 0, 10)).toBe(false);
    expect(mayHoldEmoji('© 2026', 0, 6)).toBe(false);
    expect(mayHoldEmoji('☃\u200d☃', 0, 3)).toBe(false);
    expect(mayHoldEmoji('', 0, 0)).toBe(false);
  });
});

describe('isEmojiPresentation', () => {
  it('is false for an empty cluster, a joiner between letters or text-default pictographs', () => {
    expect(isEmojiPresentation('')).toBe(false);
    expect(isEmojiPresentation('क्\u200d')).toBe(false);
    expect(isEmojiPresentation('©\u200d©')).toBe(false);
  });

  it('takes a skin tone only after a modifier base, text-default bases included', () => {
    expect(isEmojiPresentation('☝\u{1f3fb}')).toBe(true);
    expect(isEmojiPresentation('©\u{1f3fb}')).toBe(false);
  });

  it('reads Emoji_Presentation from UCD 17, at both ends of its ranges', () => {
    expect(hasEmojiPresentation(0x231a)).toBe(true);
    expect(hasEmojiPresentation(0x2319)).toBe(false);
    expect(hasEmojiPresentation(0x10ffff)).toBe(false);
  });
});
