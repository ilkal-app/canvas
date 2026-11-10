import type { CreationGuard } from './creation-guard.js';
import type { DefinitionGuard } from './definition-guard.js';
import type { DoorGuard } from './door-guard.js';
import type { GroupRestoreListener } from './undo-groups.js';

/**
 * What tells a history's guards that a grouped step's undo or redo starts and ends: the
 * definition, creation and door guards, in that order. A guard that throws as it begins ends
 * those that began before it, so a failed restore leaves no guard holding its group.
 *
 * @param definition - The definition guard.
 * @param creation - The creation guard.
 * @param door - The door guard.
 * @returns The listener `UndoGroups` calls.
 */
export function guardGroupListener(
  definition: DefinitionGuard,
  creation: CreationGuard,
  door: DoorGuard,
): GroupRestoreListener {
  return {
    beginGroup: (steps) => {
      definition.beginGroup(steps);
      try {
        creation.beginGroup(steps);
        try {
          door.beginGroup();
        } catch (error) {
          creation.endGroup();
          throw error;
        }
      } catch (error) {
        definition.endGroup();
        throw error;
      }
    },
    endGroup: () => {
      definition.endGroup();
      creation.endGroup();
      door.endGroup();
    },
  };
}
