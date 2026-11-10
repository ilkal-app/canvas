/**
 * Rewrites unsent edits cached by a build that wrote one stored layout into the stored layout
 * of the next. It receives the edits the relay lacks, as one Yjs update (format v1),
 * and returns them as they must be written in the target layout. Pure: it never mutates its
 * input.
 */
export type LayoutConverter = (unsent: Uint8Array) => Uint8Array;

/** Converters keyed by {@link layoutStepKey}: one entry per stored-layout bump it can carry. */
export type LayoutConverters = ReadonlyMap<string, LayoutConverter>;

/**
 * The registry key of the bump from one stored layout to another, e.g. `1->2`.
 *
 * @param from - The stored layout the edits were written in.
 * @param to - The stored layout they are converted to.
 * @returns The key.
 */
export function layoutStepKey(from: number, to: number): string {
  return `${String(from)}->${String(to)}`;
}

/**
 * Returns the unsent edits unchanged.
 *
 * @param unsent - The edits.
 * @returns The same bytes.
 */
function identity(unsent: Uint8Array): Uint8Array {
  return unsent;
}

/**
 * The converters this build ships. `1->2` is the identity (): layout 2
 * only split a line's `points` pair into `points.0` and `points.1`, the current store still reads
 * layout 1 (`READABLE_LAYOUT_VERSIONS`), and's one-time copy already treats layout-1
 * bytes as layout-2 bytes. No build ever wrote a `…:layout:1` database (the writer-layout suffix
 * arrived with layout 2), so the identity applies to no stored bytes in practice; the
 * pre-suffix database stays's. `2->3` is the identity too: layout 3
 * only lets a fill be a gradient and a stroke or text colour be `'ink'`, so every edit a layout 2
 * build wrote is a valid layout 3 write. `3->4` is the identity too: unsent
 * layout 3 edits write placements without `pageId`, which layout 4 reads as `page-1` (or the
 * parent's page), and if `page-1` is gone by then the repair moves them to the first page (R1).
 * `4->5` preserves every unsent edit too: components add types and optional constraints;
 * existing object fields keep their layout and meaning (owner-approved storage).
 * `5->6` is the identity too: layout 6 only lets an override record hold `textStyle`
 * and `runs`, so every record a layout 5 build wrote means the same in layout 6.
 * `6->7` is the identity too: layout 7 only lets a shape's fill or a frame's
 * background be an image paint, so every paint a layout 6 build wrote means the same in layout 7.
 * `7->8` is the identity too: layout 8 only adds optional auto-layout fields to existing
 * groups and override records, so every edit a layout 7 build wrote means the same in layout 8.
 * `8->9` is the identity too: layout 9 adds the `tokens` map and lets a colour name a
 * token, so every edit a layout 8 build wrote is a valid layout 9 write.
 * `9->10` is the identity too: layout 10 only adds optional variant fields (a main's
 * axes and presets, an instance's selection), so every edit a layout 9 build wrote means the same
 * in 10.
 * `10->11` is the identity too: layout 11 only adds a slot's optional `swapOptions` and
 * an override record's optional `mainId`, so every edit a layout 10 build wrote means the same in
 * 11.
 * `11->12` is the identity too: layout 12 only gates optional stroke style and shadow
 * fields in existing style groups, so every edit a layout 11 build wrote means the same in 12.
 * `12->13` is the identity too: layout 13 only gates a shape's or frame's optional
 * `strokeAlign` and a frame's optional `stroke`, so every layout 12 edit means the same in 13.
 * `13->14` is the identity too: layout 14 only gates optional geometry and a layout patch
 * in override records, so every layout 13 edit means the same in 14.
 * `14->15` is the identity too: layout 15 only gates any object's optional layer `name`,
 * so every layout 14 edit means the same in 15.
 * `15->16` is the identity too: layout 16 only adds the named style maps and optional
 * style ids and shadow layers, so every layout 15 edit means the same in 16.
 * `16->17` is the identity too: layout 17 only gates a frame's optional `cornerRadius`,
 * so every layout 16 edit means the same in 17.
 * `17->18` is the identity too: layout 18 only lets an auto-layout's gap be negative,
 * so every layout 17 edit means the same in 18.
 * `18->19` is the identity too: layout 19 only gates an instance's optional `scale`,
 * so every layout 18 edit means the same in 19.
 * `19->20` is the identity too: layout 20 only gates a layer's optional `opacity`, so
 * every layout 19 edit means the same in 20.
 * `20->21` is the identity too: layout 21 only gates a layer's optional `isHidden`, so
 * every layout 20 edit means the same in 21.
 * `21->22` is the identity too: layout 22 only gates a text's optional `direction` and
 * `align` start/end, so every layout 21 edit means the same in 22.
 * `22->23` is the identity too: layout 23 only gates a run's optional `fontVariations`
 * attribute, so every layout 22 edit means the same in 23.
 * `23->24` is the identity too: layout 24 only gates a run's optional `lang`, so every
 * layout 23 edit means the same in 24.
 * `24->25` is the identity too: layout 25 only gates a run's optional `postScriptName`,
 * so every layout 24 edit means the same in 25.
 * `25->26` is the identity too: layout 26 only gates a frame child's paint overrides, so
 * every layout 25 edit means the same in 26.
 * `26->27` is the identity too: layout 27 only gates a run's optional `fontFeatures`, so
 * every layout 26 edit means the same in 27.
 * `27->28` is the identity too: layout 28 only gates a sticky's optional `aspect`, so
 * every layout 27 edit means the same in 28.
 * `28->29` is the identity too: layout 29 only adds the `freehand` object type, so every
 * layout 28 edit means the same in 29.
 * `29->30` is the identity too: layout 30 only gates an object's optional `link`, so
 * every layout 29 edit means the same in 30.
 * `30->31` is the identity too: layout 31 only gates a run's optional `link`, so every
 * layout 30 edit means the same in 31.
 * `31->32` is the identity: layout 32 only gates an image's optional `border`.
 * `32->33` is the identity: layout 33 only gates a connector's optional `labelPosition`.
 * `33->34` is the identity: layout 34 only gates a connector's optional `elbowMiddle` and
 * `curvePoint`.
 * `34->35` is the identity: layout 35 only gates a run's optional `underline` and
 * `strikethrough` and a text's optional paragraph list styles.
 * `35->36` is the identity: layout 36 only adds the `link` object type, so every layout
 * 35 edit means the same in 36.
 * A later bump adds its converter here, or its unsent edits are reported to the person and kept
 * until dismissed.
 */
export const DEFAULT_LAYOUT_CONVERTERS: LayoutConverters = new Map([
  [layoutStepKey(1, 2), identity],
  [layoutStepKey(2, 3), identity],
  [layoutStepKey(3, 4), identity],
  [layoutStepKey(4, 5), identity],
  [layoutStepKey(5, 6), identity],
  [layoutStepKey(6, 7), identity],
  [layoutStepKey(7, 8), identity],
  [layoutStepKey(8, 9), identity],
  [layoutStepKey(9, 10), identity],
  [layoutStepKey(10, 11), identity],
  [layoutStepKey(11, 12), identity],
  [layoutStepKey(12, 13), identity],
  [layoutStepKey(13, 14), identity],
  [layoutStepKey(14, 15), identity],
  [layoutStepKey(15, 16), identity],
  [layoutStepKey(16, 17), identity],
  [layoutStepKey(17, 18), identity],
  [layoutStepKey(18, 19), identity],
  [layoutStepKey(19, 20), identity],
  [layoutStepKey(20, 21), identity],
  [layoutStepKey(21, 22), identity],
  [layoutStepKey(22, 23), identity],
  [layoutStepKey(23, 24), identity],
  [layoutStepKey(24, 25), identity],
  [layoutStepKey(25, 26), identity],
  [layoutStepKey(26, 27), identity],
  [layoutStepKey(27, 28), identity],
  [layoutStepKey(28, 29), identity],
  [layoutStepKey(29, 30), identity],
  [layoutStepKey(30, 31), identity],
  [layoutStepKey(31, 32), identity],
  [layoutStepKey(32, 33), identity],
  [layoutStepKey(33, 34), identity],
  [layoutStepKey(34, 35), identity],
  [layoutStepKey(35, 36), identity],
]);

/**
 * Finds how to carry edits from one stored layout to a later one: the registered converter for
 * the whole bump, else the registered single steps chained (`2->3` then `3->4`).
 *
 * @param from - The stored layout the edits were written in.
 * @param to - The stored layout this build writes; greater than `from`.
 * @param converters - The registry; {@link DEFAULT_LAYOUT_CONVERTERS} by default.
 * @returns The converter, or `undefined` when some step has none.
 */
export function findLayoutConverter(
  from: number,
  to: number,
  converters: LayoutConverters = DEFAULT_LAYOUT_CONVERTERS,
): LayoutConverter | undefined {
  if (from >= to) return undefined;
  const whole = converters.get(layoutStepKey(from, to));
  if (whole !== undefined) return whole;
  const steps: LayoutConverter[] = [];
  for (let layout = from; layout < to; layout += 1) {
    const step = converters.get(layoutStepKey(layout, layout + 1));
    if (step === undefined) return undefined;
    steps.push(step);
  }
  return (unsent) => steps.reduce((bytes, step) => step(bytes), unsent);
}
