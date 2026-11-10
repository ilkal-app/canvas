/**
 * The words a control whose feature is not built yet adds after its name, in its accessible name
 * and its tooltip (the owner's 2026-10-05 rule for unbuilt features: no date, no issue).
 */
export const NOT_AVAILABLE_YET = 'not available yet';

/**
 * A not-yet-built control's accessible name and tooltip: `Pen — not available yet`. Pure.
 *
 * @param label - The control's own name (`Pen`).
 * @returns The name with the words after it.
 */
export function notAvailableName(label: string): string {
  return `${label} — ${NOT_AVAILABLE_YET}`;
}
