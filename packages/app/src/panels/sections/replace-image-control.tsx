import { useRef, type ReactElement } from 'react';

import { coverCrop, type BoardReader } from '@canvas/document';
import {
  resolveInstance,
  virtualObjectId,
  type BoardObject,
  type ImageObject,
  type InstanceObject,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

import controls from '../controls/controls.module.css';
import { useImageReplacer } from '../image-replacement-context.js';

import { mainClosureOf } from './use-board-changes.js';

// The cover crop moved to @canvas/document (the image popover's Replace); kept here too.
export { coverCrop } from '@canvas/document';

/** A width and a height. */
interface Size {
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

/**
 * The size a child of an instance's main has in that instance: its box after the instance's
 * pin and stretch constraints at the instance's size, through nested instances for a nested
 * path (`resolveInstance` over the main's closure, `mainClosureOf`, which may be on another
 * page). Pure.
 *
 * @param board - The whole board.
 * @param instance - The instance.
 * @param path - The child's override path.
 * @returns Its size, or undefined when the instance does not show it (hidden, or missing).
 */
export function resolvedChildSize(
  board: BoardReader,
  instance: InstanceObject,
  path: string,
): Size | undefined {
  const objects = new Map<ObjectId, BoardObject>();
  for (const id of mainClosureOf(board, instance.mainId)) {
    const object = board.get(id);
    if (object !== undefined) objects.set(id, object);
  }
  const wanted = virtualObjectId(instance.id, path);
  const child = resolveInstance({ objects }, instance).objects.find(({ id }) => id === wanted);
  return child !== undefined && 'width' in child && 'height' in child
    ? { width: child.width, height: child.height }
    : undefined;
}

/** Props of {@link ReplaceImageControl}. */
export interface ReplaceImageControlProps {
  /** The whole board, read for the child's box in the instance when the image arrives. */
  readonly board: BoardReader;
  /** The instance. */
  readonly instanceId: ObjectId;
  /** The image child's override path. */
  readonly path: string;
  /** The image child, as its main stores it. */
  readonly source: ImageObject;
  /** Writes the override, one `setInstanceOverride`. */
  readonly set: (record: OverrideRecord) => void;
}

/**
 * "Replace image…" on an instance's image child (rule 3): picks an image file, which
 * the page's images read, draw at once and upload (`PageImages.replace`), and overrides the
 * child's asset, natural size and crop (filling the child's box in this instance, as it is when the
 * image arrives: `resolvedChildSize`, `coverCrop`), the upload's badge on the instance. Nothing
 * where the page has no images (no assets service).
 *
 * @param props - The board, the instance, the child and the override writer.
 * @returns The control, or nothing.
 */
export function ReplaceImageControl(props: ReplaceImageControlProps): ReactElement | null {
  const replace = useImageReplacer();
  const input = useRef<HTMLInputElement>(null);
  if (replace === undefined) return null;
  const { board, instanceId, path, source, set } = props;
  return (
    <>
      <button
        type="button"
        className={controls.button}
        onClick={() => {
          input.current?.click();
        }}
      >
        Replace image…
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="Replace image…"
        tabIndex={-1}
        hidden
        onChange={(event) => {
          const [file] = event.currentTarget.files ?? [];
          event.currentTarget.value = '';
          if (file === undefined) return;
          replace(file, ({ assetId, naturalSize }) => {
            const instance = board.get(instanceId);
            const box =
              instance?.type === 'instance' ? resolvedChildSize(board, instance, path) : undefined;
            set({ assetId, naturalSize, crop: coverCrop(box ?? source, naturalSize) });
            return [instanceId];
          });
        }}
      />
    </>
  );
}
