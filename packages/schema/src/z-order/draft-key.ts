/**
 * The stacking key a draft is previewed with (an input method composing in text not created
 * yet), so the composition shows on top, as the created object will be. By rule, not by
 * length: a board's keys are base-62 digits (`0-9A-Za-z`, the highest `z`, U+007A) and siblings
 * compare by UTF-16 code units (`compareSiblings`), so a key whose first unit is above `z` sorts
 * above every real key, however long. It is no valid key, so it can never be written or collide
 * with one: `createObject` gives the object its own key. The engine knows a tool's live preview
 * by it (a stroke being drawn, `isLiveStroke`).
 */
export const DRAFT_PREVIEW_Z = '~';
