import type { DocumentStore } from '@canvas/document';
import type { BoardObject } from '@canvas/schema';
import type { SelectController } from '@canvas/tools';

import type { DocumentSceneFeed } from './document-scene-feed.js';
import type { EngineInspection } from './engine-document-types.js';

/** What {@link inspectEngineDocument} reads of the engine's document side. */
export interface InspectedParts {
  /** The document. */
  readonly store: Pick<DocumentStore, 'get'>;
  /** The select tool: its selection and entered group. */
  readonly controller: Pick<SelectController, 'selection' | 'enteredGroupId'>;
  /** The document's change sets: the recent ones, oldest first, and how many it has had. */
  readonly feed: Pick<DocumentSceneFeed, 'changeLog'>;
  /** The text being edited, or undefined. */
  readonly textEditing: EngineInspection['textEditing'];
}

/**
 * The selection, the selected objects as the document holds them, the recent change sets, the
 * entered group and the text being edited, for the test harness (`EngineDocument.inspect`).
 *
 * @param parts - What it reads.
 * @returns The inspection.
 */
export function inspectEngineDocument(parts: InspectedParts): EngineInspection {
  const { store, controller } = parts;
  const selectedIds = controller.selection.ids;
  return {
    selectedIds,
    selectedObjects: selectedIds
      .map((id) => store.get(id))
      .filter((object): object is BoardObject => object !== undefined),
    changeSets: parts.feed.changeLog.recent,
    changeSetTotal: parts.feed.changeLog.total,
    enteredGroupId: controller.enteredGroupId,
    textEditing: parts.textEditing,
  };
}
