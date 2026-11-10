import { describe, expect, it } from 'vitest';

import type { DrawListEntry } from '../draw-list.js';

import {
  planSegmentDraws,
  planSegments,
  type PlannedPass,
  type SlotOwners,
} from './segment-plan.js';

/**
 * Pairs pass names with their slot owners.
 *
 * @param names - The passes' names.
 * @param owners - Their slot owners, in the same order.
 * @returns The planner's passes.
 */
function passesOf(names: readonly string[], owners: readonly SlotOwners[]): PlannedPass[] {
  return names.map((name, index) => ({ name, owners: owners[index] ?? ownersOf([]) }));
}

/** A slot's owner: `[rank, record]`, or null for a free slot. */
type Owner = readonly [number, number] | null;

function ownersOf(slots: readonly Owner[]): SlotOwners {
  return {
    rankOfSlot: Int32Array.from(slots, (owner) => owner?.[0] ?? -1),
    recordOfSlot: Int32Array.from(slots, (owner) => owner?.[1] ?? 0),
  };
}

/**
 * Every slot of every pass visible, as the all-visible culler reports it.
 *
 * @param names - The passes' names.
 * @param owners - Their slot owners.
 * @returns One entry per pass covering all its slots.
 */
function allVisible(names: readonly string[], owners: readonly SlotOwners[]): DrawListEntry[] {
  return names.map((passName, index) => ({
    passName,
    ranges: [{ start: 0, count: owners[index]?.rankOfSlot.length ?? 0 }],
  }));
}

/**
 * Renders a plan as `pass [start, +count)` lines, one per range, in draw order.
 *
 * @param plan - The plan.
 * @returns One line per range.
 */
function drawSequence(plan: readonly DrawListEntry[]): string[] {
  return plan.flatMap(({ passName, ranges }) =>
    ranges.map(({ start, count }) => `${passName} [${String(start)}, +${String(count)})`),
  );
}

const TWO_PASSES = ['note', 'text'] as const;

describe('planSegments', () => {
  it('draws a board with no occluders as one segment: one range per pass', () => {
    const owners = [
      ownersOf([]),
      ownersOf([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ];
    const plan = planSegments({
      passes: passesOf(TWO_PASSES, owners),
      isOccluderByRank: new Uint8Array(3),
      visible: allVisible(TWO_PASSES, owners),
    });
    expect(drawSequence(plan)).toEqual(['text [0, +3)']);
  });

  it('draws a note over the text below it: text first, then the note in its own segment', () => {
    // Rank 0 is a text box, rank 1 an opaque note above it. The text pass is registered after
    // the note pass, so without segments the text would show through the note.
    const owners = [ownersOf([[1, 0]]), ownersOf([[0, 0]])];
    const plan = planSegments({
      passes: passesOf(TWO_PASSES, owners),
      isOccluderByRank: Uint8Array.of(0, 1),
      visible: allVisible(TWO_PASSES, owners),
    });
    expect(drawSequence(plan)).toEqual(['text [0, +1)', 'note [0, +1)']);
  });

  it('draws text over the note below it in one segment, passes in registered order', () => {
    const owners = [ownersOf([[0, 0]]), ownersOf([[1, 0]])];
    const plan = planSegments({
      passes: passesOf(TWO_PASSES, owners),
      isOccluderByRank: Uint8Array.of(1, 0),
      visible: allVisible(TWO_PASSES, owners),
    });
    expect(drawSequence(plan)).toEqual(['note [0, +1)', 'text [0, +1)']);
  });

  it('draws a note and its own text in one segment, the note under the text', () => {
    const owners = [
      ownersOf([[0, 0]]),
      ownersOf([
        [0, 0],
        [0, 1],
      ]),
    ];
    const plan = planSegments({
      passes: passesOf(TWO_PASSES, owners),
      isOccluderByRank: Uint8Array.of(1),
      visible: allVisible(TWO_PASSES, owners),
    });
    expect(drawSequence(plan)).toEqual(['note [0, +1)', 'text [0, +2)']);
  });

  it('starts a segment at every note that has text below it, bounding draws by segments × passes', () => {
    // text, note, text, note, text, note, text: ranks 0–6, notes at odd ranks.
    const notes = ownersOf([
      [1, 0],
      [3, 0],
      [5, 0],
    ]);
    const texts = ownersOf([
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
    ]);
    const plan = planSegments({
      passes: passesOf(TWO_PASSES, [notes, texts]),
      isOccluderByRank: Uint8Array.of(0, 1, 0, 1, 0, 1, 0),
      visible: allVisible(TWO_PASSES, [notes, texts]),
    });
    expect(drawSequence(plan)).toEqual([
      'text [0, +1)',
      'note [0, +1)',
      'text [1, +1)',
      'note [1, +1)',
      'text [2, +1)',
      'note [2, +1)',
      'text [3, +1)',
    ]);
    const segments = 4;
    expect(plan.length).toBeLessThanOrEqual(segments * TWO_PASSES.length);
  });

  it('merges occluders that need no split: stacked notes, or filled shapes in one pass, draw once', () => {
    const notes = ownersOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const texts = ownersOf([[3, 0]]);
    const plan = planSegments({
      passes: passesOf(TWO_PASSES, [notes, texts]),
      isOccluderByRank: Uint8Array.of(1, 1, 1, 0),
      visible: allVisible(TWO_PASSES, [notes, texts]),
    });
    expect(drawSequence(plan)).toEqual(['note [0, +3)', 'text [0, +1)']);
  });

  it('draws each pass in paint order when slots are not, splitting ranges where they jump', () => {
    // Slot 0 holds the top object: it was brought to front after the others were created.
    const owners = [
      ownersOf([
        [2, 0],
        [0, 0],
        [1, 0],
      ]),
    ];
    const plan = planSegments({
      passes: passesOf(['rect'], owners),
      isOccluderByRank: Uint8Array.of(1, 1, 1),
      visible: allVisible(['rect'], owners),
    });
    expect(drawSequence(plan)).toEqual(['rect [1, +2)', 'rect [0, +1)']);
  });

  it("draws an object's records in record order even when its slots are reversed", () => {
    // A note's shadow (record 0) must draw under its fill (record 1).
    const owners = [
      ownersOf([
        [0, 1],
        [0, 0],
      ]),
    ];
    const plan = planSegments({
      passes: passesOf(['note'], owners),
      isOccluderByRank: Uint8Array.of(1),
      visible: allVisible(['note'], owners),
    });
    expect(drawSequence(plan)).toEqual(['note [1, +1)', 'note [0, +1)']);
  });

  it('bridges free slots, which are zeroed and draw nothing, so deletions do not add draws', () => {
    const owners = [ownersOf([[0, 0], null, null, [1, 0], null])];
    const plan = planSegments({
      passes: passesOf(['rect'], owners),
      isOccluderByRank: new Uint8Array(2),
      visible: allVisible(['rect'], owners),
    });
    expect(drawSequence(plan)).toEqual(['rect [0, +4)']);
  });

  it('draws only the visible ranges, never bridging a culled record', () => {
    const owners = [
      ownersOf([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
      ]),
    ];
    const plan = planSegments({
      passes: passesOf(['rect'], owners),
      isOccluderByRank: new Uint8Array(4),
      visible: [
        { passName: 'rect', ranges: [{ start: 0, count: 1 }] },
        { passName: 'rect', ranges: [{ start: 2, count: 2 }] },
      ],
    });
    expect(drawSequence(plan)).toEqual(['rect [0, +1)', 'rect [2, +2)']);
  });

  it('splits segments by the visible occluders only', () => {
    // A culled note (rank 1) between two visible texts starts no segment.
    const notes = ownersOf([[1, 0]]);
    const texts = ownersOf([
      [0, 0],
      [2, 0],
    ]);
    const plan = planSegments({
      passes: passesOf(TWO_PASSES, [notes, texts]),
      isOccluderByRank: Uint8Array.of(0, 1, 0),
      visible: [{ passName: 'text', ranges: [{ start: 0, count: 2 }] }],
    });
    expect(drawSequence(plan)).toEqual(['text [0, +2)']);
  });

  it('ignores slots past the owner table and empty ranges, and plans nothing for nothing', () => {
    const owners = [ownersOf([[0, 0]])];
    expect(
      drawSequence(
        planSegments({
          passes: passesOf(['rect'], owners),
          isOccluderByRank: new Uint8Array(1),
          visible: [
            {
              passName: 'rect',
              ranges: [
                { start: 0, count: 3 },
                { start: 5, count: 0 },
              ],
            },
          ],
        }),
      ),
    ).toEqual(['rect [0, +1)']);
    expect(
      planSegments({
        passes: passesOf(['rect'], owners),
        isOccluderByRank: new Uint8Array(1),
        visible: [],
      }),
    ).toEqual([]);
  });

  it('refuses a visible entry that names no pass', () => {
    expect(() =>
      planSegments({
        passes: passesOf(['rect'], [ownersOf([])]),
        isOccluderByRank: new Uint8Array(0),
        visible: [{ passName: 'text', ranges: [] }],
      }),
    ).toThrow(RangeError);
  });

  it('refuses more passes than the pass mask holds', () => {
    const names = Array.from({ length: 33 }, (unused, index) => `pass-${String(index)}`);
    expect(() =>
      planSegments({
        passes: passesOf(
          names,
          names.map(() => ownersOf([])),
        ),
        isOccluderByRank: new Uint8Array(0),
        visible: [],
      }),
    ).toThrow(RangeError);
  });

  it('splits a paged pass by page, reading slots past its page table as page 0', () => {
    const owners = ownersOf([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    const passes: PlannedPass[] = [{ name: 'text', owners, pageOfSlot: Int32Array.from([2, 0]) }];
    const plan = planSegments({
      passes,
      isOccluderByRank: new Uint8Array(2),
      visible: allVisible(['text'], [owners]),
    });
    expect(plan).toEqual([
      {
        passName: 'text',
        page: 0,
        ranges: [{ start: 1, count: 2 }],
      },
      { passName: 'text', page: 2, ranges: [{ start: 0, count: 1 }] },
    ]);
  });

  describe('with hidden records and boxes', () => {
    // Two notes with text; the text pass has a free slot between their glyphs.
    const owners = [
      ownersOf([
        [0, 0],
        [1, 0],
      ]),
      ownersOf([[0, 0], [0, 1], null, [1, 0]]),
    ];
    const withHiddenText = (hidden: Uint8Array): PlannedPass[] =>
      passesOf(TWO_PASSES, owners).map((pass) =>
        pass.name === 'text' ? { ...pass, isHiddenByRank: hidden } : pass,
      );
    const input = {
      passes: withHiddenText(Uint8Array.of(0, 0)),
      isOccluderByRank: Uint8Array.of(1, 1),
      visible: allVisible(TWO_PASSES, owners),
    };
    const hiddenInput = { ...input, passes: withHiddenText(Uint8Array.of(1, 1)) };

    it('draws the records of shown objects and leaves hidden ones out', () => {
      expect(drawSequence(planSegments(input))).toEqual([
        'note [0, +1)',
        'text [0, +2)',
        'note [1, +1)',
        'text [3, +1)',
      ]);
      expect(drawSequence(planSegments(hiddenInput))).toEqual(['note [0, +2)']);
      const oneHidden = { ...input, passes: withHiddenText(Uint8Array.of(0, 1)) };
      // The second note covers the first's text, so it starts a segment (no boxes given).
      expect(drawSequence(planSegments(oneHidden))).toEqual([
        'note [0, +1)',
        'text [0, +2)',
        'note [1, +1)',
      ]);
    });

    it('merges notes whose boxes do not meet, and says the plan rests on them', () => {
      const apart = (rank: number) => ({
        minX: rank * 100,
        minY: 0,
        maxX: rank * 100 + 50,
        maxY: 50,
      });
      const plan = planSegmentDraws({ ...input, boundsOfRank: apart });
      expect(drawSequence(plan.entries)).toEqual(['note [0, +2)', 'text [0, +4)']);
      expect(plan).toMatchObject({ segmentCount: 1, hasSpatialMerges: true });
      const together = planSegmentDraws({ ...input, boundsOfRank: () => apart(0) });
      expect(together).toMatchObject({ segmentCount: 2, hasSpatialMerges: false });
      const hidden = planSegmentDraws({ ...hiddenInput, boundsOfRank: () => apart(0) });
      expect(hidden).toMatchObject({ segmentCount: 1, hasSpatialMerges: false });
    });
  });
});
