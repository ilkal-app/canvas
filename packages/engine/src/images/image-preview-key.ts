import type { ImageObjectEvidence } from './image-preview-evidence.js';
import type { UnitRect } from './tiles.js';

/** Maximum reusable plan key in UTF-16 code units; larger frames use ordinary hydration. */
export const MAX_IMAGE_PREVIEW_KEY_LENGTH = 4 * 1024 * 1024;

function rect(value: UnitRect): readonly number[] {
  return [value.minU, value.minV, value.maxU, value.maxV];
}

/**
 * Serializes exact plans and sampled coverage without renderer-local atlas/allocation handles.
 * Current evidence must still be checked separately immediately before issuing a certificate.
 *
 * @param images - Complete image evidence from this frame.
 * @returns Deterministic reusable key, or undefined for duplicates or excessive output.
 */
export function imagePreviewKey(images: readonly ImageObjectEvidence[]): string | undefined {
  const ordered = [...images].sort((a, b) =>
    a.object.id < b.object.id ? -1 : a.object.id > b.object.id ? 1 : 0,
  );
  const parts: string[] = [];
  let length = 2;
  let previous: string | undefined;
  for (const image of ordered) {
    const { object, transform, plan, binding, residents } = image;
    if (object.id === previous) return undefined;
    previous = object.id;
    const key = JSON.stringify([
      object.id,
      object.assetId,
      image.contentIdentity,
      [transform.x, transform.y, transform.cos, transform.sin],
      [
        plan.smallestKey,
        plan.pickedLevel,
        plan.level,
        plan.levelKey,
        plan.tiles?.map(({ key, address }) => [
          key,
          address.level,
          address.column,
          address.row,
          address.widthPx,
          address.heightPx,
          rect(address.rect),
        ]),
      ],
      binding.parts.map((part) => [
        rect(part.rect),
        part.source === undefined ? null : rect(part.source.covers),
      ]),
      [...residents]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((resident) => [resident.key, resident.widthPx, resident.heightPx]),
    ]);
    length += key.length + 1;
    if (length > MAX_IMAGE_PREVIEW_KEY_LENGTH) return undefined;
    parts.push(key);
  }
  return `[${parts.join(',')}]`;
}
