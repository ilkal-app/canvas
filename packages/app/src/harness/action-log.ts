/** How many dispatched actions the test harness keeps: enough for any one scenario step. */
export const ACTION_LOG_LIMIT = 100;

/**
 * Appends an action to a bounded log, returning a new log; the input is never changed. Once the
 * log holds `limit` actions the oldest are dropped, so a long scenario cannot grow it without
 * bound.
 *
 * @template TAction - The logged action type.
 * @param log - The actions logged so far, oldest first.
 * @param action - The action to log.
 * @param limit - The most actions to keep; {@link ACTION_LOG_LIMIT} unless given.
 * @returns The log with `action` last and at most `limit` entries.
 * @throws {RangeError} When `limit` is below one.
 */
export function appendToActionLog<TAction>(
  log: readonly TAction[],
  action: TAction,
  limit = ACTION_LOG_LIMIT,
): readonly TAction[] {
  if (limit < 1)
    throw new RangeError(`An action log keeps at least one action, not ${String(limit)}.`);
  return [...log.slice(Math.max(0, log.length + 1 - limit)), action];
}
