/** What the typing scenario types, cycled: a pangram and a space. */
export const TYPED_TEXT = 'The quick brown fox jumps over the lazy dog. ';

/** One keystroke of the typing scenario: the text it types, and when it lands. */
export interface TypedKey {
  /** When, ms from the scenario's start. */
  readonly atMs: number;
  /** The character typed: the `data` of its `insertText` input event. */
  readonly data: string;
}

/**
 * The keystrokes of typing at a steady rate: one character of {@link TYPED_TEXT} per keystroke,
 * cycled, the first at `1 / rateHz`. Pure.
 *
 * @param rateHz - Keystrokes per second.
 * @param durationMs - How long to type, ms.
 * @returns One keystroke per step, in order.
 */
export function typingTimeline(rateHz: number, durationMs: number): TypedKey[] {
  const stepMs = 1_000 / rateHz;
  const count = Math.floor((durationMs * rateHz) / 1_000 + 1e-9);
  const keys: TypedKey[] = [];
  for (let index = 1; index <= count; index += 1) {
    keys.push({ atMs: index * stepMs, data: TYPED_TEXT.charAt((index - 1) % TYPED_TEXT.length) });
  }
  return keys;
}
