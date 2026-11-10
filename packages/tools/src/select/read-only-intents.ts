import type { SelectIntent } from './select-intent.js';

/**
 * What the select tool does for a person who cannot edit the board (a viewer): the
 * intents that only look (select, toggle, marquee, activate, the context menu, the double-tap)
 * pass as they are; the transforms (move, resize, rotate, nudge) are dropped, so no preview
 * shows and nothing is planned; and a gesture's end is always a cancel, so a release runs no
 * command. An `activate` still reaches the app, whose router starts no mode for a viewer
 * (entering a group is a change of scope, not an edit). Pure; the input is not changed.
 *
 * @param intents - The intents of one step of the select tool.
 * @returns The intents a read-only select tool applies; a new array.
 */
export function readOnlyIntentsOf(intents: readonly SelectIntent[]): SelectIntent[] {
  const kept: SelectIntent[] = [];
  for (const intent of intents) {
    switch (intent.type) {
      case 'move':
      case 'resize':
      case 'rotate':
      case 'nudge':
        break;
      case 'commit':
        kept.push({ type: 'cancel' });
        break;
      default:
        kept.push(intent);
    }
  }
  return kept;
}
