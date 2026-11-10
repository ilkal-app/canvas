import type { DocumentStore } from '@canvas/document';
import type { SceneSpatialIndex } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import {
  SelectController,
  type RootMovePreview,
  type SelectControllerOptions,
  type SelectHitTester,
} from '@canvas/tools';

import { farObjectsNotice } from '../notices/far-notice.js';

import type { EngineDocumentOptions } from './engine-document-types.js';

/** What the select tool reads and calls back into on its document (`EngineDocument`). */
export interface DocumentSelectWiring {
  /** The document. */
  readonly store: DocumentStore;
  /** Picks objects under the pointer. */
  readonly hitTester: SelectHitTester;
  /** The hit-test index, which snapping queries. */
  readonly snapIndex: SceneSpatialIndex;
  /** Whether an object is drawn. */
  readonly isDrawable: (id: ObjectId) => boolean;
  /** Whether the person may edit the board. */
  readonly canEdit: () => boolean;
  /** Whether a tool mode of its own activates an object (text) on a double press. */
  readonly canActivate: (id: ObjectId) => boolean;
  /** The select tool's preview changed. */
  readonly onPreviewChange: (
    previewIds: readonly ObjectId[],
    movePreview?: RootMovePreview,
  ) => void;
  /** Hands an activation to the tool router. */
  readonly onActivate: NonNullable<SelectControllerOptions['onActivate']>;
  /** Reports a command the document refused. */
  readonly onCommandRefused: NonNullable<SelectControllerOptions['onCommandRefused']>;
}

/**
 * Creates a document's select tool from its options and wiring.
 *
 * @param options - The document's options: origin, environment, touch callbacks, notices.
 * @param wiring - What the select tool reads and calls back into.
 * @returns The select tool.
 */
export function createDocumentSelect(
  options: EngineDocumentOptions,
  wiring: DocumentSelectWiring,
): SelectController {
  const { onNotice } = options;
  return new SelectController({
    store: wiring.store,
    origin: options.origin,
    environment: options.environment,
    hitTester: wiring.hitTester,
    snapIndex: wiring.snapIndex,
    isDrawable: wiring.isDrawable,
    // A lone line is edited by its end handles (`modes/select-mode.ts`), not its frame.
    hasLineEndHandles: true,
    canEdit: wiring.canEdit, // A viewer only selects to look.
    // The select tool's touch callbacks.
    ...(options.onContextMenu && { onContextMenu: options.onContextMenu }),
    ...(options.onDoubleTap && { onDoubleTap: options.onDoubleTap }),
    // A finger dragging from empty board pans the view, as the hand tool does.
    ...(options.panView && { onPan: options.panView }),
    // A finger's double-tap edits what has a mode of its own (text) rather than zooming.
    canActivate: (id) => options.canActivate?.(id) === true || wiring.canActivate(id),
    onChange: wiring.onPreviewChange,
    onActivate: wiring.onActivate,
    onCommandRefused: wiring.onCommandRefused,
    // A transform skips selected objects placed far away, and the person is told once.
    ...(onNotice && {
      onFarSkipped: (skip) => {
        onNotice(farObjectsNotice(skip));
      },
    }),
  });
}
