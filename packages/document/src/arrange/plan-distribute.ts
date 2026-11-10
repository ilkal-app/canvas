import { moveBoxTo, type ArrangeBox, type ArrangeMove } from './arrange-box.js';

/** The axis a distribution spaces boxes along. */
export type DistributeAxis = 'horizontal' | 'vertical';

/** A box's start and length along one axis. */
interface Span {
  readonly box: ArrangeBox;
  readonly start: number;
  readonly length: number;
}

function spanOf(axis: DistributeAxis, box: ArrangeBox): Span {
  return axis === 'horizontal'
    ? { box, start: box.x, length: box.width }
    : { box, start: box.y, length: box.height };
}

/**
 * Plans a distribution: the boxes, ordered by their centres along the
 * axis, keep the first and the last where they are and space the others so every gap between
 * neighbours is the same, whatever their sizes (the gap is negative when they do not fit).
 * Boxes with the same centre keep their input order. Pure; the boxes are not changed.
 *
 * @param axis - Along which axis.
 * @param boxes - The boxes, axis-aligned in one frame, world units.
 * @returns The moves along the axis, in the boxes' order; nothing for fewer than three boxes.
 */
export function planDistribute(axis: DistributeAxis, boxes: readonly ArrangeBox[]): ArrangeMove[] {
  const spans = boxes
    .map((box) => spanOf(axis, box))
    .sort((first, second) => first.start + first.length / 2 - (second.start + second.length / 2));
  const first = spans[0];
  // With two boxes there is one gap and nothing to equalise.
  const last = spans.length >= 3 ? spans.at(-1) : undefined;
  if (first === undefined || last === undefined) return [];
  const total = spans.reduce((sum, span) => sum + span.length, 0);
  const gap = (last.start + last.length - first.start - total) / (spans.length - 1);
  const starts = new Map<ArrangeBox, number>();
  let cursor = first.start + first.length + gap;
  for (const span of spans.slice(1, -1)) {
    starts.set(span.box, cursor);
    cursor += span.length + gap;
  }
  return boxes.flatMap((box) => {
    const start = starts.get(box);
    if (start === undefined) return [];
    return moveBoxTo(box, axis === 'horizontal' ? { x: start, y: box.y } : { x: box.x, y: start });
  });
}
