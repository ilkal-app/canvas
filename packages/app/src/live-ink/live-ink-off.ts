/**
 * Whether the page asked to draw the stroke under way through the engine alone
 * (`?liveink=off`), to compare with the overlay. Pure.
 *
 * @param search - The page URL's query, `window.location.search`.
 * @returns True when the overlay is off.
 */
export function isLiveInkOff(search: string): boolean {
  return new URLSearchParams(search).get('liveink') === 'off';
}
