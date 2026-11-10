import type { ParagraphStyle, StyleRun } from '@canvas/schema';
import type { FontMetrics } from '@canvas/text';
import type { TextAlign, TextBaseDirection } from '@canvas/text';

import type { PackedTextLayout } from './packed-layout.js';

/**
 * A request to lay out one text object, the payload of a `layout` job (layout runs in the worker
 * pool). Everything layout needs travels with it, as plain structured-cloneable data: the text, its
 * runs, the box's wrapping width, alignment and direction, and the metrics of each face the runs
 * use, cut to the characters they set (built by `createLayoutJobRequest`).
 */
export interface LayoutJobRequest {
  /** The text object being laid out, echoed in the response. */
  readonly objectId: string;
  /** The characters, a JavaScript (UTF-16) string. */
  readonly text: string;
  /** Style runs covering the text, satisfying the schema's run invariant. */
  readonly runs: readonly StyleRun[];
  /** The wrapping width, in world units; `null` for auto-width text. */
  readonly maxWidth: number | null;
  /** Horizontal alignment of each line. */
  readonly align: TextAlign;
  /** The base direction of each paragraph. */
  readonly direction: TextBaseDirection;
  /** The metrics of every face the runs resolve to; the first is the default face. */
  readonly fonts: readonly FontMetrics[];
  /**
   * Which loaded face each entry of `fonts` is, in the same order: its id, and the key of its
   * font file among the job's resources, which a shaping job reads.
   */
  readonly faces: readonly LayoutJobFace[];
  /**
   * A sticky note's text box height: the job lays the text out at the largest size that
   * fits it (`fitNoteText`), else at the runs' own sizes.
   */
  readonly fitHeight?: number;
  /** The most lines each paragraph shows: the job clamps them (`clampLines`). */
  readonly lineCaps?: readonly number[];
  /** One style per paragraph when any is a list. */
  readonly paragraphs?: readonly ParagraphStyle[];
}

/** A face a `layout` job uses: its `fontFaceId` and its font file's resource key. */
export interface LayoutJobFace {
  /** The face's id. */
  readonly faceId: string;
  /** Its `LoadedFontFace.fontKey`, the key of its bytes among the job's resources. */
  readonly fontKey: string;
}

/** A laid-out text object, the response of a `layout` job. */
export interface LayoutJobResponse {
  /** The text object that was laid out. */
  readonly objectId: string;
  /** The layout, packed so its buffers transfer back (`unpackTextLayout` reads it). */
  readonly layout: PackedTextLayout;
}
