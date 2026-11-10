// Seeded random boards for the z-order planner's brute-force test (adapted from the
// Reviewer's harness): objects of every kind the standard passes draw, their records one
// slot each, pages for the paged passes, hidden text, and boxes, some missing; and the strict
// z-order check a plan is held to.
import type { WorldBounds } from '../../../camera/camera.js';
import type { DrawListEntry } from '../../draw-list.js';
import type { PlannedPass, SegmentPlanInput } from '../segment-plan.js';

/** The standard passes' order: rects, SDF shapes, images, paths, text. */
export const BOARD_PASSES = ['rect', 'shape', 'image', 'path', 'text'] as const;

const RECT = 0;
const SHAPE = 1;
const IMAGE = 2;
const PATH = 3;
const TEXT = 4;

/**
 * Which objects start a split (`isOccluderByRank`): `painted`, the engine's rule since,
 * where besides a note, a filled path and an opaque rectangle any painted shape (a translucent
 * fill, an outline only) and any image with opacity above 0 start a split; or `opaque`, the rule
 * before it, where only opaque objects did (kept as a harder test of the page rule, with fewer
 * splits).
 */
export type SplitRule = 'opaque' | 'painted';

/** One random board, ready for `planSegmentDraws`. */
export interface RandomBoard {
  /** Objects, in paint order. */
  readonly count: number;
  /** Per rank, its box; `undefined` for an object drawn without one. */
  readonly boxes: (WorldBounds | undefined)[];
  /** Per rank, whether its text is hidden (and so greek, on the greek page). */
  readonly isTextHidden: readonly boolean[];
  /** The planner's input, without boxes. */
  readonly input: SegmentPlanInput;
}

/**
 * A seeded generator of numbers in [0, 1) (mulberry32).
 *
 * @param seed - The seed.
 * @returns The generator.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A random box on a 400-unit board, or none (3%).
 *
 * @param random - The generator.
 * @returns The box.
 */
export function randomBox(random: () => number): WorldBounds | undefined {
  if (random() < 0.03) return undefined;
  const [x, y, width, height] = [
    random() * 400,
    random() * 400,
    10 + random() * 120,
    10 + random() * 120,
  ];
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

/** One object's kind: its records per pass, pages, whether it starts a split, its text. */
interface Kind {
  /** Records per pass, in `BOARD_PASSES` order. */
  readonly records: readonly number[];
  /** Whether it starts a split under each rule. */
  readonly isOccluder: Readonly<Record<SplitRule, boolean>>;
  /** Whether its text is hidden. */
  readonly isTextHidden: boolean;
  /** Whether its shown text is greek (bars on the greek page, 0) rather than glyphs. */
  readonly isTextGreek: boolean;
}

/**
 * Records per pass for an object drawn by some passes, a record each unless given.
 *
 * @param counts - Pass index to record count.
 * @returns The counts in pass order.
 */
function recordsOf(counts: Readonly<Partial<Record<number, number>>>): number[] {
  return BOARD_PASSES.map((unused, pass) => counts[pass] ?? 0);
}

const OCCLUDES = { opaque: true, painted: true } as const;
const NEVER = { opaque: false, painted: false } as const;
/** Painted, but not opaque: a split only under the `painted` rule. */
const PAINTED = { opaque: false, painted: true } as const;

function randomKind(random: () => number): Kind {
  const roll = random();
  const glyphs = 1 + Math.floor(random() * 3);
  const text = random() < 0.7 ? glyphs : 0;
  const isTextHidden = random() < 0.25;
  const isTextGreek = isTextHidden || random() < 0.3;
  const shape = { isTextHidden: false, isTextGreek: false };
  if (roll < 0.25) {
    // A sticky note, with or without text.
    const records = recordsOf({ [SHAPE]: 1, [TEXT]: text });
    return { records, isOccluder: OCCLUDES, isTextHidden, isTextGreek };
  }
  if (roll < 0.33) return { ...shape, records: recordsOf({ [SHAPE]: 1 }), isOccluder: PAINTED };
  if (roll < 0.43) return { ...shape, records: recordsOf({ [RECT]: 1 }), isOccluder: OCCLUDES };
  if (roll < 0.58)
    return { records: recordsOf({ [TEXT]: glyphs }), isOccluder: NEVER, isTextHidden, isTextGreek };
  if (roll < 0.7) {
    const isFilled = random() < 0.3;
    return { ...shape, records: recordsOf({ [PATH]: 1 }), isOccluder: isFilled ? OCCLUDES : NEVER };
  }
  if (roll < 0.76) return { ...shape, records: recordsOf({ [PATH]: 1 }), isOccluder: NEVER };
  // An image, tiled on several pages at times: opaque, translucent or fully transparent.
  const tiles = random() < 0.3 ? 2 + Math.floor(random() * 3) : 1;
  const opacity = random();
  const isOccluder = opacity < 0.6 ? OCCLUDES : opacity < 0.95 ? PAINTED : NEVER;
  return { ...shape, records: recordsOf({ [IMAGE]: tiles }), isOccluder };
}

/**
 * Builds a random board of 2 to 41 objects: notes with and without text, painted shapes that
 * are not opaque (a translucent fill, an outline only), filled rectangles, text, paths (some
 * filled), lines, images (opaque, translucent or transparent, some tiled over several pages) on
 * 1 to 8 pages, text in glyphs on 1 to 4 atlas pages or greek on the greek page (0), some of it
 * hidden, some objects with no box. Records are one slot each, in paint order or shuffled.
 *
 * @param seed - The seed.
 * @param rule - Which objects start a split.
 * @returns The board.
 */
export function randomBoard(seed: number, rule: SplitRule = 'painted'): RandomBoard {
  const random = seededRandom(seed);
  const count = 2 + Math.floor(random() * 40);
  const pageCount = 1 + Math.floor(random() * 8);
  const glyphPages = 1 + Math.floor(random() * 4);
  const kinds = Array.from({ length: count }, () => randomKind(random));
  const boxes = kinds.map(() => randomBox(random));
  const isShuffled = random() < 0.3;
  const passes: PlannedPass[] = BOARD_PASSES.map((name, passIndex) => {
    const slots = kinds.flatMap(({ records }, rank) =>
      Array.from({ length: records[passIndex] ?? 0 }, (unused, record) => ({ rank, record })),
    );
    if (isShuffled) shuffle(slots, random);
    const pass: PlannedPass = {
      name,
      owners: {
        rankOfSlot: Int32Array.from(slots, ({ rank }) => rank),
        recordOfSlot: Int32Array.from(slots, ({ record }) => record),
      },
    };
    if (passIndex === IMAGE) {
      const pages = Int32Array.from(slots, () => Math.floor(random() * pageCount));
      return { ...pass, pageOfSlot: pages, isPaintOrderedAcrossPages: true };
    }
    if (passIndex !== TEXT) return pass;
    return { ...pass, ...textPages(kinds, slots, glyphPages, random) };
  });
  const visible: DrawListEntry[] = passes.map(({ name, owners }) => ({
    passName: name,
    ranges: [{ start: 0, count: owners.rankOfSlot.length }],
  }));
  const isOccluderByRank = Uint8Array.from(kinds, ({ isOccluder }) => (isOccluder[rule] ? 1 : 0));
  return {
    count,
    boxes,
    isTextHidden: kinds.map(({ isTextHidden }) => isTextHidden),
    input: { passes, isOccluderByRank, visible },
  };
}

/**
 * The text pass's pages and hidden ranks: glyphs on random atlas pages from 1, greek text (and
 * hidden text, whose records stay greek) on the greek page, 0.
 *
 * @param kinds - The objects.
 * @param slots - The pass's slots.
 * @param glyphPages - How many atlas pages glyphs use.
 * @param random - The generator.
 * @returns The pass's `pageOfSlot` and `isHiddenByRank`.
 */
function textPages(
  kinds: readonly Kind[],
  slots: readonly { rank: number }[],
  glyphPages: number,
  random: () => number,
): Pick<PlannedPass, 'pageOfSlot' | 'isHiddenByRank'> {
  const pageOfSlot = Int32Array.from(slots, ({ rank }) =>
    kinds[rank]?.isTextGreek === true ? 0 : 1 + Math.floor(random() * glyphPages),
  );
  const isHiddenByRank = Uint8Array.from(kinds, ({ isTextHidden }) => (isTextHidden ? 1 : 0));
  return { pageOfSlot, isHiddenByRank };
}

/**
 * The board with some text hidden or shown again, as a zoom does between a plan and the next
 * frame's moves: shown text that becomes hidden and hidden text that shows again stays greek, on
 * the greek page. Pure.
 *
 * @param board - The board.
 * @param random - The generator.
 * @returns The board with a new hidden set in its text pass.
 */
export function toggleHiddenText(board: RandomBoard, random: () => number): RandomBoard {
  const isTextHidden = board.isTextHidden.map((isHidden) =>
    random() < 0.3 ? !isHidden : isHidden,
  );
  const passes = board.input.passes.map((pass, passIndex) => {
    if (passIndex !== TEXT) return pass;
    const pageOfSlot = Int32Array.from(pass.owners.rankOfSlot, (rank, slot) =>
      isTextHidden[rank] !== board.isTextHidden[rank] ? 0 : (pass.pageOfSlot?.[slot] ?? 0),
    );
    const isHiddenByRank = Uint8Array.from(isTextHidden, (isHidden) => (isHidden ? 1 : 0));
    return { ...pass, pageOfSlot, isHiddenByRank };
  });
  return { ...board, isTextHidden, input: { ...board.input, passes } };
}

/**
 * Shuffles a list in place (Fisher–Yates).
 *
 * @param values - The list.
 * @param random - The generator.
 */
function shuffle(values: unknown[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const [a, b] = [values[index], values[other]];
    if (a === undefined || b === undefined) continue;
    values[index] = b;
    values[other] = a;
  }
}

function meets(a: WorldBounds | undefined, b: WorldBounds | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Where an object's records draw in a plan, per rank and pass: the first and the last. */
interface DrawPositions {
  /** Per `rank * passes + pass`, the earliest position; −1 when not drawn. */
  readonly first: Int32Array;
  /** Likewise, the latest. */
  readonly last: Int32Array;
}

/**
 * Where each record draws in a plan.
 *
 * @param board - The board.
 * @param entries - The plan's draw list.
 * @returns The first and last position of each object's records in each pass.
 */
function drawPositions(board: RandomBoard, entries: readonly DrawListEntry[]): DrawPositions {
  const first = new Int32Array(board.count * BOARD_PASSES.length).fill(-1);
  const last = new Int32Array(board.count * BOARD_PASSES.length).fill(-1);
  let position = 0;
  for (const { passName, ranges } of entries) {
    const passIndex = BOARD_PASSES.indexOf(passName as (typeof BOARD_PASSES)[number]);
    const pass = board.input.passes[passIndex];
    for (const { start, count } of ranges) {
      for (let slot = start; slot < start + count; slot += 1) {
        const rank = pass?.owners.rankOfSlot[slot] ?? -1;
        const at = rank * BOARD_PASSES.length + passIndex;
        if (rank >= 0 && (first[at] ?? -1) < 0) first[at] = position;
        if (rank >= 0) last[at] = position;
        position += 1;
      }
    }
  }
  return { first, last };
}

/**
 * The strict z-order errors of a plan: pairs of drawn records of objects whose boxes meet (or
 * that lack one) drawn against their paint order.
 *
 * @param board - The board.
 * @param entries - The plan's draw list.
 * @param boxes - The boxes to judge by (after moves, the new ones).
 * @returns One key per error, `lower:pass<upper:pass`.
 */
export function orderErrors(
  board: RandomBoard,
  entries: readonly DrawListEntry[],
  boxes: readonly (WorldBounds | undefined)[],
): Set<string> {
  const { first, last } = drawPositions(board, entries);
  const passes = BOARD_PASSES.length;
  const errors = new Set<string>();
  for (let lower = 0; lower < board.count; lower += 1) {
    for (let upper = lower + 1; upper < board.count; upper += 1) {
      if (!meets(boxes[lower], boxes[upper])) continue;
      for (let p = 0; p < passes; p += 1) {
        const below = last[lower * passes + p] ?? -1;
        if (below < 0) continue;
        for (let q = 0; q < passes; q += 1) {
          const above = first[upper * passes + q] ?? -1;
          if (above >= 0 && above < below)
            errors.add(`${String(lower)}:${String(p)}<${String(upper)}:${String(q)}`);
        }
      }
    }
  }
  return errors;
}

/**
 * Why the plan by passes alone draws a pair against paint order, for the classes it is known to
 * have: `cross-pass` when the lower object's record is in a later pass than the upper one's and
 * nothing between them starts a segment (the prototype's semantics: within a segment passes draw
 * in registered order); `text-pages` when both are text on different atlas pages (the text pass
 * draws page by page and does not keep paint order across pages). Anything else is `unexpected`.
 *
 * @param board - The board.
 * @param error - A key from {@link orderErrors}.
 * @returns Its class.
 */
export function errorClass(
  board: RandomBoard,
  error: string,
): 'cross-pass' | 'text-pages' | 'unexpected' {
  const [lower = 0, p = 0, upper = 0, q = 0] = error.split(/[:<]/).map(Number);
  if (p > q) return 'cross-pass';
  if (p !== TEXT || q !== TEXT) return 'unexpected';
  const pagesOf = (rank: number): Set<number> => {
    const pass = board.input.passes[TEXT];
    const pages = new Set<number>();
    pass?.owners.rankOfSlot.forEach((owner, slot) => {
      if (owner === rank) pages.add(pass.pageOfSlot?.[slot] ?? 0);
    });
    return pages;
  };
  const upperPages = pagesOf(upper);
  return [...pagesOf(lower)].some((page) => [...upperPages].some((other) => other < page))
    ? 'text-pages'
    : 'unexpected';
}
