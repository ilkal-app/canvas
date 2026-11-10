import type { PresenceState } from './presence-state.js';

type Writable<T> = { -readonly [Key in keyof T]: T[Key] };

/**
 * What of a cleaned remote state the channel shows, given whether the board holds an object:
 * the state as it is, unless it claims to edit an object the board does not hold,
 * when it is shown without that claim (the rest of the peer's presence stays). The state without
 * its claim is remembered per state, so an unchanged awareness state keeps giving the same
 * object and the snapshot does not change with it. Pure apart from that memo.
 *
 * @param objectExists - Whether the board holds an object; every claim is kept if absent.
 * @returns The function the inbound flush passes each cleaned state through.
 */
export function editingOnBoard(
  objectExists: ((objectId: string) => boolean) | undefined,
): (state: PresenceState) => PresenceState {
  const withoutEditing = new WeakMap<PresenceState, PresenceState>();
  return (state) => {
    const { editing } = state;
    if (editing === undefined || objectExists === undefined || objectExists(editing.objectId)) {
      return state;
    }
    const known = withoutEditing.get(state);
    if (known !== undefined) return known;
    const kept: Writable<PresenceState> = { ...state };
    delete kept.editing;
    withoutEditing.set(state, kept);
    return kept;
  };
}
