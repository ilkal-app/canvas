/**
 * Runs automatic repair even when view listeners throw, preserving both failures if needed.
 *
 * @param notify - Delivers the view transition.
 * @param repair - Materializes repair after listeners finish.
 * @throws {unknown} Either failure, or both in an AggregateError.
 */
export function repairAfter(notify: () => void, repair: () => void): void {
  let failure: { readonly error: unknown } | undefined;
  try {
    notify();
  } catch (error) {
    failure = { error };
  }
  try {
    repair();
  } catch (error) {
    if (failure === undefined) throw error;
    throw new AggregateError(
      [failure.error, error],
      'A view listener failed, and so did its repair',
    );
  }
  if (failure !== undefined) throw failure.error;
}
