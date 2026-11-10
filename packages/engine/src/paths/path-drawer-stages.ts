import type { FrameContext } from '../scene/frame-context.js';
import type { Frame } from '../scene/frame.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { preparationStageOf } from './path-drawer-options.js';

/** What a path drawer does in the frame's stages. */
export interface PathDrawerStages {
  /** The pass's name, which names its mesh stage. */
  readonly passName: string;
  /** Whether the pass's instance buffer has dirty ranges this frame. */
  readonly hasDirtyRecords: () => boolean;
  /** Reads the records written this frame, before their upload forgets them. */
  readonly noteChanges?: () => void;
  /** Drops the frame's reusable preparation. */
  readonly invalidate: () => void;
  /** Reads a change set once the scene applied it. */
  readonly observe: (changes: SceneChangeSet, context: FrameContext) => void;
  /** Builds and uploads the frame's meshes. */
  readonly prepare: (context: FrameContext) => void;
}

/**
 * Wraps `collectChanges` to track paths and `uploadDirtyRanges` to notice rewritten records, and
 * inserts the mesh stage before `draw`.
 *
 * @param frame - The renderer's frame.
 * @param stages - What the drawer does in them.
 */
export function installPathDrawerStages(frame: Frame, stages: PathDrawerStages): void {
  frame.wrapStage('collectChanges', (inner) => ({
    name: inner.name,
    run: (context) => {
      // Peek at the coalesced change set, hand it back, and read it after the scene applied it.
      const changes = context.changes.drain();
      if (changes) context.changes.push(changes);
      inner.run(context);
      if (changes) {
        if (changes.created.length + changes.updated.length + changes.deleted.length > 0) {
          stages.invalidate();
        }
        stages.observe(changes, context);
      }
    },
  }));
  frame.wrapStage('uploadDirtyRanges', (inner) => ({
    name: inner.name,
    run: (context) => {
      if (stages.hasDirtyRecords()) stages.invalidate();
      stages.noteChanges?.();
      inner.run(context);
    },
  }));
  frame.insertStage('before', 'draw', {
    name: preparationStageOf(stages.passName),
    run: (context) => {
      stages.prepare(context);
    },
  });
}
